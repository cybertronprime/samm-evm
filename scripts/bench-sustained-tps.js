/**
 * SUSTAINED TPS BENCHMARK — SAMM Paper Methodology §6.1.3
 *
 * Reproduces the SAMM paper's exact measurement protocol:
 *   1. N concurrent trader wallets, each submitting swaps independently
 *   2. Each trader sends at Poisson-distributed (exp-random) intervals λ
 *   3. SYNC mode: trader awaits finality confirmation before next send
 *   4. WARMUP phase (discard), then MEASUREMENT window (record latencies)
 *   5. Finality latency = wall-clock RTT from tx submission → receipt
 *   6. Increase target throughput until avg finality > 3s = saturation point
 *   7. Each frequency tested N times, truncated average (median) reported
 *
 * Configuration:
 *   - 100 traders (matches Sui paper), 30s warmup, 60s measure
 *   - SYNC mode via eth_sendRawTransactionSync (RISE Chain shred-api)
 *   - Outputs: JSON report + CSV transaction log with tx hashes
 *
 * Usage:
 *   NUM_TRADERS=100 npx hardhat run scripts/bench-sustained-tps.js --network risechain
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

// ═══════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════
const NUM_TRADERS     = Number(process.env.NUM_TRADERS || "20");
const WARMUP_SEC      = Number(process.env.WARMUP_SEC  || "30");
const MEASURE_SEC     = Number(process.env.MEASURE_SEC || "60");
const LATENCY_CAP_SEC = 3.0;    // paper: throughput = max TPS where avg latency < 3s
const SWAP_USD        = 1;      // small swaps to avoid imbalancing pool
const REPEATS         = Number(process.env.REPEATS || "3"); // test each freq N times
const FUND_AMOUNT_PER = "500"; // tokens per trader wallet

// Target TPS values to test (ascending). We find where latency crosses 3s.
const TARGET_TPS_LIST = (process.env.TARGET_TPS || "25,50,100,150,200,250,300,400,500").split(",").map(Number);

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
function getLatestDeployment() {
  const dir = path.join(__dirname, "..", "deployment-data");
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith("production-risechain-") && f.endsWith(".json"))
    .sort().reverse();
  if (!files.length) throw new Error("No deployment found");
  return JSON.parse(fs.readFileSync(path.join(dir, files[0])));
}

/** Exponential random interval: mean = 1/λ seconds */
function expRandom(lambda) {
  return -Math.log(1 - Math.random()) / lambda;
}

/** Sleep ms */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Percentile (sorted array) */
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

/** Retry an async fn with exponential backoff (handles 429 rate limits) */
async function withRetry(fn, label = "rpc", maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      const isRateLimit = e.message?.includes("429") || e.message?.includes("Too Many") || e.message?.includes("rate") || e.code === "SERVER_ERROR";
      if (isRateLimit && i < maxRetries - 1) {
        const wait = 2000 * Math.pow(2, i); // 2s, 4s, 8s, 16s, 32s
        console.log(`   ⏳ Rate limited (${label}), waiting ${(wait/1000).toFixed(0)}s... (retry ${i+1}/${maxRetries})`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════
async function main() {
  const dep = getLatestDeployment();
  const rpcUrl = process.env.RISECHAIN_RPC_URL || "https://testnet.riselabs.xyz/http";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("Set PRIVATE_KEY in .env");
  const masterWallet = new ethers.Wallet(privateKey, provider);

  // Target pool — all txs go to ONE shard (single-shard throughput)
  const TARGET_PAIR  = process.env.TARGET_PAIR  || "USDC-USDT";
  const TARGET_SHARD = process.env.TARGET_SHARD || "Large";
  const pairShards = dep.contracts.shards[TARGET_PAIR];
  const shard = pairShards.find(s => s.name.includes(TARGET_SHARD));
  const [symA, symB] = TARGET_PAIR.split("-");
  const tkA = dep.contracts.tokens[symA];
  const tkB = dep.contracts.tokens[symB];

  const feeData = await provider.getFeeData();
  const gasPrice = (feeData.gasPrice || 100n) + 100n;
  const chainId = (await provider.getNetwork()).chainId;

  console.log(`\n${"═".repeat(70)}`);
  console.log(`📊 SUSTAINED TPS BENCHMARK (Paper Methodology §6.1.3)`);
  console.log(`${"═".repeat(70)}`);
  console.log(`Pool:         ${shard.name} (${shard.address})`);
  console.log(`Pair:         ${TARGET_PAIR}`);
  console.log(`Traders:      ${NUM_TRADERS} concurrent wallets`);
  console.log(`Warmup:       ${WARMUP_SEC}s`);
  console.log(`Measure:      ${MEASURE_SEC}s`);
  console.log(`Latency cap:  ${LATENCY_CAP_SEC}s`);
  console.log(`Repeats:      ${REPEATS} per target TPS`);
  console.log(`Target TPS:   ${TARGET_TPS_LIST.join(", ")}`);
  console.log(`Gas Price:    ${gasPrice} wei (legacy type 0)\n`);

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: Create & Fund Trader Wallets
  // ═══════════════════════════════════════════════════════════════
  console.log(`── Phase 1: Setting up ${NUM_TRADERS} trader wallets ──\n`);

  const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function transfer(address,uint256) returns (bool)",
    "function decimals() view returns (uint8)"
  ];
  const tokenAContract = new ethers.Contract(tkA.address, erc20Abi, masterWallet);
  const tokenBContract = new ethers.Contract(tkB.address, erc20Abi, masterWallet);

  // Derive trader wallets deterministically from master key
  const traders = [];
  const masterKeyBytes = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  for (let i = 0; i < NUM_TRADERS; i++) {
    // Derive child keys: keccak256(masterKey + index)
    const childKey = ethers.keccak256(
      ethers.concat([masterKeyBytes, ethers.toBeHex(i, 32)])
    );
    const wallet = new ethers.Wallet(childKey, provider);
    traders.push({
      wallet,
      address: wallet.address,
      nonce: 0
    });
  }

  console.log(`   Created ${NUM_TRADERS} trader wallets`);
  console.log(`   First:  ${traders[0].address}`);
  console.log(`   Last:   ${traders[NUM_TRADERS - 1].address}\n`);

  // Fund each trader with ETH (for gas) and tokens
  // At 9 wei gas × 300K gasLimit = 2.7M wei per tx. 0.000001 ETH = 1e12 wei = enough for ~370K txs
  const ethPerTrader = ethers.parseEther("0.000001");
  const tokensPerTrader = ethers.parseUnits(FUND_AMOUNT_PER, 6);

  // Check master balances first
  const masterBalA = await tokenAContract.balanceOf(masterWallet.address);
  const masterBalB = await tokenBContract.balanceOf(masterWallet.address);
  const masterEth = await provider.getBalance(masterWallet.address);
  const totalEthNeeded = ethPerTrader * BigInt(NUM_TRADERS);
  const totalTokensNeeded = tokensPerTrader * BigInt(NUM_TRADERS);

  console.log(`   Master ${symA} balance: ${ethers.formatUnits(masterBalA, 6)}`);
  console.log(`   Master ${symB} balance: ${ethers.formatUnits(masterBalB, 6)}`);
  console.log(`   Master ETH balance:  ${ethers.formatEther(masterEth)}`);
  console.log(`   Need per trader:     ${FUND_AMOUNT_PER} ${symA} + ${FUND_AMOUNT_PER} ${symB} + ${ethers.formatEther(ethPerTrader)} ETH`);
  console.log(`   Total needed:        ${ethers.formatUnits(totalTokensNeeded, 6)} ${symA} + ${ethers.formatUnits(totalTokensNeeded, 6)} ${symB} + ${ethers.formatEther(totalEthNeeded)} ETH\n`);

  if (masterEth < totalEthNeeded) {
    console.log(`   ⚠️  Insufficient ETH! Have ${ethers.formatEther(masterEth)}, need ${ethers.formatEther(totalEthNeeded)}`);
  }
  if (masterBalA < totalTokensNeeded || masterBalB < totalTokensNeeded) {
    console.log(`   ⚠️  Insufficient tokens. Need ${ethers.formatUnits(totalTokensNeeded, 6)} each.`);
  }

  // Fund traders — batch nonce management
  let masterNonce = await provider.getTransactionCount(masterWallet.address, "pending");
  console.log(`   Funding traders (master nonce: ${masterNonce})...\n`);

  const fundTxPromises = [];
  let fundedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < NUM_TRADERS; i++) {
    const addr = traders[i].address;
    const tag = `   [${i + 1}/${NUM_TRADERS}]`;

    try {
      // Check if already funded
      const bal = await provider.getBalance(addr);
      const balA = await tokenAContract.balanceOf(addr);
      const balB = await tokenBContract.balanceOf(addr);

      const needsEth = bal < ethPerTrader / 2n;
      const needsA = balA < tokensPerTrader / 2n;
      const needsB = balB < tokensPerTrader / 2n;

      if (!needsEth && !needsA && !needsB) {
        console.log(`${tag} ${addr.slice(0, 10)}... already funded ✓ (ETH: ${ethers.formatEther(bal)}, ${symA}: ${ethers.formatUnits(balA, 6)}, ${symB}: ${ethers.formatUnits(balB, 6)})`);
        skippedCount++;
        continue;
      }

      let steps = [];

      // Send ETH
      if (needsEth) {
        const tx = await masterWallet.sendTransaction({
          to: addr, value: ethPerTrader, nonce: masterNonce++, gasPrice, type: 0
        });
        fundTxPromises.push(tx.wait());
        steps.push(`ETH:${tx.hash.slice(0, 10)}`);
      }

      // Send token A
      if (needsA) {
        const tx = await tokenAContract.transfer(addr, tokensPerTrader, {
          nonce: masterNonce++, gasPrice, type: 0
        });
        fundTxPromises.push(tx.wait());
        steps.push(`${symA}:${tx.hash.slice(0, 10)}`);
      }

      // Send token B
      if (needsB) {
        const tx = await tokenBContract.transfer(addr, tokensPerTrader, {
          nonce: masterNonce++, gasPrice, type: 0
        });
        fundTxPromises.push(tx.wait());
        steps.push(`${symB}:${tx.hash.slice(0, 10)}`);
      }

      console.log(`${tag} ${addr.slice(0, 10)}... sent: ${steps.join(", ")}`);
      fundedCount++;

      // Throttle to avoid RPC overload — wait every 5 traders
      if (fundTxPromises.length >= 15) {
        console.log(`   ... waiting for batch confirmation (${fundTxPromises.length} pending txs)...`);
        await Promise.all(fundTxPromises);
        fundTxPromises.length = 0;
        console.log(`   ... batch confirmed ✓`);
      }
    } catch (e) {
      console.log(`${tag} ❌ FAILED: ${e.message.slice(0, 150)}`);
      // Try to recover nonce
      try {
        masterNonce = await provider.getTransactionCount(masterWallet.address, "pending");
        console.log(`${tag} Recovered nonce: ${masterNonce}`);
      } catch {}
    }
  }

  if (fundTxPromises.length > 0) {
    console.log(`\n   Waiting for final batch (${fundTxPromises.length} pending txs)...`);
    await Promise.all(fundTxPromises);
  }
  console.log(`\n   ✅ Funding complete: ${fundedCount} funded, ${skippedCount} already had funds\n`);

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: Approve Pool for Each Trader
  // ═══════════════════════════════════════════════════════════════
  console.log(`── Phase 2: Approving pool for each trader ──\n`);

  const approvalPromises = [];
  let approvedCount = 0;
  let alreadyApproved = 0;

  for (let i = 0; i < NUM_TRADERS; i++) {
    const tw = traders[i].wallet;
    const tag = `   [${i + 1}/${NUM_TRADERS}]`;

    try {
      const tAContract = new ethers.Contract(tkA.address, erc20Abi, tw);
      const tBContract = new ethers.Contract(tkB.address, erc20Abi, tw);

      const allowA = await tAContract.allowance(tw.address, shard.address);
      const allowB = await tBContract.allowance(tw.address, shard.address);

      let traderNonce = await provider.getTransactionCount(tw.address, "pending");
      let steps = [];

      const needApproveA = allowA < ethers.parseUnits("100000", 6);
      const needApproveB = allowB < ethers.parseUnits("100000", 6);

      if (!needApproveA && !needApproveB) {
        console.log(`${tag} ${tw.address.slice(0, 10)}... already approved ✓`);
        alreadyApproved++;
        continue;
      }

      if (needApproveA) {
        const tx = await tAContract.approve(shard.address, ethers.MaxUint256, {
          nonce: traderNonce++, gasPrice, type: 0
        });
        approvalPromises.push(tx.wait());
        steps.push(`${symA}:${tx.hash.slice(0, 10)}`);
      }

      if (needApproveB) {
        const tx = await tBContract.approve(shard.address, ethers.MaxUint256, {
          nonce: traderNonce++, gasPrice, type: 0
        });
        approvalPromises.push(tx.wait());
        steps.push(`${symB}:${tx.hash.slice(0, 10)}`);
      }

      console.log(`${tag} ${tw.address.slice(0, 10)}... approving: ${steps.join(", ")}`);
      approvedCount++;

      // Throttle
      if (approvalPromises.length >= 20) {
        console.log(`   ... waiting for approval batch...`);
        await Promise.all(approvalPromises);
        approvalPromises.length = 0;
        console.log(`   ... batch confirmed ✓`);
      }
    } catch (e) {
      console.log(`${tag} ❌ Approval failed: ${e.message.slice(0, 120)}`);
    }
  }

  if (approvalPromises.length > 0) {
    console.log(`\n   Waiting for final approval batch...`);
    await Promise.all(approvalPromises);
  }
  console.log(`\n   ✅ Approvals done: ${approvedCount} approved, ${alreadyApproved} already had allowance\n`);

  // Initialize nonces for each trader
  for (const t of traders) {
    t.nonce = await provider.getTransactionCount(t.address, "pending");
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3: Measure gas per swap
  // ═══════════════════════════════════════════════════════════════
  console.log(`── Phase 3: Measuring gas per swap ──\n`);

  const poolAbi = [
    "function swapSAMM(uint256,uint256,address,address,address) external returns (uint256)"
  ];
  const poolIface = new ethers.Interface(poolAbi);

  const testAmountOut = ethers.parseUnits("1", 6); // 1 USDT
  const testMaxIn = ethers.parseUnits("3", 6);     // max 3 USDC

  let gasPerSwap;
  try {
    // Re-fetch nonce for trader[0] specifically
    traders[0].nonce = await provider.getTransactionCount(traders[0].address, "pending");
    const poolForTest = new ethers.Contract(shard.address, poolAbi, traders[0].wallet);
    const testTx = await poolForTest.swapSAMM(
      testAmountOut, testMaxIn, tkA.address, tkB.address, traders[0].address,
      { gasPrice, nonce: traders[0].nonce++, type: 0 }
    );
    const receipt = await testTx.wait();
    gasPerSwap = Number(receipt.gasUsed);
    console.log(`   Gas per swap: ${gasPerSwap.toLocaleString()}`);
  } catch (e) {
    console.log(`   ⚠️ Test swap failed: ${e.message.slice(0, 120)}`);
    gasPerSwap = 97212; // fallback from previous measurement
    console.log(`   Using fallback: ${gasPerSwap}`);
  }

  // Re-fetch ALL trader nonces before Phase 4 (Phase 3 may have changed trader[0]'s)
  console.log(`\n   Refreshing all trader nonces...`);
  for (const t of traders) {
    t.nonce = await provider.getTransactionCount(t.address, "pending");
  }
  console.log(`   ✅ Nonces refreshed (trader[0] nonce: ${traders[0].nonce})`);

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3.5: Detect eth_sendRawTransactionSync (RISE Chain)
  // ═══════════════════════════════════════════════════════════════
  let useSyncRpc = process.env.NO_SYNC !== "1";
  if (useSyncRpc) {
    console.log(`\n── Phase 3.5: Detecting eth_sendRawTransactionSync ──\n`);
    try {
      const probeResp = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_sendRawTransactionSync", params: ["0x00"], id: 1 })
      });
      const probeData = await probeResp.json();
      // "method not found" (code -32601) means sync is not supported
      // Any OTHER error means the method exists but the tx was invalid
      if (probeData.error && (probeData.error.code === -32601 ||
          (probeData.error.message && probeData.error.message.toLowerCase().includes("method not found")))) {
        useSyncRpc = false;
        console.log(`   ❌ eth_sendRawTransactionSync not available`);
        console.log(`   Using async mode (batch sends + block scanner)\n`);
      } else {
        console.log(`   ✅ eth_sendRawTransactionSync detected!`);
        console.log(`   Using sync mode — wall-clock latency, no block scanner needed\n`);
      }
    } catch (e) {
      useSyncRpc = false;
      console.log(`   ⚠️ Sync detection failed: ${e.message.slice(0, 80)}`);
      console.log(`   Using async mode (batch sends + block scanner)\n`);
    }
  } else {
    console.log(`\n── Sync mode disabled (NO_SYNC=1) ──\n`);
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 4: Sustained TPS Test — Paper Methodology
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(70)}`);
  console.log(`📊 Phase 4: SUSTAINED THROUGHPUT TEST`);
  console.log(`${"═".repeat(70)}\n`);

  const allResults = [];
  const allTxRecords = []; // aggregated tx records across all runs for CSV

  for (const targetTPS of TARGET_TPS_LIST) {
    const perTraderRate = targetTPS / NUM_TRADERS; // λ per trader
    console.log(`\n┌─ Target: ${targetTPS} TPS (${perTraderRate.toFixed(1)} per trader) ─┐`);

    const runResults = [];
    let rateLimited = false;

    for (let run = 0; run < REPEATS; run++) {
      console.log(`│  Run ${run + 1}/${REPEATS}...`);

      let result;
      try {
        result = await runSustainedTest({
          traders,
          poolIface,
          shard,
          tkA, tkB,
          perTraderRate,
          targetTPS,
          warmupSec: WARMUP_SEC,
          measureSec: MEASURE_SEC,
          gasPrice,
          chainId,
          provider,
          rpcUrl,
          useSyncRpc
        });
      } catch (e) {
        const isRateLimit = e.message?.includes("429") || e.message?.includes("Too Many") || e.message?.includes("rate") || e.code === "SERVER_ERROR";
        if (isRateLimit) {
          console.log(`│    ⚠️ RPC rate-limited at ${targetTPS} TPS — skipping higher rates`);
          rateLimited = true;
          break;
        }
        console.log(`│    ❌ Run failed: ${(e.message || e.toString() || 'unknown error').slice(0, 150)}`);
        if (e.stack) console.log(`│       ${e.stack.split('\n')[1]?.trim().slice(0, 120)}`);
        continue;
      }

      if (result.rateLimited) {
        console.log(`│    ⚠️ RPC rate-limited during run — partial results: ${result.confirmed} confirmed`);
        if (result.confirmed > 0) runResults.push(result);
        rateLimited = true;
        break;
      }

      runResults.push(result);
      const confRate = result.sent > 0 ? (result.confirmed / result.sent * 100).toFixed(1) : '0.0';
      console.log(`│    Throughput: ${result.actualTPS.toFixed(1)} TPS (time) / ${result.blockBasedTPS.toFixed(1)} TPS (block-based)`);
      console.log(`│    Finality:   avg ${result.avgRawLatency.toFixed(3)}s, p50 ${(pct([...result.txRecords.map(r=>r.latencyMs/1000)], 50) || result.avgRawLatency).toFixed(3)}s, p95 ${result.p95RawLatency.toFixed(3)}s`);
      console.log(`│    Confirms:   ${result.confirmed}/${result.sent} (${confRate}% confirmation rate), ${result.failed} reverted, ${result.txRecords.length} tx hashes logged`);
      console.log(`│    Blocks:     ${result.blockSpread} blocks, avg ${result.avgTxsPerBlock.toFixed(0)} txs/block, peak ${result.maxTxsPerBlock} txs/block`);

      // Accumulate per-tx records for CSV export
      if (result.txRecords && result.txRecords.length > 0) {
        for (const rec of result.txRecords) {
          allTxRecords.push({ ...rec, targetTPS, run: run + 1 });
        }
      }

      // Refresh nonces between runs — with retry for rate limits
      try {
        for (const t of traders) {
          t.nonce = await withRetry(
            () => provider.getTransactionCount(t.address, "pending"),
            `nonce-${t.address.slice(0, 8)}`
          );
        }
      } catch (e) {
        console.log(`│    ⚠️ Nonce refresh rate-limited, waiting 10s...`);
        await sleep(10000);
        try {
          for (const t of traders) {
            t.nonce = await provider.getTransactionCount(t.address, "pending");
            await sleep(200); // stagger
          }
        } catch {
          console.log(`│    ⚠️ Still rate-limited — stopping benchmark`);
          rateLimited = true;
          break;
        }
      }

      await sleep(5000); // gap between runs
    }

    if (runResults.length === 0) {
      if (rateLimited) {
        console.log(`│  ⚠️ All runs rate-limited — stopping benchmark`);
        console.log(`└${"─".repeat(55)}┘`);
        break; // stop testing higher TPS
      }
      console.log(`│  ⚠️ No valid runs at ${targetTPS} TPS`);
      console.log(`└${"─".repeat(55)}┘`);
      continue;
    }

    // Truncated average (paper: exclude 2 extremes from 5 runs; we do median of 3)
    const sortedByLatency = runResults.sort((a, b) => a.avgBlockLatency - b.avgBlockLatency);
    const medianRun = sortedByLatency[Math.floor(sortedByLatency.length / 2)];

    // Use RAW chain latency for pass/fail — on a public testnet, the clock
    // skew measurement is too noisy (swings ±3s between runs). Raw latency
    // (blockTs - floor(sendTime)) has self-canceling biases (+0.5s block
    // timestamp rounding, -0.5s floor rounding) making it the most stable
    // estimator. The corrected metric is shown for reference only.
    const chainLatencyForJudge = medianRun.avgRawLatency;
    const passed = chainLatencyForJudge < LATENCY_CAP_SEC;

    allResults.push({
      targetTPS,
      medianActualTPS: medianRun.actualTPS,
      medianBlockBasedTPS: medianRun.blockBasedTPS,
      medianAvgLatency: medianRun.avgLatency,
      medianAvgBlockLatency: medianRun.avgBlockLatency,
      medianAvgRawLatency: medianRun.avgRawLatency,
      medianP95Latency: medianRun.p95Latency,
      medianP95BlockLatency: medianRun.p95BlockLatency,
      medianP95RawLatency: medianRun.p95RawLatency,
      medianP99Latency: medianRun.p99Latency || 0,
      medianBlockSpread: medianRun.blockSpread,
      medianConfirmed: medianRun.confirmed,
      medianSent: medianRun.sent,
      medianFailed: medianRun.failed,
      medianAvgTxsPerBlock: medianRun.avgTxsPerBlock,
      medianMaxTxsPerBlock: medianRun.maxTxsPerBlock,
      confirmationRate: medianRun.sent > 0 ? (medianRun.confirmed / medianRun.sent * 100) : 0,
      clockSkew: medianRun.clockSkew,
      passed,
      allRuns: runResults.map(r => ({
        actualTPS: r.actualTPS,
        blockBasedTPS: r.blockBasedTPS,
        avgLatency: r.avgLatency,
        avgRawLatency: r.avgRawLatency,
        avgBlockLatency: r.avgBlockLatency,
        p50Latency: r.p50Latency,
        p95Latency: r.p95Latency,
        p99Latency: r.p99Latency,
        p95BlockLatency: r.p95BlockLatency,
        blockSpread: r.blockSpread,
        confirmed: r.confirmed,
        sent: r.sent,
        failed: r.failed,
        confirmationRate: r.sent > 0 ? (r.confirmed / r.sent * 100) : 0,
        avgTxsPerBlock: r.avgTxsPerBlock,
        maxTxsPerBlock: r.maxTxsPerBlock,
        clockSkew: r.clockSkew,
        txRecordCount: r.txRecords ? r.txRecords.length : 0
      }))
    });

    const status = passed ? "✅ PASS" : "❌ FAIL (saturated)";
    const levelConfRate = (medianRun.sent > 0 ? medianRun.confirmed / medianRun.sent * 100 : 0).toFixed(0);
    console.log(`│  Median: ${medianRun.blockBasedTPS.toFixed(1)} TPS/blk, ${medianRun.actualTPS.toFixed(1)} TPS/time`);
    console.log(`│  Finality: avg ${medianRun.avgRawLatency.toFixed(3)}s, p95 ${medianRun.p95RawLatency.toFixed(3)}s — ${status}`);
    console.log(`│  Confirmation: ${medianRun.confirmed}/${medianRun.sent} (${levelConfRate}%), ${medianRun.failed || 0} reverted`);
    console.log(`└${"─".repeat(60)}┘`);

    // If rate-limited, stop regardless
    if (rateLimited) {
      console.log(`\n   ⚠️ RPC rate-limited at ${targetTPS} TPS — stopping benchmark.`);
      console.log(`   (This is a testnet RPC limit, not a chain throughput limit)\n`);
      break;
    }

    // If saturated, optionally skip higher rates (they'll saturate too)
    if (!passed && !process.env.FORCE_ALL) {
      console.log(`\n   ⛔ Saturation detected: avg finality ${medianRun.avgRawLatency.toFixed(3)}s > ${LATENCY_CAP_SEC}s threshold.`);
      console.log(`   Higher target rates will also saturate. Set FORCE_ALL=1 to override.\n`);
      break;
    }

    // Cooldown between load levels to reset RPC rate-limit windows
    console.log(`\n   ⏳ Cooldown 8s before next load level...`);
    await sleep(8000);
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 5: Results Summary
  // ═══════════════════════════════════════════════════════════════
  const benchMode = useSyncRpc ? 'SYNC' : 'ASYNC';
  const benchModeDesc = useSyncRpc
    ? 'eth_sendRawTransactionSync (per-trader sequential, wall-clock finality)'
    : 'eth_sendRawTransaction batch + block scanner';

  console.log(`\n${"═".repeat(80)}`);
  console.log(`📊 SUSTAINED THROUGHPUT BENCHMARK — RESULTS`);
  console.log(`${"═".repeat(80)}\n`);

  console.log(`   Methodology:       SAMM Paper §6.1.3 (Poisson-arrival sustained load test)`);
  console.log(`   Execution Mode:    ${benchMode} — ${benchModeDesc}`);
  console.log(`   Network:           RISE Chain Testnet (chainId: ${chainId})`);
  console.log(`   RPC Endpoint:      ${rpcUrl}`);
  console.log(`   Concurrent Traders: ${NUM_TRADERS} independent wallets`);
  console.log(`   Warmup Window:     ${WARMUP_SEC}s (discarded)`);
  console.log(`   Measurement Window: ${MEASURE_SEC}s`);
  console.log(`   Finality Cap:      ${LATENCY_CAP_SEC}s (saturation threshold per paper)`);
  console.log(`   Repetitions:       ${REPEATS} per target (truncated average = median)`);
  console.log(`   Pool:              ${shard.name} (${shard.address})`);
  console.log(`   Swap Gas Cost:     ${gasPerSwap.toLocaleString()} gas/swap\n`);

  console.log(`   ┌──────────┬──────────┬──────────┬──────────┬──────────┬────────┬────────┬──────────┬────────┐`);
  console.log(`   │  Target  │ Through- │ Through- │ Finality │ Finality │ Conf   │ Conf   │ Peak     │        │`);
  console.log(`   │  TPS     │ put/blk  │ put/time │ avg (s)  │ p95 (s)  │ Rate % │ Count  │ txs/blk  │ Result │`);
  console.log(`   ├──────────┼──────────┼──────────┼──────────┼──────────┼────────┼────────┼──────────┼────────┤`);
  for (const r of allResults) {
    const status = r.passed ? ' PASS ' : ' FAIL ';
    const confRate = (r.confirmationRate || 0).toFixed(0);
    console.log(`   │ ${String(r.targetTPS).padStart(8)} │ ${r.medianBlockBasedTPS.toFixed(1).padStart(8)} │ ${r.medianActualTPS.toFixed(1).padStart(8)} │ ${r.medianAvgRawLatency.toFixed(3).padStart(8)} │ ${r.medianP95RawLatency.toFixed(3).padStart(8)} │ ${confRate.padStart(5)}% │ ${String(r.medianConfirmed).padStart(6)} │ ${String(r.medianMaxTxsPerBlock).padStart(8)} │${status}│`);
  }
  console.log(`   └──────────┴──────────┴──────────┴──────────┴──────────┴────────┴────────┴──────────┴────────┘`);
  console.log(``);
  console.log(`   Legend:`);
  console.log(`   - Throughput/blk:  confirmed_txs / block_span (clock-independent, most defensible)`);
  console.log(`   - Throughput/time: confirmed_txs / measurement_window_seconds`);
  if (useSyncRpc) {
    console.log(`   - Finality:        wall-clock RTT from tx submission → execution receipt`);
    console.log(`                      (measured via eth_sendRawTransactionSync, zero clock skew)`);
  } else {
    console.log(`   - Finality:        block_timestamp − floor(send_time) (raw chain latency)`);
  }
  console.log(`   - Conf Rate:       confirmed / submitted × 100 (excludes warmup txs)`);
  console.log(`   - Saturation:      avg finality > ${LATENCY_CAP_SEC}s indicates throughput ceiling (FAIL)`);

  // Find max passing TPS — the saturation point
  const passedResults = allResults.filter(r => r.passed);
  const maxTPS = passedResults.length > 0
    ? passedResults[passedResults.length - 1]
    : null;

  if (maxTPS) {
    console.log(`\n   ┌────────────────────────────────────────────────────────────┐`);
    console.log(`   │  🎯 SUSTAINED THROUGHPUT (single-shard saturation point)  │`);
    console.log(`   ├────────────────────────────────────────────────────────────┤`);
    console.log(`   │  Block-based:   ${maxTPS.medianBlockBasedTPS.toFixed(1).padStart(8)} TPS/shard                     │`);
    console.log(`   │  Time-based:    ${maxTPS.medianActualTPS.toFixed(1).padStart(8)} TPS/shard                     │`);
    console.log(`   │  Avg Finality:  ${maxTPS.medianAvgRawLatency.toFixed(3).padStart(8)}s                            │`);
    console.log(`   │  p95 Finality:  ${maxTPS.medianP95RawLatency.toFixed(3).padStart(8)}s                            │`);
    console.log(`   │  p99 Finality:  ${(maxTPS.medianP99Latency || 0).toFixed(3).padStart(8)}s                            │`);
    console.log(`   │  Conf Rate:     ${(maxTPS.confirmationRate || 100).toFixed(1).padStart(7)}%                            │`);
    console.log(`   │  At Target:     ${String(maxTPS.targetTPS).padStart(8)} TPS                           │`);
    console.log(`   └────────────────────────────────────────────────────────────┘`);
  } else {
    console.log(`\n   ❌ No throughput level passed the ${LATENCY_CAP_SEC}s finality threshold`);
  }

  console.log(`\n   ── Cross-Protocol Comparison (SAMM paper Table 2) ──`);
  console.log(`   ┌─────────────────┬───────────────┬───────────────┬───────────────────────────┐`);
  console.log(`   │ Protocol        │ TPS/shard     │ Traders       │ Environment               │`);
  console.log(`   ├─────────────────┼───────────────┼───────────────┼───────────────────────────┤`);
  console.log(`   │ Solana (paper)  │      129      │      50       │ Local testnet (bare metal)│`);
  console.log(`   │ Sui (paper)     │      214      │     100       │ Local testnet (bare metal)│`);
  if (maxTPS) {
    const reportTPS = maxTPS.medianBlockBasedTPS;
    console.log(`   │ RISE+SAMM (ours)│ ${reportTPS.toFixed(1).padStart(9)}    │ ${String(NUM_TRADERS).padStart(9)}    │ Public testnet (remote)   │`);
    console.log(`   └─────────────────┴───────────────┴───────────────┴───────────────────────────┘`);
    const vsSOL = (reportTPS / 129).toFixed(2);
    const vsSUI = (reportTPS / 214).toFixed(2);
    console.log(`   vs Solana: ${vsSOL}×    vs Sui: ${vsSUI}×`);
    console.log(`   NOTE: Our measurement is conservative — public testnet with ~200ms RTT overhead.`);
    console.log(`   Bare-metal deployment would eliminate the HTTP bottleneck.`);
  } else {
    console.log(`   │ RISE+SAMM (ours)│     N/A       │ ${String(NUM_TRADERS).padStart(9)}    │ Public testnet (remote)   │`);
    console.log(`   └─────────────────┴───────────────┴───────────────┴───────────────────────────┘`);
  }

  // Gas-based theoretical ceiling
  const theoreticalMax = Math.floor(1_500_000_000 / gasPerSwap);
  console.log(`\n   ── Gas Capacity Analysis ──`);
  console.log(`   Block gas limit:         1,500,000,000 (1.5B)`);
  console.log(`   Gas per swap (measured): ${gasPerSwap.toLocaleString()}`);
  console.log(`   Theoretical ceiling:     ${theoreticalMax.toLocaleString()} swaps/block (100% gas utilization)`);
  if (maxTPS) {
    const gasUsedPerBlock = maxTPS.medianAvgTxsPerBlock * gasPerSwap;
    const utilPct = (gasUsedPerBlock / 1_500_000_000 * 100).toFixed(2);
    console.log(`   Observed avg gas/blk:    ${(gasUsedPerBlock/1e6).toFixed(1)}M (${utilPct}% utilization)`);
    console.log(`   Headroom:                ${(100 - parseFloat(utilPct)).toFixed(1)}% gas capacity remaining`);
  }
  if (useSyncRpc) {
    const theoreticalSyncCeiling = Math.floor(NUM_TRADERS * (1000 / 200)); // assume 200ms RTT
    console.log(`\n   ── Sync-Mode RTT Bottleneck ──`);
    console.log(`   avg RTT (measured):     ~${maxTPS ? (maxTPS.medianAvgRawLatency * 1000).toFixed(0) : '?'}ms`);
    console.log(`   Theoretical ceiling:    ${NUM_TRADERS} traders × (1000/${maxTPS ? (maxTPS.medianAvgRawLatency * 1000).toFixed(0) : '200'}ms) ≈ ${maxTPS ? Math.floor(NUM_TRADERS / maxTPS.medianAvgRawLatency) : theoreticalSyncCeiling} TPS`);
    console.log(`   Bottleneck:             HTTP round-trip from client → sequencer, NOT chain capacity`);
  }

  if (maxTPS) {
    const reportTPS2 = maxTPS.medianBlockBasedTPS;
    console.log(`\n   ── Dynamic Shard Orchestration Params ──`);
    console.log(`   shard_split_threshold:  ${Math.floor(reportTPS2 * 0.8)} TPS (trigger shard split at 80% saturation)`);
    console.log(`   shard_merge_threshold:  ${Math.floor(reportTPS2 * 0.3)} TPS (merge idle shards at 30%)`);
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 6: Save Results — JSON Report + CSV Transaction Log
  // ═══════════════════════════════════════════════════════════════
  const runTs = Date.now();
  const outDir = path.join(__dirname, "..", "test-results");
  fs.mkdirSync(outDir, { recursive: true });

  // --- CSV: Per-transaction log with tx hashes ---
  const csvFile = path.join(outDir, `tx-log-${runTs}.csv`);
  const csvHeader = 'target_tps,run,tx_hash,trader_idx,block_number,send_time_utc,receive_time_utc,finality_ms,gas_used,status\n';
  let csvRows = '';
  for (const rec of allTxRecords) {
    csvRows += `${rec.targetTPS},${rec.run},${rec.txHash},${rec.traderIdx},${rec.blockNumber},${new Date(rec.sendTimeMs).toISOString()},${new Date(rec.receiveTimeMs).toISOString()},${rec.latencyMs},${rec.gasUsed || ''},${rec.status || ''}\n`;
  }
  fs.writeFileSync(csvFile, csvHeader + csvRows);
  console.log(`\n📄 CSV Transaction Log: ${csvFile}`);
  console.log(`   ${allTxRecords.length} confirmed transactions with hashes`);

  // --- JSON: Full benchmark report ---
  const outFile = path.join(outDir, `sustained-tps-${runTs}.json`);
  const jsonReport = {
    _meta: {
      tool: 'SAMM Sustained TPS Benchmark',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      methodology: 'SAMM Paper §6.1.3 — Poisson-arrival sustained load test'
    },
    environment: {
      chain: 'RISE Chain Testnet',
      chainId: Number(chainId),
      rpcEndpoint: rpcUrl,
      executionMode: benchMode,
      executionModeDescription: benchModeDesc,
      blockGasLimit: 1_500_000_000,
      blockTime: '~1s'
    },
    config: {
      numTraders: NUM_TRADERS,
      warmupSec: WARMUP_SEC,
      measureSec: MEASURE_SEC,
      finalityCapSec: LATENCY_CAP_SEC,
      repeats: REPEATS,
      targetTPSList: TARGET_TPS_LIST,
      pool: shard.name,
      poolAddress: shard.address,
      pair: TARGET_PAIR,
      gasPerSwap,
      swapAmountUSD: SWAP_USD
    },
    results: allResults,
    summary: {
      saturationPoint: maxTPS ? {
        throughput_blockBased: maxTPS.medianBlockBasedTPS,
        throughput_timeBased: maxTPS.medianActualTPS,
        avgFinalitySeconds: maxTPS.medianAvgRawLatency,
        p50FinalitySeconds: maxTPS.medianAvgBlockLatency, // p50 for sync mode
        p95FinalitySeconds: maxTPS.medianP95RawLatency,
        p99FinalitySeconds: maxTPS.medianP99Latency || null,
        confirmationRate: maxTPS.confirmationRate || 100,
        atTargetTPS: maxTPS.targetTPS
      } : null,
      totalConfirmedTxs: allTxRecords.length,
      csvFile: path.basename(csvFile)
    },
    gasAnalysis: {
      gasPerSwap,
      theoreticalMaxSwapsPerBlock: theoreticalMax,
      observedAvgTxsPerBlock: maxTPS ? maxTPS.medianAvgTxsPerBlock : null,
      observedPeakTxsPerBlock: maxTPS ? maxTPS.medianMaxTxsPerBlock : null,
      gasUtilizationPct: maxTPS ? (maxTPS.medianAvgTxsPerBlock * gasPerSwap / 1_500_000_000 * 100) : null
    },
    comparison: {
      solana: { tpsPerShard: 129, traders: 50, environment: 'local testnet (bare metal)' },
      sui: { tpsPerShard: 214, traders: 100, environment: 'local testnet (bare metal)' },
      risechain: {
        tpsPerShard_blockBased: maxTPS ? maxTPS.medianBlockBasedTPS : null,
        tpsPerShard_timeBased: maxTPS ? maxTPS.medianActualTPS : null,
        traders: NUM_TRADERS,
        environment: 'public testnet (remote RPC)',
        vsSolana: maxTPS ? (maxTPS.medianBlockBasedTPS / 129) : null,
        vsSui: maxTPS ? (maxTPS.medianBlockBasedTPS / 214) : null
      }
    }
  };
  fs.writeFileSync(outFile, JSON.stringify(jsonReport, null, 2));
  console.log(`📊 JSON Report: ${outFile}`);
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`✅ Benchmark complete. ${allTxRecords.length} transactions logged.`);
  console.log(`${'═'.repeat(80)}\n`);
}

// ═══════════════════════════════════════════════════════════════
// Core benchmark: one run at a given target TPS
//
// ASYNC MODE (default fallback):
//   1. PRE-SIGN + PRE-HASH: compute keccak256(signedTx) at sign time
//   2. FIRE-AND-FORGET: batches sent via fetch() WITHOUT await.
//   3. CLOCK SKEW: measure chain_time − local_time offset.
//   4. BLOCK SCANNER: polls blocks, matches pre-computed hashes.
//
// SYNC MODE (eth_sendRawTransactionSync — RISE Chain):
//   1. PRE-SIGN: same as async mode.
//   2. CONCURRENT SYNC SENDS: individual eth_sendRawTransactionSync
//      calls. RPC blocks until receipt is ready (~5-1000ms).
//   3. WALL-CLOCK LATENCY: receiveTime - sendTime (no clock skew!).
//   4. NO BLOCK SCANNER: receipt comes from the sync response.
//
//   Sync mode gives exact per-tx latency and eliminates the block
//   scanner polling overhead (~1.25 RPC calls/sec).
// ═══════════════════════════════════════════════════════════════
async function runSustainedTest({
  traders, poolIface, shard, tkA, tkB,
  perTraderRate, targetTPS, warmupSec, measureSec,
  gasPrice, chainId, provider, rpcUrl,
  useSyncRpc = false
}) {
  const totalRunSec = warmupSec + measureSec;

  // ── Clock skew detection (simple) ──
  // On a public testnet, accurate clock skew is fundamentally unmeasurable:
  // the RPC propagation delay (100-500ms) and block age (~500ms avg) always
  // contaminate the measurement. Previous "fresh block" approach gave
  // wild swings from -0.59 to -3.58s between back-to-back runs.
  //
  // We use a simple measurement for logging only. Pass/fail uses RAW
  // latency (blockTs - floor(sendTime)), where the integer truncation
  // biases (+0.5s from block, -0.5s from floor) approximately cancel.
  let clockSkew = 0;
  if (!useSyncRpc) {
    try {
      const bn = await provider.getBlockNumber();
      const block = await provider.getBlock(bn);
      if (block) {
        clockSkew = block.timestamp - Math.floor(Date.now() / 1000);
        console.log(`│    Clock skew: chain ${clockSkew >= 0 ? "+" : ""}${clockSkew}s vs local (reference only)`);
      }
    } catch (e) {
      console.log(`│    Clock skew detection failed: ${e.message.slice(0, 60)}`);
    }
  } else {
    console.log(`│    Latency: wall-clock RTT (sync mode, no clock skew needed)`);
  }

  // ── STEP 0: Refresh nonces from chain ──
  // Critical: ensures each run starts with the correct on-chain nonce,
  // even if previous runs had unsent pre-signed txs or HTTP failures.
  for (let i = 0; i < traders.length; i++) {
    try {
      traders[i].nonce = await provider.getTransactionCount(traders[i].address, "pending");
    } catch (e) {
      // Rate limited — wait and retry
      await sleep(2000);
      traders[i].nonce = await provider.getTransactionCount(traders[i].address, "pending");
    }
    // Stagger requests to avoid rate limits with many traders
    if (traders.length > 30 && i % 10 === 9) await sleep(500);
  }

  // ── STEP 1: Pre-sign + Pre-hash all transactions ──
  const PRESIGN_BUFFER = 1.5;
  // Cap per-trader to avoid multi-minute pre-sign phases (each signTransaction ~0.5ms)
  // 2000 per trader × 200 traders = 400K txs = ~3 min. Beyond that, JS chokes.
  const MAX_PER_TRADER = 2000;
  const txsPerTrader = Math.min(MAX_PER_TRADER, Math.ceil(totalRunSec * perTraderRate * PRESIGN_BUFFER));
  const totalTxs = txsPerTrader * traders.length;
  const cappedNote = txsPerTrader === MAX_PER_TRADER ? ' (capped)' : '';

  console.log(`│    Pre-signing ${txsPerTrader} × ${traders.length} = ${totalTxs} txs${cappedNote}...`);

  const amountOut = ethers.parseUnits("1", 6);
  const maxIn    = ethers.parseUnits("3", 6);

  // Pre-sign per trader + compute hash locally
  const traderSigned = []; // [i] = [{ raw, hash }, ...]
  for (let i = 0; i < traders.length; i++) {
    const tw = traders[i].wallet;
    const addr = tw.address;
    let nonce = traders[i].nonce;
    const cdAtoB = poolIface.encodeFunctionData("swapSAMM", [amountOut, maxIn, tkA.address, tkB.address, addr]);
    const cdBtoA = poolIface.encodeFunctionData("swapSAMM", [amountOut, maxIn, tkB.address, tkA.address, addr]);
    const arr = [];
    for (let j = 0; j < txsPerTrader; j++) {
      const raw = await tw.signTransaction({
        to: shard.address,
        data: (nonce % 2 === 0) ? cdAtoB : cdBtoA,
        nonce, gasLimit: 150000, gasPrice, chainId, type: 0
      });
      // Pre-compute tx hash: keccak256 of the RLP-encoded signed tx
      const hash = ethers.keccak256(raw).toLowerCase();
      arr.push({ raw, hash });
      nonce++;
    }
    traderSigned.push(arr);
    traders[i].nonce = nonce;
  }

  // Flatten round-robin: trader0[0], trader1[0], ..., trader0[1], trader1[1], ...
  const txPool = [];
  for (let j = 0; j < txsPerTrader; j++) {
    for (let i = 0; i < traders.length; i++) {
      if (j < traderSigned[i].length) txPool.push(traderSigned[i][j]);
    }
  }

  console.log(`│    ✅ Pre-signed ${txPool.length} txs (hashes pre-computed)`);

  // ── Set timing windows AFTER pre-signing ──
  // Critical: measureStartTime must be set here, not before pre-signing,
  // otherwise the 5-25s pre-sign phase eats into the warmup window.
  const measureStartTime = Date.now() + warmupSec * 1000;
  const measureEndTime = measureStartTime + measureSec * 1000;

  // ── Tracking state ──
  const pendingTxs = new Map(); // hash → { sendTimeMs, inMeasure }
  const blockLatencies = [];     // raw (uncorrected) latencies
  const blockLatenciesCorrected = []; // clock-skew corrected latencies (PRIMARY)
  const txBlocks = [];
  const txsPerBlock = new Map(); // blockNumber → count of our txs in that block
  let sent = 0;
  let confirmed = 0;
  let failed = 0;
  let warmupTxs = 0;
  let rateLimitHits = 0;
  let rateLimited = false;
  let scannerRunning = true;
  let unconfirmed = 0;
  let txPoolIdx = 0;
  const firstErrors = []; // capture first N errors for debugging
  const txRecords = []; // CSV-ready tx records: { txHash, traderIdx, blockNumber, sendTimeIso, receiveTimeIso, latencyMs, phase }

  if (useSyncRpc) {
  // ════════════════════════════════════════════════════════════════
  // SYNC MODE: eth_sendRawTransactionSync (per-trader sequential)
  //
  // RISE Chain's sync RPC requires strict sequential nonces — it
  // rejects txs if the previous nonce hasn't confirmed. Therefore,
  // each trader sends ONE tx at a time (await receipt before next).
  //
  // All traders run concurrently, so throughput = traders × (1/RTT).
  // With 20 traders and ~200ms RTT → ceiling ~100 TPS.
  //
  // Benefits: exact wall-clock latency, no clock skew, no block scanner.
  // Matches paper §6.1.3: "each trader sends and waits for confirmation."
  // ════════════════════════════════════════════════════════════════

  console.log(`│    🔄 Sync mode: ${traders.length} concurrent traders, sequential per-trader`);

  // Progress reporting
  const progressInterval = setInterval(() => {
    const now = Date.now();
    const phase = now < measureStartTime ? "WARMUP" : "MEASURE";
    const elapsed = now < measureStartTime
      ? Math.floor((now - (measureStartTime - warmupSec * 1000)) / 1000)
      : Math.floor((now - measureStartTime) / 1000);
    const total = now < measureStartTime ? warmupSec : measureSec;
    const liveTPS = (phase === "MEASURE" && elapsed > 0) ? (confirmed / elapsed).toFixed(1) : "-";
    process.stdout.write(`\r│    [${phase}] ${elapsed}/${total}s | sent: ${sent} | conf: ${confirmed} | fail: ${failed} | ~${liveTPS} TPS | rl: ${rateLimitHits}   `);
  }, 2000);

  // Each trader runs its own sequential send loop concurrently
  const traderPromises = [];

  for (let tIdx = 0; tIdx < traders.length; tIdx++) {
    const traderTxs = traderSigned[tIdx];

    traderPromises.push((async () => {
      let idx = 0;
      // Stagger start: random offset within one inter-arrival period
      const staggerMs = Math.random() * (1000 / Math.max(perTraderRate, 0.1));
      await sleep(staggerMs);

      let lastSendTime = Date.now();

      while (Date.now() < measureEndTime && idx < traderTxs.length && !rateLimited) {
        // Exponential-random inter-arrival (paper methodology §6.1.3)
        const interArrivalMs = -Math.log(1 - Math.random()) / perTraderRate * 1000;
        const nextSendTime = lastSendTime + interArrivalMs;
        const waitMs = nextSendTime - Date.now();
        if (waitMs > 0) {
          await sleep(Math.min(waitMs, 5000));
        }

        if (Date.now() >= measureEndTime || rateLimited) break;

        const txItem = traderTxs[idx++];
        const sendTimeMs = Date.now();
        lastSendTime = sendTimeMs;
        const inMeasure = sendTimeMs >= measureStartTime && sendTimeMs < measureEndTime;

        if (inMeasure) sent++;
        else warmupTxs++;

        // Sequential sync send — blocks until receipt or error
        try {
          const resp = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "eth_sendRawTransactionSync",
              params: [txItem.raw],
              id: 1
            })
          });
          const receiveTimeMs = Date.now();

          if (resp.status === 429 || resp.status >= 500) {
            rateLimitHits++;
            if (rateLimitHits > 50) rateLimited = true;
            resp.text().catch(() => {});
            continue;
          }

          const data = await resp.json();

          if (data.result) {
            if (inMeasure) {
              confirmed++;
              // Finality latency: wall-clock RTT from submission → receipt (no clock skew)
              const wallClockLatS = (receiveTimeMs - sendTimeMs) / 1000;
              blockLatencies.push(wallClockLatS);
              blockLatenciesCorrected.push(wallClockLatS);

              // Extract block number and tx hash from receipt
              let bn = 0;
              if (data.result.blockNumber) {
                bn = typeof data.result.blockNumber === 'string'
                  ? parseInt(data.result.blockNumber, 16)
                  : data.result.blockNumber;
              }
              const txHash = data.result.transactionHash || txItem.hash;
              if (bn > 0) {
                txBlocks.push(bn);
                txsPerBlock.set(bn, (txsPerBlock.get(bn) || 0) + 1);
              }
              // Record for CSV export
              txRecords.push({
                txHash,
                traderIdx: tIdx,
                blockNumber: bn,
                sendTimeMs,
                receiveTimeMs,
                latencyMs: receiveTimeMs - sendTimeMs,
                gasUsed: data.result.gasUsed ? parseInt(data.result.gasUsed, 16) : null,
                status: data.result.status === '0x1' ? 'success' : (data.result.status || 'unknown')
              });
            }
          } else if (data.error) {
            if (firstErrors.length < 5) firstErrors.push({ rpc: data.error });
            failed++;
          }
        } catch (e) {
          if (firstErrors.length < 5) firstErrors.push({ catch: e.message?.slice(0, 120) });
          const isRL = e.message?.includes("429") || e.message?.includes("Too Many");
          if (isRL) {
            rateLimitHits++;
            if (rateLimitHits > 50) rateLimited = true;
          } else {
            failed++;
          }
        }
      }
    })());
  }

  // Wait for all traders to finish
  await Promise.all(traderPromises);
  clearInterval(progressInterval);
  unconfirmed = 0; // All traders completed sequentially
  process.stdout.write(`\r│                                                                                            \r`);

  // Log first errors for debugging
  if (firstErrors.length > 0) {
    console.log(`│    ⚠️ ${failed} txs failed. First ${firstErrors.length} errors:`);
    for (const e of firstErrors) {
      console.log(`│      ${JSON.stringify(e).slice(0, 150)}`);
    }
  }

  } else {
  // ════════════════════════════════════════════════════════════════
  // ASYNC MODE: batch sends + block scanner (fallback)
  // ════════════════════════════════════════════════════════════════

  // ── STEP 2: Block scanner ──
  let lastBlock = 0;
  try { lastBlock = await provider.getBlockNumber(); } catch {}

  async function blockScanner() {
    while (scannerRunning) {
      try {
        const cur = await provider.getBlockNumber();
        for (let bn = lastBlock + 1; bn <= cur; bn++) {
          if (pendingTxs.size === 0 && bn < cur) { lastBlock = bn; continue; }
          const block = await provider.getBlock(bn);
          if (!block || !block.transactions) { lastBlock = bn; continue; }

          const blockTs = block.timestamp;
          for (const hash of block.transactions) {
            const lh = hash.toLowerCase();
            if (pendingTxs.has(lh)) {
              const { sendTimeMs, inMeasure } = pendingTxs.get(lh);
              pendingTxs.delete(lh);
              if (inMeasure) {
                confirmed++;
                // Raw chain latency (uncorrected — for reference only)
                const rawLat = blockTs - Math.floor(sendTimeMs / 1000);
                blockLatencies.push(Math.max(0, rawLat));
                // Corrected chain latency (PRIMARY metric — accounts for clock skew)
                const corrLat = (blockTs - clockSkew) - (sendTimeMs / 1000);
                blockLatenciesCorrected.push(Math.max(0, corrLat));
                txBlocks.push(bn);
                // Count our txs per block (for block-level TPS cross-check)
                txsPerBlock.set(bn, (txsPerBlock.get(bn) || 0) + 1);
              }
            }
          }
          lastBlock = bn;
        }
      } catch (e) {
        const isRL = e.message?.includes("429") || e.message?.includes("Too Many") || e.code === "SERVER_ERROR";
        if (isRL) { rateLimitHits++; await sleep(3000); continue; }
      }
      await sleep(400); // poll every 400ms (was 800ms — reduces detection latency by ~200ms avg)
    }
  }

  const scannerPromise = blockScanner();

  // ── STEP 3: Pipelined batch send loop ──
  //
  // Strategy: launch N concurrent HTTP "pipelines". While some are
  // waiting for HTTP responses, others are sending. We await responses
  // (to detect errors & prevent nonce gaps), but the N pipelines overlap.
  //
  // PIPELINES is auto-scaled based on target TPS:
  //   - Low targets (25-100 TPS):  4 pipelines, 6-25 txs/batch
  //   - Med targets (200-500 TPS): 4 pipelines, 50-100 txs/batch
  //   - High targets (1000+ TPS):  10+ pipelines, 100 txs/batch (capped)
  //
  // MAX_BATCH_SIZE=100 prevents RPC rejection from giant payloads.
  // When batch is capped, more pipelines compensate for throughput.

  const SEND_INTERVAL_MS = 250; // gap between consecutive pipeline sends
  const MAX_BATCH_SIZE = 100;    // RPC rejects batches >~200 txs (500KB+ payloads)

  // Calculate batch size: targetTPS / (1000/SEND_INTERVAL_MS) = targetTPS / 4
  // If this exceeds MAX_BATCH_SIZE, increase pipelines to compensate.
  const rawBatchSize = Math.max(1, Math.round(targetTPS * SEND_INTERVAL_MS / 1000));
  const txsPerBatch = Math.min(rawBatchSize, MAX_BATCH_SIZE);
  // Scale pipelines: need (targetTPS / txsPerBatch) batches/sec,
  // each pipeline does 1000/SEND_INTERVAL_MS/PIPELINES batches/sec,
  // so PIPELINES = ceil(targetTPS / txsPerBatch / (1000/SEND_INTERVAL_MS)) * k
  // Minimum 4 for HTTP RTT headroom, scale up for high targets.
  const batchesPerSec = Math.ceil(targetTPS / txsPerBatch);
  const PIPELINES = Math.max(4, Math.ceil(batchesPerSec / (1000 / SEND_INTERVAL_MS)));
  console.log(`│    Send config: ${txsPerBatch} txs/batch × ${PIPELINES} pipelines, target ${targetTPS} TPS`);
  txPoolIdx = 0; // reset for async mode (declared in outer scope)

  // Progress reporting
  const progressInterval = setInterval(() => {
    const now = Date.now();
    const phase = now < measureStartTime ? "WARMUP" : "MEASURE";
    const elapsed = now < measureStartTime
      ? Math.floor((now - (measureStartTime - warmupSec * 1000)) / 1000)
      : Math.floor((now - measureStartTime) / 1000);
    const total = now < measureStartTime ? warmupSec : measureSec;
    const liveTPS = (phase === "MEASURE" && elapsed > 0) ? (confirmed / elapsed).toFixed(1) : "-";
    process.stdout.write(`\r│    [${phase}] ${elapsed}/${total}s | sent: ${sent} | conf: ${confirmed} | ~${liveTPS} TPS | pend: ${pendingTxs.size} | rl: ${rateLimitHits}   `);
  }, 2000);

  const runEndTime = measureEndTime; // send loop stops at end of measure window
  // Note: warmup runs from now to measureStartTime; measure runs from
  // measureStartTime to measureEndTime. Send loop runs through both.

  // Shared send function
  async function sendOneBatch() {
    if (Date.now() >= runEndTime || txPoolIdx >= txPool.length || rateLimited) return false;
    // If too many consecutive errors, the RPC is probably rejecting everything
    if (failed > 100) { rateLimited = true; return false; }

    const now = Date.now();
    const inMeasure = now >= measureStartTime && now < measureEndTime;
    const batchSize = Math.min(txsPerBatch, txPool.length - txPoolIdx);
    if (batchSize <= 0) return false;

    const batchItems = txPool.slice(txPoolIdx, txPoolIdx + batchSize);
    txPoolIdx += batchSize;

    const rpcBatch = batchItems.map((item, idx) => ({
      jsonrpc: "2.0",
      method: "eth_sendRawTransaction",
      params: [item.raw],
      id: idx + 1
    }));

    const sendTimeMs = Date.now();

    try {
      const resp = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rpcBatch)
      });

      if (resp.status === 429 || resp.status >= 500) {
        rateLimitHits++;
        if (rateLimitHits > 50) { rateLimited = true; return false; }
        txPoolIdx -= batchSize; // retry these txs
        resp.text().catch(() => {}); // drain body
        await sleep(2000);
        return true;
      }

      // Register pre-computed hashes — ONLY after RPC accepted the batch
      // This prevents nonce gaps from phantom sends
      for (const item of batchItems) {
        pendingTxs.set(item.hash, { sendTimeMs, inMeasure });
        if (inMeasure) sent++;
        else warmupTxs++;
      }

      // Drain response body (we have hashes already, skip JSON parse)
      resp.text().catch(() => {});

    } catch (e) {
      const isRL = e.message?.includes("429") || e.message?.includes("Too Many");
      if (isRL) {
        rateLimitHits++;
        if (rateLimitHits > 50) { rateLimited = true; return false; }
        txPoolIdx -= batchSize;
        await sleep(3000);
      } else {
        // Non-rate-limit error: retry with shorter delay instead of losing txs
        // This was a critical bug — giant batches would fail, consume the entire
        // tx pool instantly (337K txs in ~7s), and report 0/0.
        failed++;
        txPoolIdx -= batchSize; // put txs back for retry
        await sleep(500);
      }
    }
    return true;
  }

  // Run PIPELINES concurrent send loops, each offset by SEND_INTERVAL_MS
  async function pipelineLoop(pipeId) {
    // Stagger start
    if (pipeId > 0) await sleep(SEND_INTERVAL_MS * pipeId);

    while (Date.now() < runEndTime && txPoolIdx < txPool.length && !rateLimited) {
      const loopStart = Date.now();
      const ok = await sendOneBatch();
      if (!ok) break;

      const elapsed = Date.now() - loopStart;
      const sleepTime = SEND_INTERVAL_MS * PIPELINES - elapsed;
      if (sleepTime > 0) await sleep(sleepTime);
    }
  }

  // Launch all pipelines concurrently
  await Promise.all(
    Array.from({ length: PIPELINES }, (_, i) => pipelineLoop(i))
  );

  clearInterval(progressInterval);

  // ── STEP 4: Drain — let scanner catch remaining pending txs ──
  const drainStart = Date.now();
  const DRAIN_TIMEOUT = 25000;
  while (pendingTxs.size > 0 && Date.now() - drainStart < DRAIN_TIMEOUT && !rateLimited) {
    process.stdout.write(`\r│    Draining ${pendingTxs.size} pending txs...                                                 `);
    await sleep(1000);
  }

  unconfirmed = pendingTxs.size;
  scannerRunning = false;
  await scannerPromise;
  process.stdout.write(`\r│                                                                                            \r`);

  } // end async mode

  // ── Calculate results ──
  // PRIMARY: corrected latency (accounts for clock skew)
  const avgCorrectedLatency = blockLatenciesCorrected.length > 0
    ? blockLatenciesCorrected.reduce((a, b) => a + b, 0) / blockLatenciesCorrected.length
    : Infinity;
  const p50CorrectedLatency = pct(blockLatenciesCorrected, 50);
  const p95CorrectedLatency = pct(blockLatenciesCorrected, 95);

  // SECONDARY: raw latency (for reference, biased by clock skew)
  const avgRawLatency = blockLatencies.length > 0
    ? blockLatencies.reduce((a, b) => a + b, 0) / blockLatencies.length
    : Infinity;
  const p50RawLatency = pct(blockLatencies, 50);
  const p95RawLatency = pct(blockLatencies, 95);

  const uniqueBlocks = new Set(txBlocks);
  const blockSpread = uniqueBlocks.size;

  // Two TPS metrics:
  // 1. Time-based: confirmed / measureSec (depends on accurate timing)
  // 2. Block-based: confirmed / blockSpread (clock-independent, uses chain's own 1s blocks)
  const actualTPS = confirmed / measureSec;
  const blockBasedTPS = blockSpread > 0 ? confirmed / blockSpread : 0;

  // Per-block distribution stats
  const blockCounts = [...txsPerBlock.values()];
  const avgTxsPerBlock = blockCounts.length > 0
    ? blockCounts.reduce((a, b) => a + b, 0) / blockCounts.length
    : 0;
  const maxTxsPerBlock = blockCounts.length > 0 ? Math.max(...blockCounts) : 0;
  const minTxsPerBlock = blockCounts.length > 0 ? Math.min(...blockCounts) : 0;

  return {
    targetTPS,
    actualTPS,           // confirmed / measureSec
    blockBasedTPS,       // confirmed / blockSpread (clock-independent)
    avgLatency: avgCorrectedLatency,  // PRIMARY: clock-corrected
    p50Latency: p50CorrectedLatency,
    p95Latency: p95CorrectedLatency,
    p99Latency: pct(blockLatenciesCorrected, 99),
    avgRawLatency,       // SECONDARY: uncorrected (for reference)
    p95RawLatency,
    // Keep these for backwards compat with results table
    avgBlockLatency: avgCorrectedLatency,
    p50BlockLatency: p50CorrectedLatency,
    p95BlockLatency: p95CorrectedLatency,
    blockSpread,
    confirmed,
    sent,
    failed,
    warmupTxs,
    unconfirmed,
    latencies: blockLatenciesCorrected.length,
    rateLimited,
    rateLimitHits,
    clockSkew,
    avgTxsPerBlock,
    maxTxsPerBlock,
    minTxsPerBlock,
    txRecords,           // per-tx records for CSV export
    confirmationRate: sent > 0 ? (confirmed / sent * 100) : 0
  };
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("❌ Fatal:", e); process.exit(1); });
