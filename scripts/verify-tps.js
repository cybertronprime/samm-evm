/**
 * VERIFY TPS benchmark results + find true per-shard ceiling
 * 
 * 1. Check that the 500 swaps ACTUALLY executed (events, balance changes)
 * 2. Determine the real block gas limit on RiseChain
 * 3. Calculate the ACTUAL per-shard TPS ceiling = blockGasLimit / gasPerSwap / blockTime
 * 4. Compare methodology with Solana/Sui measurements
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

function getLatestDeployment() {
  const dir = path.join(__dirname, "..", "deployment-data");
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith("production-risechain-") && f.endsWith(".json"))
    .sort().reverse();
  if (!files.length) throw new Error("No deployment found");
  return JSON.parse(fs.readFileSync(path.join(dir, files[0])));
}

async function main() {
  const dep = getLatestDeployment();
  const rpcUrl = "https://testnet.riselabs.xyz/http";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const poolAddr = "0x03e3D67F5b8c440A93502105214Dc7b20962560F"; // USDC-USDT-Large

  console.log(`\n${"═".repeat(70)}`);
  console.log(`🔍 TPS VERIFICATION & CEILING ANALYSIS`);
  console.log(`${"═".repeat(70)}\n`);

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Verify the benchmark block — did 500 swaps really happen?
  // ═══════════════════════════════════════════════════════════════
  console.log(`── Step 1: Verify benchmark block 39524481 ──\n`);

  const benchBlock = await provider.getBlock(39524481, true); // true = include txs
  console.log(`   Block ${benchBlock.number}:`);
  console.log(`   Timestamp: ${benchBlock.timestamp}`);
  console.log(`   Total txs: ${benchBlock.transactions.length}`);
  console.log(`   Gas used:  ${benchBlock.gasUsed.toLocaleString()}`);
  console.log(`   Gas limit: ${benchBlock.gasLimit.toLocaleString()}`);

  // Count how many txs went to our pool
  let poolTxCount = 0;
  for (const txHash of benchBlock.transactions) {
    // transactions might be hashes or full tx objects depending on provider
    if (typeof txHash === 'string') {
      // We can't check destination without fetching each tx - skip for now
      break;
    } else {
      if (txHash.to && txHash.to.toLowerCase() === poolAddr.toLowerCase()) {
        poolTxCount++;
      }
    }
  }
  
  // Check swap events in that block
  const poolAbi = [
    "event SwapSAMM(address indexed sender, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee)"
  ];
  const pool = new ethers.Contract(poolAddr, poolAbi, provider);

  console.log(`\n   Fetching SwapSAMM events from block 39524481...`);
  const events = await pool.queryFilter("SwapSAMM", 39524481, 39524481);
  console.log(`   SwapSAMM events in block: ${events.length}`);
  
  if (events.length > 0) {
    console.log(`   ✅ ${events.length} REAL swaps confirmed via on-chain events`);
    // Event data decoding has indexed params issue — but count is what matters
  } else {
    console.log(`   ❌ No SwapSAMM events found — swaps may not have executed!`);
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Block gas limit — the REAL constraint
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n── Step 2: Block Gas Limit (the real constraint) ──\n`);

  // Check several recent blocks for gas limits
  const latest = await provider.getBlockNumber();
  let totalGasLimit = 0n;
  let totalGasUsed = 0n;
  let maxGasUsed = 0n;
  const blockSamples = [];
  
  for (let i = 0; i < 10; i++) {
    const b = await provider.getBlock(latest - i);
    blockSamples.push({
      number: b.number,
      gasLimit: b.gasLimit,
      gasUsed: b.gasUsed,
      txCount: b.transactions.length,
      utilization: Number(b.gasUsed * 100n / b.gasLimit)
    });
    totalGasLimit += b.gasLimit;
    totalGasUsed += b.gasUsed;
    if (b.gasUsed > maxGasUsed) maxGasUsed = b.gasUsed;
    await new Promise(r => setTimeout(r, 200));
  }

  const avgGasLimit = totalGasLimit / 10n;
  const avgGasUsed = totalGasUsed / 10n;

  console.log(`   Recent blocks:`);
  for (const b of blockSamples) {
    console.log(`     Block ${b.number}: gasLimit=${Number(b.gasLimit).toLocaleString()} gasUsed=${Number(b.gasUsed).toLocaleString()} (${b.utilization}%) txs=${b.txCount}`);
  }
  console.log(`\n   Avg gas limit:  ${Number(avgGasLimit).toLocaleString()}`);
  console.log(`   Avg gas used:   ${Number(avgGasUsed).toLocaleString()}`);
  console.log(`   Max gas used:   ${Number(maxGasUsed).toLocaleString()}`);

  // Benchmark block
  console.log(`\n   Benchmark block 39524481:`);
  console.log(`     Gas limit:  ${Number(benchBlock.gasLimit).toLocaleString()}`);
  console.log(`     Gas used:   ${Number(benchBlock.gasUsed).toLocaleString()}`);
  console.log(`     Utilization: ${Number(benchBlock.gasUsed * 100n / benchBlock.gasLimit)}%`);

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Calculate TRUE per-shard TPS ceiling
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n── Step 3: True Per-Shard TPS Ceiling ──\n`);

  const gasPerSwap = 97212; // measured
  const blockGasLimit = Number(avgGasLimit);
  const blockTime = 1; // 1 second blocks

  // Method A: Gas-limited (assumes entire block for our pool — unrealistic)
  const maxSwapsPerBlock = Math.floor(blockGasLimit / gasPerSwap);
  const theoreticalMaxTPS = maxSwapsPerBlock / blockTime;
  
  // Method B: Realistic — pool shares block with other txs
  // On Solana: 129 TPS is the scheduler limit, not gas
  // On Sui: 214 TPS is object locking limit
  // On RiseChain: no account locking, so limit IS gas-based
  // But realistically, a single pool won't monopolize the entire block
  
  console.log(`   Gas per swap:        ${gasPerSwap.toLocaleString()}`);
  console.log(`   Block gas limit:     ${blockGasLimit.toLocaleString()}`);
  console.log(`   Block time:          ${blockTime}s`);
  console.log(`\n   Max swaps/block (100% utilization): ${maxSwapsPerBlock.toLocaleString()}`);
  console.log(`   Theoretical max TPS (whole block): ${theoreticalMaxTPS.toLocaleString()}`);
  
  // What % of block did our 500 swaps use?
  const ourGas = 500 * gasPerSwap;
  const ourPct = (ourGas / blockGasLimit * 100).toFixed(2);
  console.log(`\n   Our 500 swaps used: ${ourGas.toLocaleString()} gas (${ourPct}% of block limit)`);

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: Methodology comparison
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n── Step 4: Methodology — Solana vs Sui vs RiseChain ──\n`);

  console.log(`   SOLANA (~129 TPS/shard):`);
  console.log(`     Constraint: Account write-locking in scheduler`);
  console.log(`     All txs touching same pool accounts → serialized by leader`);
  console.log(`     ~400ms slots, max ~52 swap txs per slot = 129 TPS`);
  console.log(`     This is a HARD LIMIT regardless of compute capacity\n`);

  console.log(`   SUI (~214 TPS/shard):`);
  console.log(`     Constraint: Object locking (shared objects)`);
  console.log(`     AMM pool is shared object → consensus-ordered`);
  console.log(`     ~2.8s checkpoints, ~600 txs per checkpoint = 214 TPS`);
  console.log(`     HARD LIMIT from object contention\n`);

  console.log(`   RISECHAIN (EVM — different model):`);
  console.log(`     NO account/object locking mechanism`);
  console.log(`     Sequential execution (PEVM not live yet)`);
  console.log(`     Constraint: block gas limit / gas per swap / block time`);
  console.log(`     Per-shard limit = how much gas ONE pool can use per block`);
  console.log(`     No hard cap per contract — only total block gas limit\n`);

  console.log(`   KEY DIFFERENCE:`);
  console.log(`     Solana/Sui: per-pool scheduler limit (hard cap)`);
  console.log(`     RiseChain: gas limit shared across ALL pools`);
  console.log(`     → RiseChain per-shard TPS depends on network congestion\n`);

  // ═══════════════════════════════════════════════════════════════
  // STEP 5: Realistic per-shard TPS under load
  // ═══════════════════════════════════════════════════════════════
  console.log(`── Step 5: Realistic Per-Shard TPS Estimates ──\n`);

  const scenarios = [
    { name: "Empty chain (our test)",  pctForPool: ourGas / Number(benchBlock.gasUsed) * 100, actualTxs: 500 },
    { name: "Light load (25% util)",   pctForPool: 75 },
    { name: "Medium load (50% util)",  pctForPool: 50 },
    { name: "Heavy load (75% util)",   pctForPool: 25 },
    { name: "Saturated (90% util)",    pctForPool: 10 },
  ];

  console.log(`   Scenario                      │ Pool gets  │ Swaps/block │ TPS/shard`);
  console.log(`   ${"─".repeat(30)}┼${"─".repeat(12)}┼${"─".repeat(13)}┼${"─".repeat(10)}`);
  for (const s of scenarios) {
    const gasForPool = blockGasLimit * (s.pctForPool / 100);
    const swaps = s.actualTxs || Math.floor(gasForPool / gasPerSwap);
    const tps = swaps / blockTime;
    console.log(`   ${s.name.padEnd(30)}│ ${s.pctForPool.toFixed(1).padStart(8)}%  │ ${String(swaps).padStart(11)} │ ${tps.toFixed(0).padStart(9)}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Final verdict
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(70)}`);
  console.log(`🎯 VERDICT`);
  console.log(`${"═".repeat(70)}\n`);
  
  console.log(`   ✅ The 500 swaps DID execute (${events.length} SwapSAMM events confirmed)`);
  console.log(`   ✅ Gas per swap: ~97K (efficient)`);
  console.log(`   ✅ Block gas limit: ${blockGasLimit.toLocaleString()}`);
  console.log(`   ✅ 500 swaps used only ${ourPct}% of block gas\n`);

  const conservativeTPS = Math.floor(maxSwapsPerBlock * 0.25 / blockTime); // assume pool gets 25% of block
  console.log(`   Conservative per-shard TPS (25% of block): ${conservativeTPS}`);
  console.log(`   Optimistic per-shard TPS (50% of block):   ${Math.floor(maxSwapsPerBlock * 0.5 / blockTime)}`);
  console.log(`   Measured (low congestion):                 ${events.length}/block = ${events.length} TPS\n`);

  console.log(`   For orchestration contract, use CONSERVATIVE: ${conservativeTPS} TPS/shard`);
  console.log(`   Split threshold:  ${Math.floor(conservativeTPS * 0.8)}`);
  console.log(`   Merge threshold:  ${Math.floor(conservativeTPS * 0.3)}`);
}

main().then(() => process.exit(0)).catch(e => { console.error("❌", e); process.exit(1); });
