/**
 * Production Deployment v2 — FAST
 * 
 * Deploys: Tokens, Factory, Router, Orchestrator, Lean RiseChain Shards, Faucet
 * Optimizations:
 *   - Parallel token deployment
 *   - Parallel minting (all tokens at once)
 *   - Parallel shard creation (batches of 4)
 *   - CoinGecko market prices with fallback
 *   - Only essential verification tests
 *   - Includes DynamicShardOrchestrator
 *   - Includes TokenFaucet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const GAS = 12_000_000;

// CoinGecko price lookup
const GECKO = { WETH:'ethereum', USDC:'usd-coin', USDT:'tether', WBTC:'bitcoin', DAI:'dai' };
const FALLBACK = { WETH:2050, USDC:1, USDT:1, WBTC:65000, DAI:1 };

async function fetchPrices() {
  try {
    const ids = Object.values(GECKO).join(',');
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { headers:{'Accept':'application/json'}, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const p = {};
    for (const [s, gid] of Object.entries(GECKO)) p[s] = data[gid]?.usd || FALLBACK[s];
    console.log("   ✅ Live CoinGecko prices");
    return p;
  } catch (e) {
    console.log(`   ⚠️  Fallback prices (${e.message})`);
    return { ...FALLBACK };
  }
}

// Token configs — 5 tokens for 5 pairs
const TOKENS = {
  WETH: { name:"Wrapped Ether", symbol:"WETH", decimals:18 },
  USDC: { name:"USD Coin", symbol:"USDC", decimals:6 },
  USDT: { name:"Tether USD", symbol:"USDT", decimals:6 },
  WBTC: { name:"Wrapped Bitcoin", symbol:"WBTC", decimals:8 },
  DAI:  { name:"Dai Stablecoin", symbol:"DAI", decimals:18 },
};

// Pool configs — 5 pairs, 3 shards each ($250k / $1M / $5M), 15 shards, $31.25M TVL
const POOLS = [
  { a:"WETH", b:"USDC", shards:[250_000, 1_000_000, 5_000_000] },
  { a:"USDC", b:"USDT", shards:[250_000, 1_000_000, 5_000_000] },
  { a:"WETH", b:"USDT", shards:[250_000, 1_000_000, 5_000_000] },
  { a:"WBTC", b:"USDC", shards:[250_000, 1_000_000, 5_000_000] },
  { a:"USDC", b:"DAI",  shards:[250_000, 1_000_000, 5_000_000] },
];

// SAMM params
const SAMM = { beta1:-250000n, rmin:100n, rmax:2500n, c:9600n };
const FEES = { tn:25n, td:10000n, on:5n, od:10000n };

// Faucet amounts per request (base units before decimal adjustment)
const FAUCET_AMOUNTS = { WETH:3, USDC:10000, USDT:10000, WBTC:1, DAI:10000 };
const FAUCET_COOLDOWN = 3600; // 1 hour for testnet

async function main() {
  const t0 = Date.now();
  console.log("🚀 SAMM Production Deploy v2 (FAST)");
  console.log("=".repeat(70));
  
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address} | ${ethers.formatEther(bal)} ETH\n`);

  const data = {
    network:"Rise Testnet", chainId:11155931, deployer:deployer.address,
    timestamp:new Date().toISOString(), contracts:{tokens:{},shards:{}}, poolStats:{}
  };

  // ── Prices ──
  const prices = await fetchPrices();
  for (const [s,cfg] of Object.entries(TOKENS)) { cfg.price = prices[s]; console.log(`   ${s}: $${prices[s]}`); }
  data.marketPrices = { ...prices, fetchedAt:new Date().toISOString() };

  // ── Deploy core contracts (sequential — each depends on previous) ──
  console.log("\n" + "=".repeat(70));
  console.log("📦 Core Contracts");
  console.log("=".repeat(70));

  const Factory = await ethers.getContractFactory("SAMMPoolFactory");
  const factory = await Factory.deploy({gasLimit:GAS});
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log(`   ✅ Factory: ${factoryAddr}`);
  data.contracts.factory = factoryAddr;

  const Router = await ethers.getContractFactory("CrossPoolRouter");
  const router = await Router.deploy(factoryAddr, {gasLimit:GAS});
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log(`   ✅ Router:  ${routerAddr}`);
  data.contracts.router = routerAddr;

  const Orchestrator = await ethers.getContractFactory("DynamicShardOrchestrator");
  const orch = await Orchestrator.deploy(factoryAddr, {gasLimit:GAS});
  await orch.waitForDeployment();
  const orchAddr = await orch.getAddress();
  console.log(`   ✅ Orchestrator: ${orchAddr}`);
  data.contracts.orchestrator = orchAddr;

  // ── Deploy tokens — PARALLEL ──
  console.log("\n" + "=".repeat(70));
  console.log("🪙 Tokens (parallel deploy)");
  console.log("=".repeat(70));

  const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
  const tc = {}; // token contracts

  // Deploy all 8 tokens sequentially (avoid nonce conflicts on testnet)
  const symbols = Object.keys(TOKENS);
  for (const s of symbols) {
    const d = await MockERC20.deploy(TOKENS[s].name, s, TOKENS[s].decimals, {gasLimit:GAS});
    await d.waitForDeployment();
    const addr = await d.getAddress();
    tc[s] = { contract: d, address: addr, ...TOKENS[s] };
    console.log(`   ✅ ${s}: ${addr}`);
    data.contracts.tokens[s] = { address:addr, name:TOKENS[s].name, decimals:TOKENS[s].decimals, price:TOKENS[s].price };
  }

  // ── Mint tokens — PARALLEL ──
  console.log("\n" + "=".repeat(70));
  console.log("💵 Minting (parallel)");
  console.log("=".repeat(70));

  // Mint sequentially to avoid nonce conflicts — enough for $31.25M TVL + swap testing
  for (const [s,t] of Object.entries(tc)) {
    const amt = BigInt(Math.floor(500_000_000 / t.price)) * (10n ** BigInt(t.decimals));
    const tx = await t.contract.mint(deployer.address, amt);
    await tx.wait();
    console.log(`   ✅ ${s}: ${ethers.formatUnits(amt, t.decimals)}`);
  }

  // ── Create shards — batched with parallelism ──
  console.log("\n" + "=".repeat(70));
  console.log("🔧 Creating Pool Shards");
  console.log("=".repeat(70));

  const SHARD_NAMES = ["Small","Medium","Large"];
  let totalShards = 0, totalLiqUSD = 0;

  for (const token of Object.values(tc)) {
    await (await token.contract.approve(orchAddr, ethers.MaxUint256, { gasLimit: 500000 })).wait();
  }

  async function createOneShard(aS, bS, liqUSD, idx) {
    const a = tc[aS], b = tc[bS];
    const halfUSD = liqUSD / 2;
    const amtA = BigInt(Math.floor(halfUSD / a.price * (10 ** a.decimals)));
    const amtB = BigInt(Math.floor(halfUSD / b.price * (10 ** b.decimals)));

    const tx = await orch.createAndFundShard(a.address, b.address, amtA, amtB, {gasLimit:GAS});
    const receipt = await tx.wait();
    const ev = receipt.logs.find(l => { try { return factory.interface.parseLog(l)?.name==="ShardCreated"; } catch { return false; } });
    const shardAddr = factory.interface.parseLog(ev).args.shard;

    return {
      address:shardAddr,
      name:`${aS}-${bS}-${SHARD_NAMES[idx]||'S'+idx}`,
      liquidityUSD:liqUSD,
      amountA:ethers.formatUnits(amtA, a.decimals),
      amountB:ethers.formatUnits(amtB, b.decimals),
      managedByOrchestrator:true,
    };
  }

  for (const pool of POOLS) {
    const pair = `${pool.a}-${pool.b}`;
    data.contracts.shards[pair] = [];
    console.log(`\n   📊 ${pair}:`);

    for (let i = 0; i < pool.shards.length; i++) {
      try {
        const shard = await createOneShard(pool.a, pool.b, pool.shards[i], i);
        data.contracts.shards[pair].push(shard);
        totalShards++;
        totalLiqUSD += pool.shards[i];
        console.log(`      ✅ ${shard.name}: $${pool.shards[i].toLocaleString()}`);
      } catch (e) {
        console.log(`      ❌ ${pair}-${SHARD_NAMES[i]||i}: ${e.message.slice(0,60)}`);
      }
    }
  }

  console.log(`\n   📈 Total: ${totalShards} shards, $${totalLiqUSD.toLocaleString()} TVL`);
  data.poolStats = { totalShards, totalLiquidityUSD:totalLiqUSD };

  // ── Deploy Faucet ──
  console.log("\n" + "=".repeat(70));
  console.log("🚰 Deploying TokenFaucet");
  console.log("=".repeat(70));

  try {
    const Faucet = await ethers.getContractFactory("TokenFaucet");
    const faucet = await Faucet.deploy({gasLimit:GAS});
    await faucet.waitForDeployment();
    const faucetAddr = await faucet.getAddress();
    console.log(`   ✅ Faucet: ${faucetAddr}`);
    data.contracts.faucet = faucetAddr;

    // Set cooldown period
    await faucet.setCooldownPeriod(FAUCET_COOLDOWN, {gasLimit:200_000});

    // Add tokens to faucet (addToken takes address, symbol, amountPerRequest)
    // amountPerRequest is in base units — the contract multiplies by 10^decimals
    for (const [s, amt] of Object.entries(FAUCET_AMOUNTS)) {
      if (!tc[s]) continue;
      try {
        await faucet.addToken(tc[s].address, s, BigInt(amt), {gasLimit:500_000});
        console.log(`      ✅ ${s}: ${amt} per request`);
      } catch (e) {
        console.log(`      ❌ ${s}: ${e.message.slice(0,40)}`);
      }
    }
    console.log(`   ✅ Faucet configured (cooldown: ${FAUCET_COOLDOWN}s)`);
  } catch (e) {
    console.log(`   ❌ Faucet deploy failed: ${e.message.slice(0,60)}`);
  }

  // ── Comprehensive Swap Verification ──
  console.log("\n" + "=".repeat(70));
  console.log("🧪 Comprehensive Swap Verification (all pairs, both directions)");
  console.log("=".repeat(70));

  let passed = 0, failed = 0;
  const deadline = Math.floor(Date.now()/1000) + 3600;
  const swapLog = [];

  // Approve router for all tokens
  for (const [s,t] of Object.entries(tc)) {
    await (await t.contract.approve(routerAddr, ethers.MaxUint256, {gasLimit:500000})).wait();
  }

  const SAMMPool = await ethers.getContractFactory("SAMMPool");

  // Helper: execute a router swap and log full details
  async function testRouterSwap(tokenInSym, tokenOutSym, amountOutStr, label) {
    const tokenIn = tc[tokenInSym], tokenOut = tc[tokenOutSym];
    const amountOut = ethers.parseUnits(amountOutStr, tokenOut.decimals);
    try {
      const beforeIn = await tokenIn.contract.balanceOf(deployer.address);
      const beforeOut = await tokenOut.contract.balanceOf(deployer.address);

      // Quote first
      let quotedIn, selectedShard;
      try {
        const quote = await router.quoteSwap([{tokenIn:tokenIn.address, tokenOut:tokenOut.address, amountOut}]);
        quotedIn = quote.expectedAmountIn;
        selectedShard = quote.selectedShards[0];
      } catch { quotedIn = null; selectedShard = null; }

      const maxIn = quotedIn ? (quotedIn * 115n) / 100n : ethers.parseUnits("999999999", tokenIn.decimals);
      const tx = await router.swapExactOutput({
        hops:[{tokenIn:tokenIn.address, tokenOut:tokenOut.address, amountOut}],
        maxAmountIn:maxIn, deadline, recipient:deployer.address
      },{gasLimit:GAS});
      const receipt = await tx.wait();

      const afterIn = await tokenIn.contract.balanceOf(deployer.address);
      const afterOut = await tokenOut.contract.balanceOf(deployer.address);
      const actualIn = beforeIn - afterIn;
      const actualOut = afterOut - beforeOut;

      // Determine which shard tier was selected
      let shardTier = "unknown";
      if (selectedShard) {
        for (const shards of Object.values(data.contracts.shards)) {
          const match = shards.find(s => s.address.toLowerCase() === selectedShard.toLowerCase());
          if (match) { shardTier = match.name; break; }
        }
      }

      const rate = Number(ethers.formatUnits(actualOut, tokenOut.decimals)) / Number(ethers.formatUnits(actualIn, tokenIn.decimals));
      const entry = {
        label, direction:`${tokenInSym}→${tokenOutSym}`, mode:"router",
        amountOut: ethers.formatUnits(actualOut, tokenOut.decimals),
        amountIn: ethers.formatUnits(actualIn, tokenIn.decimals),
        rate: rate.toFixed(8),
        shardTier, txHash: receipt.hash
      };
      swapLog.push(entry);
      console.log(`   ✅ ${label}: ${entry.amountIn} ${tokenInSym} → ${entry.amountOut} ${tokenOutSym} | rate=${entry.rate} | shard=${shardTier}`);
      passed++;
    } catch (e) {
      console.log(`   ❌ ${label}: ${e.message.slice(0,80)}`);
      swapLog.push({label, direction:`${tokenInSym}→${tokenOutSym}`, mode:"router", error:e.message.slice(0,120)});
      failed++;
    }
  }

  // Helper: execute a direct shard swap
  async function testDirectSwap(tokenInSym, tokenOutSym, amountOutStr, shardAddress, shardName) {
    const tokenIn = tc[tokenInSym], tokenOut = tc[tokenOutSym];
    const amountOut = ethers.parseUnits(amountOutStr, tokenOut.decimals);
    const label = `Direct ${tokenInSym}→${tokenOutSym} on ${shardName}`;
    try {
      const pool = SAMMPool.attach(shardAddress);
      const quote = await pool.calculateSwapSAMM(amountOut, tokenIn.address, tokenOut.address);
      const maxIn = (quote.amountIn * 105n) / 100n;

      // Approve shard
      await (await tokenIn.contract.approve(shardAddress, maxIn, {gasLimit:500000})).wait();

      const beforeOut = await tokenOut.contract.balanceOf(deployer.address);
      const beforeIn = await tokenIn.contract.balanceOf(deployer.address);
      const tx = await pool.swapSAMM(amountOut, maxIn, tokenIn.address, tokenOut.address, deployer.address, {gasLimit:GAS});
      const receipt = await tx.wait();
      const afterOut = await tokenOut.contract.balanceOf(deployer.address);
      const afterIn = await tokenIn.contract.balanceOf(deployer.address);
      const actualIn = beforeIn - afterIn;
      const actualOut = afterOut - beforeOut;

      const rate = Number(ethers.formatUnits(actualOut, tokenOut.decimals)) / Number(ethers.formatUnits(actualIn, tokenIn.decimals));
      const feePct = (Number(ethers.formatUnits(quote.tradeFee + quote.ownerFee, tokenIn.decimals)) / Number(ethers.formatUnits(quote.amountIn, tokenIn.decimals)) * 100).toFixed(4);
      const entry = {
        label, direction:`${tokenInSym}→${tokenOutSym}`, mode:"direct",
        amountOut: ethers.formatUnits(actualOut, tokenOut.decimals),
        amountIn: ethers.formatUnits(actualIn, tokenIn.decimals),
        rate: rate.toFixed(8),
        feePct, shardName, txHash: receipt.hash
      };
      swapLog.push(entry);
      console.log(`   ✅ ${label}: ${entry.amountIn} ${tokenInSym} → ${entry.amountOut} ${tokenOutSym} | rate=${entry.rate} | fee=${feePct}%`);
      passed++;
    } catch (e) {
      console.log(`   ❌ ${label}: ${e.message.slice(0,80)}`);
      swapLog.push({label, direction:`${tokenInSym}→${tokenOutSym}`, mode:"direct", error:e.message.slice(0,120)});
      failed++;
    }
  }

  // Helper: multi-hop router swap
  async function testMultiHopSwap(tokenInSym, midSym, tokenOutSym, midAmtStr, finalAmtStr, label) {
    const tokenIn = tc[tokenInSym], mid = tc[midSym], tokenOut = tc[tokenOutSym];
    const midAmt = ethers.parseUnits(midAmtStr, mid.decimals);
    const finalAmt = ethers.parseUnits(finalAmtStr, tokenOut.decimals);
    try {
      const hops = [
        {tokenIn:tokenIn.address, tokenOut:mid.address, amountOut:midAmt},
        {tokenIn:mid.address, tokenOut:tokenOut.address, amountOut:finalAmt}
      ];
      const quote = await router.quoteSwap(hops);
      const maxIn = (quote.expectedAmountIn * 115n) / 100n;

      const beforeIn = await tokenIn.contract.balanceOf(deployer.address);
      const beforeOut = await tokenOut.contract.balanceOf(deployer.address);
      const tx = await router.swapExactOutput({hops, maxAmountIn:maxIn, deadline, recipient:deployer.address},{gasLimit:GAS});
      const receipt = await tx.wait();
      const afterIn = await tokenIn.contract.balanceOf(deployer.address);
      const afterOut = await tokenOut.contract.balanceOf(deployer.address);
      const actualIn = beforeIn - afterIn;
      const actualOut = afterOut - beforeOut;

      const shardTiers = quote.selectedShards.map(s => {
        for (const shards of Object.values(data.contracts.shards)) {
          const m = shards.find(x => x.address.toLowerCase() === s.toLowerCase());
          if (m) return m.name;
        }
        return "?";
      });

      const rate = Number(ethers.formatUnits(actualOut, tokenOut.decimals)) / Number(ethers.formatUnits(actualIn, tokenIn.decimals));
      const entry = {
        label, direction:`${tokenInSym}→${midSym}→${tokenOutSym}`, mode:"multi-hop",
        amountOut: ethers.formatUnits(actualOut, tokenOut.decimals),
        amountIn: ethers.formatUnits(actualIn, tokenIn.decimals),
        rate: rate.toFixed(8), shardTiers, txHash: receipt.hash
      };
      swapLog.push(entry);
      console.log(`   ✅ ${label}: ${entry.amountIn} ${tokenInSym} → ${entry.amountOut} ${tokenOutSym} | rate=${entry.rate} | shards=[${shardTiers.join(",")}]`);
      passed++;
    } catch (e) {
      console.log(`   ❌ ${label}: ${e.message.slice(0,80)}`);
      swapLog.push({label, direction:`${tokenInSym}→${midSym}→${tokenOutSym}`, mode:"multi-hop", error:e.message.slice(0,120)});
      failed++;
    }
  }

  // ═══════════════════════════════════════════════════════
  // A→B and B→A ROUTER SWAPS for every pair
  // ═══════════════════════════════════════════════════════
  for (const pool of POOLS) {
    const pairKey = `${pool.a}-${pool.b}`;
    console.log(`\n   ── ${pool.a} ↔ ${pool.b} (Router) ──`);
    // Small swap A→B
    const smallAmtB = pool.b === "WETH" ? "0.01" : pool.b === "WBTC" ? "0.001" : "100";
    await testRouterSwap(pool.a, pool.b, smallAmtB, `${pairKey} A→B small`);
    // Small swap B→A
    const smallAmtA = pool.a === "WETH" ? "0.01" : pool.a === "WBTC" ? "0.001" : "100";
    await testRouterSwap(pool.b, pool.a, smallAmtA, `${pairKey} B→A small`);
    // Medium swap A→B (should escalate to medium shard)
    const medAmtB = pool.b === "WETH" ? "0.5" : pool.b === "WBTC" ? "0.02" : "5000";
    await testRouterSwap(pool.a, pool.b, medAmtB, `${pairKey} A→B medium`);
    // Medium swap B→A
    const medAmtA = pool.a === "WETH" ? "0.5" : pool.a === "WBTC" ? "0.02" : "5000";
    await testRouterSwap(pool.b, pool.a, medAmtA, `${pairKey} B→A medium`);
  }

  // ═══════════════════════════════════════════════════════
  // DIRECT SHARD SWAPS — A→B and B→A on Small shard for each pair
  // ═══════════════════════════════════════════════════════
  console.log(`\n   ── Direct Shard Swaps ──`);
  for (const pool of POOLS) {
    const pairKey = `${pool.a}-${pool.b}`;
    const shards = data.contracts.shards[pairKey];
    if (!shards || !shards.length) continue;
    const smallShard = shards[0]; // first shard is smallest
    const directAmtB = pool.b === "WETH" ? "0.005" : pool.b === "WBTC" ? "0.0005" : "50";
    const directAmtA = pool.a === "WETH" ? "0.005" : pool.a === "WBTC" ? "0.0005" : "50";
    await testDirectSwap(pool.a, pool.b, directAmtB, smallShard.address, smallShard.name);
    await testDirectSwap(pool.b, pool.a, directAmtA, smallShard.address, smallShard.name);
  }

  // ═══════════════════════════════════════════════════════
  // MULTI-HOP SWAPS — cross-pool routes
  // ═══════════════════════════════════════════════════════
  console.log(`\n   ── Multi-Hop Router Swaps ──`);
  // WBTC → USDC → USDT
  await testMultiHopSwap("WBTC","USDC","USDT", "5000","4500", "WBTC→USDC→USDT");
  // USDT → USDC → WBTC
  await testMultiHopSwap("USDT","USDC","WBTC", "5000","0.005", "USDT→USDC→WBTC");
  // WETH → USDC → DAI
  await testMultiHopSwap("WETH","USDC","DAI", "4000","3500", "WETH→USDC→DAI");
  // DAI → USDC → WETH
  await testMultiHopSwap("DAI","USDC","WETH", "4000","1", "DAI→USDC→WETH");
  // WBTC → USDC → WETH (cross-volatile)
  await testMultiHopSwap("WBTC","USDC","WETH", "5000","1", "WBTC→USDC→WETH");
  // WETH → USDT → USDC (reverse stablecoin hop)
  await testMultiHopSwap("WETH","USDT","USDC", "3000","2500", "WETH→USDT→USDC");

  console.log(`\n   📊 Tests: ${passed}/${passed+failed} passed`);
  data.swapLog = swapLog;

  // ── Save deployment ──
  const elapsed = ((Date.now()-t0)/1000).toFixed(1);
  data.testResults = {passed, failed};
  data.deployTime = `${elapsed}s`;
  const filename = `deployment-data/production-risechain-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));

  console.log("\n" + "=".repeat(70));
  console.log("📊 DEPLOYMENT COMPLETE");
  console.log("=".repeat(70));
  console.log(`   Factory:      ${factoryAddr}`);
  console.log(`   Router:       ${routerAddr}`);
  console.log(`   Orchestrator: ${orchAddr}`);
  console.log(`   Faucet:       ${data.contracts.faucet || 'N/A'}`);
  console.log(`   Shards:       ${totalShards}`);
  console.log(`   TVL:          $${totalLiqUSD.toLocaleString()}`);
  console.log(`   Tests:        ${passed}/${passed+failed}`);
  console.log(`   Time:         ${elapsed}s`);
  console.log(`   Saved:        ${filename}`);
  console.log("=".repeat(70));
  console.log(`\n   SAMM Params: β1=${SAMM.beta1} rmin=${SAMM.rmin} rmax=${SAMM.rmax} c=${SAMM.c}`);
  console.log(`   Max fee: 0.30% (rmax 0.25% + owner 0.05%)`);
  console.log(`   c-threshold: 0.96% — max swap = 0.96% of output reserve`);
  console.log(`   Dynamic sharding via orchestrator: split, merge, rebalance\n`);
}

main().then(()=>process.exit(0)).catch(e=>{console.error("❌",e);process.exit(1);});
