#!/usr/bin/env node
/**
 * Comprehensive Swap Test — EXECUTES real on-chain swaps
 *
 * Tests direct shard swaps, router swaps, and multi-hop swaps with:
 *   ✔ Real transaction hashes
 *   ✔ Fee & slippage analysis vs CoinGecko oracle
 *   ✔ c-smaller-better property verification
 *   ✔ Both A→B and B→A directions
 *
 * Usage:  node scripts/comprehensive-swap-analysis.js
 *         (reads .env for PRIVATE_KEY and RISECHAIN_RPC_URL)
 */
require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────
const RPC_URL = process.env.RISECHAIN_RPC_URL || 'https://testnet.riselabs.xyz/http';
const PRIVATE_KEY = process.env.PRIVATE_KEY?.startsWith('0x')
  ? process.env.PRIVATE_KEY
  : `0x${process.env.PRIVATE_KEY}`;

const deployDir = path.join(__dirname, '..', 'deployment-data');
const deployFile = process.env.DEPLOYMENT_FILE ||
  fs.readdirSync(deployDir)
    .filter(f => f.startsWith('production-risechain-') && f.endsWith('.json'))
    .sort().reverse()[0];
const deployment = JSON.parse(fs.readFileSync(path.join(deployDir, deployFile), 'utf8'));

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// ABIs
const POOL_ABI = [
  'function getReserves() view returns (uint256, uint256)',
  'function tokenA() view returns (address)',
  'function tokenB() view returns (address)',
  'function calculateSwapSAMM(uint256,address,address) view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))',
  'function swapSAMM(uint256,uint256,address,address,address) external returns (uint256)',
];
const ROUTER_ABI = [
  'function quoteSwap((address tokenIn, address tokenOut, uint256 amountOut)[] hops) view returns (tuple(uint256 expectedAmountIn, uint256[] hopAmountsIn, uint256[] hopFees, address[] selectedShards, uint256[] priceImpacts))',
  'function executeSwap((address tokenIn, address tokenOut, uint256 amountOut)[] hops, uint256 maxAmountIn, address recipient) external returns (tuple(uint256 totalAmountIn, uint256 totalAmountOut, uint256 totalFees, uint256[] hopAmountsIn, uint256[] hopAmountsOut, uint256[] hopFees, address[] selectedShards))',
];
const TOKEN_ABI = [
  'function approve(address,uint256) external returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
];

const tokens = {};
const results = [];
let oraclePrices = {};
let nonce;

async function fetchOracle() {
  const ids = { WETH: 'ethereum', WBTC: 'bitcoin', USDC: 'usd-coin', USDT: 'tether', DAI: 'dai' };
  try {
    const resp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(ids).join(',')}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(10000) });
    const data = await resp.json();
    for (const [sym, id] of Object.entries(ids)) {
      if (data[id]?.usd) oraclePrices[sym] = data[id].usd;
    }
  } catch {
    for (const [sym, d] of Object.entries(deployment.contracts.tokens)) oraclePrices[sym] = d.price;
  }
  console.log('Oracle:', oraclePrices);
}

async function sendTx(txPromise) {
  const tx = await txPromise;
  nonce++;
  const receipt = await tx.wait();
  return { txHash: receipt.hash, gasUsed: receipt.gasUsed.toString(), blockNumber: receipt.blockNumber };
}

async function setup() {
  await fetchOracle();
  nonce = await provider.getTransactionCount(wallet.address, 'pending');

  for (const [sym, d] of Object.entries(deployment.contracts.tokens)) {
    tokens[sym] = { address: d.address, decimals: d.decimals,
      contract: new ethers.Contract(d.address, TOKEN_ABI, wallet) };
  }

  // Approve router + all shards
  const routerAddr = deployment.contracts.router;
  const targets = new Set([routerAddr]);
  for (const shards of Object.values(deployment.contracts.shards))
    for (const s of shards) targets.add(s.address);

  console.log(`Approving ${targets.size} addresses...`);
  for (const [sym, tok] of Object.entries(tokens)) {
    for (const addr of targets) {
      const allow = await tok.contract.allowance(wallet.address, addr);
      if (allow < ethers.parseUnits('1000000', tok.decimals)) {
        await sendTx(tok.contract.approve(addr, ethers.MaxUint256, { nonce, gasLimit: 100_000 }));
      }
    }
  }
  console.log('✅ Approvals done\n');
}

// ─── Direct shard swap (EXECUTED) ─────────────────────────────
async function testDirectSwap(shardAddr, shardName, tInSym, tOutSym, amtOutStr) {
  const pool = new ethers.Contract(shardAddr, POOL_ABI, wallet);
  const tIn = tokens[tInSym], tOut = tokens[tOutSym];
  const amountOut = ethers.parseUnits(amtOutStr, tOut.decimals);

  try {
    const quote = await pool.calculateSwapSAMM(amountOut, tIn.address, tOut.address);
    const amtInF = parseFloat(ethers.formatUnits(quote.amountIn, tIn.decimals));
    const amtOutF = parseFloat(amtOutStr);
    const tradeFee = parseFloat(ethers.formatUnits(quote.tradeFee, tIn.decimals));
    const ownerFee = parseFloat(ethers.formatUnits(quote.ownerFee, tIn.decimals));
    const feePct = ((tradeFee + ownerFee) / amtInF) * 100;
    const rate = amtOutF / amtInF;
    const oracle = oraclePrices[tInSym] / oraclePrices[tOutSym];
    const slip = ((rate - oracle) / oracle) * 100;
    const usd = amtOutF * oraclePrices[tOutSym];

    // EXECUTE
    const maxIn = (quote.amountIn * 120n) / 100n;
    const { txHash, gasUsed } = await sendTx(
      pool.swapSAMM(amountOut, maxIn, tIn.address, tOut.address, wallet.address,
        { nonce, gasLimit: 300_000 })
    );

    const r = {
      type: 'direct', shard: shardName, direction: `${tInSym}→${tOutSym}`,
      amountOut: amtOutStr, amountOutUSD: usd.toFixed(0), amountIn: amtInF.toFixed(8),
      effectiveRate: rate.toFixed(8), oracleRate: oracle.toFixed(8),
      slippagePct: slip.toFixed(4), feePct: feePct.toFixed(4),
      txHash, gasUsed,
    };
    results.push(r);
    console.log(`   ✅ ${shardName} ${tInSym}→${tOutSym} $${r.amountOutUSD}: rate=${r.effectiveRate} slip=${r.slippagePct}% fee=${r.feePct}% tx:${txHash.slice(0, 18)}…`);
    return r;
  } catch (e) {
    console.log(`   ❌ ${shardName} ${tInSym}→${tOutSym}: ${e.message?.slice(0, 80)}`);
    return null;
  }
}

// ─── Router swap (EXECUTED) ───────────────────────────────────
async function testRouterSwap(tInSym, tOutSym, amtOutStr, label) {
  const routerC = new ethers.Contract(deployment.contracts.router, ROUTER_ABI, wallet);
  const tIn = tokens[tInSym], tOut = tokens[tOutSym];
  const amountOut = ethers.parseUnits(amtOutStr, tOut.decimals);
  const hops = [{ tokenIn: tIn.address, tokenOut: tOut.address, amountOut }];

  try {
    const q = await routerC.quoteSwap(hops);
    const amtInF = parseFloat(ethers.formatUnits(q.expectedAmountIn, tIn.decimals));
    const amtOutF = parseFloat(amtOutStr);
    const feeF = parseFloat(ethers.formatUnits(q.hopFees[0], tIn.decimals));
    const feePct = (feeF / amtInF) * 100;
    const rate = amtOutF / amtInF;
    const oracle = oraclePrices[tInSym] / oraclePrices[tOutSym];
    const slip = ((rate - oracle) / oracle) * 100;
    const usd = amtOutF * oraclePrices[tOutSym];

    let shardName = q.selectedShards[0]?.slice(0, 12) + '…';
    for (const shards of Object.values(deployment.contracts.shards))
      for (const s of shards) {
        if (s.address.toLowerCase() === q.selectedShards[0].toLowerCase()) shardName = s.name;
      }

    // EXECUTE
    const maxIn = (q.expectedAmountIn * 120n) / 100n;
    const { txHash, gasUsed } = await sendTx(
      routerC.executeSwap(hops, maxIn, wallet.address, { nonce, gasLimit: 800_000 })
    );

    const r = {
      type: 'router', label, direction: `${tInSym}→${tOutSym}`,
      amountOut: amtOutStr, amountOutUSD: usd.toFixed(0), amountIn: amtInF.toFixed(8),
      selectedShard: shardName, effectiveRate: rate.toFixed(8), oracleRate: oracle.toFixed(8),
      slippagePct: slip.toFixed(4), feePct: feePct.toFixed(4),
      txHash, gasUsed,
    };
    results.push(r);
    console.log(`   ✅ Router ${label}: shard=${shardName} slip=${r.slippagePct}% fee=${r.feePct}% tx:${txHash.slice(0, 18)}…`);
    return r;
  } catch (e) {
    console.log(`   ❌ Router ${label}: ${e.message?.slice(0, 80)}`);
    return null;
  }
}

// ─── Multi-hop swap (EXECUTED) ────────────────────────────────
async function testMultiHop(route, amtOutStr, label) {
  const routerC = new ethers.Contract(deployment.contracts.router, ROUTER_ABI, wallet);
  const lastTok = tokens[route[route.length - 1]];
  const firstTok = tokens[route[0]];
  const amountOut = ethers.parseUnits(amtOutStr, lastTok.decimals);

  const hops = [];
  for (let i = 0; i < route.length - 1; i++) {
    hops.push({
      tokenIn: tokens[route[i]].address,
      tokenOut: tokens[route[i + 1]].address,
      amountOut: i === route.length - 2 ? amountOut : 0n,
    });
  }

  try {
    const q = await routerC.quoteSwap(hops);
    const amtInF = parseFloat(ethers.formatUnits(q.expectedAmountIn, firstTok.decimals));
    const amtOutF = parseFloat(amtOutStr);
    const rate = amtOutF / amtInF;
    const oracle = oraclePrices[route[0]] / oraclePrices[route[route.length - 1]];
    const slip = ((rate - oracle) / oracle) * 100;
    const usd = amtOutF * oraclePrices[route[route.length - 1]];

    let totalFeeUSD = 0;
    const shardNames = [];
    for (let i = 0; i < q.hopFees.length; i++) {
      const f = parseFloat(ethers.formatUnits(q.hopFees[i], tokens[route[i]].decimals));
      totalFeeUSD += f * oraclePrices[route[i]];
      let sn = q.selectedShards[i]?.slice(0, 10);
      for (const shards of Object.values(deployment.contracts.shards))
        for (const s of shards) {
          if (s.address.toLowerCase() === q.selectedShards[i].toLowerCase()) sn = s.name;
        }
      shardNames.push(sn);
    }
    const feePctOut = (totalFeeUSD / usd) * 100;

    // EXECUTE
    const maxIn = (q.expectedAmountIn * 120n) / 100n;
    const { txHash, gasUsed } = await sendTx(
      routerC.executeSwap(hops, maxIn, wallet.address, { nonce, gasLimit: 1_200_000 })
    );

    const r = {
      type: 'multi-hop', label, route: route.join('→'),
      amountOut: amtOutStr, amountOutUSD: usd.toFixed(0), amountIn: amtInF.toFixed(8),
      shards: shardNames, effectiveRate: rate.toFixed(8), oracleRate: oracle.toFixed(8),
      slippagePct: slip.toFixed(4), totalFeeUSD: totalFeeUSD.toFixed(4),
      feePctOfOutput: feePctOut.toFixed(4),
      txHash, gasUsed,
    };
    results.push(r);
    console.log(`   ✅ ${label}: ${route.join('→')} shards=[${shardNames.join(', ')}] slip=${r.slippagePct}% fee=${r.feePctOfOutput}% tx:${txHash.slice(0, 18)}…`);
    return r;
  } catch (e) {
    console.log(`   ❌ ${label}: ${e.message?.slice(0, 100)}`);
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(80));
  console.log('  COMPREHENSIVE SWAP TEST — ON-CHAIN EXECUTION');
  console.log('═'.repeat(80));
  console.log(`Deployment: ${deployFile}`);
  console.log(`Wallet: ${wallet.address}\n`);

  await setup();

  // ── 1. Direct shard swaps — A→B and B→A, small amounts ──
  console.log('\n' + '─'.repeat(80));
  console.log('  1. DIRECT SHARD SWAPS (executed on-chain)');
  console.log('─'.repeat(80));

  for (const [pair, shards] of Object.entries(deployment.contracts.shards)) {
    const [tA, tB] = pair.split('-');
    console.log(`\n  📊 ${pair}:`);

    // Pick amounts that stay well inside c-threshold
    let smallA, smallB;
    if (tA === 'WETH') { smallA = '10'; smallB = '0.005'; }          // ~$10 USDC, ~$10 WETH
    else if (tA === 'WBTC') { smallA = '10'; smallB = '0.00015'; }   // ~$10 USDC, ~$10 WBTC
    else { smallA = '10'; smallB = '10'; }                            // stablecoins

    // Test first 2 shards to keep it fast (smallest + largest)
    const testShards = shards.length <= 2 ? shards : [shards[0], shards[shards.length - 1]];
    for (const shard of testShards) {
      await testDirectSwap(shard.address, shard.name, tA, tB, smallA);
      await testDirectSwap(shard.address, shard.name, tB, tA, smallB);
    }
  }

  // ── 2. c-smaller-better verification (quote-only) ──
  console.log('\n' + '─'.repeat(80));
  console.log('  2. C-SMALLER-BETTER PROPERTY (quote comparison)');
  console.log('─'.repeat(80));

  for (const [pair, shards] of Object.entries(deployment.contracts.shards)) {
    const [tA, tB] = pair.split('-');
    const testAmt = '20';
    console.log(`\n  ${pair}: Buying ${testAmt} ${tB} across all shards:`);

    const fees = [];
    for (const shard of shards) {
      const pool = new ethers.Contract(shard.address, POOL_ABI, provider);
      const [rA, rB] = await pool.getReserves();
      try {
        const q = await pool.calculateSwapSAMM(
          ethers.parseUnits(testAmt, tokens[tB].decimals), tokens[tA].address, tokens[tB].address);
        const amtIn = parseFloat(ethers.formatUnits(q.amountIn, tokens[tA].decimals));
        const tFee = parseFloat(ethers.formatUnits(q.tradeFee, tokens[tA].decimals));
        const oFee = parseFloat(ethers.formatUnits(q.ownerFee, tokens[tA].decimals));
        const feePct = ((tFee + oFee) / amtIn) * 100;
        fees.push({ name: shard.name, feePct, tvl: Number(rA + rB) });
        console.log(`     ${shard.name}: fee=${feePct.toFixed(4)}%`);
      } catch (e) { console.log(`     ${shard.name}: ❌ ${e.message?.slice(0, 50)}`); }
    }
    if (fees.length >= 2) {
      fees.sort((a, b) => a.tvl - b.tvl);
      const small = fees[0], large = fees[fees.length - 1];
      if (small.feePct < large.feePct) console.log(`     ✅ c-smaller-better HOLDS`);
      else if (Math.abs(small.feePct - large.feePct) < 0.001) console.log(`     ⚠️  Nearly identical (tiers similar TVL)`);
      else console.log(`     ❌ VIOLATED`);
    }
  }

  // ── 3. Router swaps — multiple sizes, both directions ──
  console.log('\n' + '─'.repeat(80));
  console.log('  3. ROUTER SWAPS (executed on-chain)');
  console.log('─'.repeat(80));

  const routerTests = [
    ['WETH', 'USDC', '100',   'WETH→USDC $100'],
    ['WETH', 'USDC', '1000',  'WETH→USDC $1k'],
    ['USDC', 'WETH', '0.05',  'USDC→WETH ~$100'],
    ['WBTC', 'USDC', '100',   'WBTC→USDC $100'],
    ['USDC', 'WBTC', '0.001', 'USDC→WBTC ~$66'],
    ['USDC', 'USDT', '100',   'USDC→USDT $100'],
    ['USDT', 'USDC', '100',   'USDT→USDC $100'],
    ['USDC', 'DAI',  '100',   'USDC→DAI $100'],
    ['DAI',  'USDC', '100',   'DAI→USDC $100'],
    ['WETH', 'USDT', '100',   'WETH→USDT $100'],
    ['USDT', 'WETH', '0.05',  'USDT→WETH ~$100'],
  ];
  for (const [tIn, tOut, amt, label] of routerTests) {
    await testRouterSwap(tIn, tOut, amt, label);
  }

  // ── 4. Multi-hop swaps ──
  console.log('\n' + '─'.repeat(80));
  console.log('  4. MULTI-HOP SWAPS (executed on-chain)');
  console.log('─'.repeat(80));

  const multiHops = [
    [['WETH', 'USDC', 'USDT'], '500',   'WETH→USDC→USDT $500'],
    [['USDT', 'USDC', 'WETH'], '0.25',  'USDT→USDC→WETH ~$500'],
    [['WETH', 'USDC', 'DAI'],  '500',   'WETH→USDC→DAI $500'],
    [['DAI',  'USDC', 'WETH'], '0.25',  'DAI→USDC→WETH ~$500'],
    [['WBTC', 'USDC', 'USDT'], '500',   'WBTC→USDC→USDT $500'],
    [['WBTC', 'USDC', 'WETH'], '0.25',  'WBTC→USDC→WETH ~$500'],
    [['WETH', 'USDT', 'USDC'], '500',   'WETH→USDT→USDC $500'],
    [['DAI',  'USDC', 'USDT'], '500',   'DAI→USDC→USDT $500'],
    [['USDT', 'USDC', 'DAI'],  '500',   'USDT→USDC→DAI $500'],
  ];
  for (const [route, amt, label] of multiHops) {
    await testMultiHop(route, amt, label);
  }

  // ── 5. Summary ──
  console.log('\n' + '═'.repeat(80));
  console.log('  SUMMARY');
  console.log('═'.repeat(80));

  const direct = results.filter(r => r.type === 'direct');
  const rtr = results.filter(r => r.type === 'router');
  const mh = results.filter(r => r.type === 'multi-hop');

  console.log(`\n  Direct swaps:    ${direct.length} executed`);
  console.log(`  Router swaps:    ${rtr.length} executed`);
  console.log(`  Multi-hop swaps: ${mh.length} executed`);
  console.log(`  Total:           ${results.length} on-chain transactions`);

  const slips = results.map(r => parseFloat(r.slippagePct)).filter(v => !isNaN(v));
  if (slips.length) {
    console.log(`\n  Slippage vs oracle:`);
    console.log(`    Avg:  ${(slips.reduce((a, b) => a + b, 0) / slips.length).toFixed(4)}%`);
    console.log(`    Max:  ${Math.max(...slips.map(Math.abs)).toFixed(4)}%`);
  }

  const directFees = direct.map(r => parseFloat(r.feePct)).filter(v => !isNaN(v));
  if (directFees.length) {
    console.log(`\n  Direct swap fees:`);
    console.log(`    Min: ${Math.min(...directFees).toFixed(4)}%`);
    console.log(`    Max: ${Math.max(...directFees).toFixed(4)}%`);
    console.log(`    Avg: ${(directFees.reduce((a, b) => a + b, 0) / directFees.length).toFixed(4)}%`);
  }

  // Router shard selection
  console.log('\n  Router shard selection:');
  const counts = {};
  for (const r of rtr) counts[r.selectedShard] = (counts[r.selectedShard] || 0) + 1;
  for (const [s, c] of Object.entries(counts).sort((a, b) => b[1] - a[1]))
    console.log(`    ${s}: ${c}×`);

  // Tx hashes
  console.log('\n  All tx hashes:');
  for (const r of results) {
    const label = r.label || r.shard || r.route;
    console.log(`    ${r.type.padEnd(10)} ${(r.direction || r.route || '').padEnd(20)} ${r.txHash}`);
  }

  // Save
  const outFile = path.join(__dirname, '..', 'test-results', `swap-analysis-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    timestamp: new Date().toISOString(), deployment: deployFile, oraclePrices, results,
    summary: { total: results.length, direct: direct.length, router: rtr.length, multiHop: mh.length }
  }, null, 2));
  console.log(`\n  📁 Results: ${outFile}`);
  console.log('═'.repeat(80));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
