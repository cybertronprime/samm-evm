#!/usr/bin/env node
/**
 * TPS Load Test — triggers dynamic shard scaling
 *
 * Fires 250+ swap transactions as fast as possible against a single
 * pair to push TPS above the MIN_TPS_FOR_SCALE_UP threshold (5 TPS),
 * which triggers the shard manager's §6 formula:
 *
 *   n = min(ceil(TPS / PER_SHARD_TPS), MAX_SHARDS_PER_PAIR)
 *
 * At 250 TPS → ceil(250/50) = 5 target shards.
 * At 50 TPS  → ceil(50/50)  = 1 target shard.
 *
 * After the burst, the shard manager check cycle should detect the TPS
 * spike and create new shards (if current < target).
 *
 * Usage:
 *   node scripts/tps-load-test.js                  # default: 300 swaps on WETH-USDC
 *   node scripts/tps-load-test.js --swaps 500      # 500 swaps
 *   node scripts/tps-load-test.js --pair USDC-USDT  # different pair
 *   node scripts/tps-load-test.js --trigger-check   # also force shard manager check after
 */
require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ─── CLI args ─────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const TARGET_SWAPS = parseInt(getArg('swaps', '300'));
const PAIR = getArg('pair', 'WETH-USDC');
const TRIGGER_CHECK = args.includes('--trigger-check');
const BATCH_SIZE = parseInt(getArg('batch', '20'));  // concurrent txs per batch

// ─── Setup ────────────────────────────────────────────────────
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

const POOL_ABI = [
  'function calculateSwapSAMM(uint256,address,address) view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))',
  'function swapSAMM(uint256,uint256,address,address,address) external returns (uint256)',
  'function getReserves() view returns (uint256, uint256)',
  'function tokenA() view returns (address)',
];
const TOKEN_ABI = [
  'function approve(address,uint256) external returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
];

async function main() {
  console.log('═'.repeat(70));
  console.log('  TPS LOAD TEST — Dynamic Shard Scaling Trigger');
  console.log('═'.repeat(70));
  console.log(`  Target swaps: ${TARGET_SWAPS}`);
  console.log(`  Pair: ${PAIR}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Wallet: ${wallet.address}`);
  console.log(`  Deployment: ${deployFile}\n`);

  const [tokASym, tokBSym] = PAIR.split('-');
  const tokAData = deployment.contracts.tokens[tokASym];
  const tokBData = deployment.contracts.tokens[tokBSym];
  if (!tokAData || !tokBData) {
    console.error(`❌ Invalid pair ${PAIR}. Available: ${Object.keys(deployment.contracts.shards).join(', ')}`);
    process.exit(1);
  }

  const shards = deployment.contracts.shards[PAIR] || deployment.contracts.shards[`${tokBSym}-${tokASym}`];
  if (!shards || shards.length === 0) {
    console.error(`❌ No shards for ${PAIR}`);
    process.exit(1);
  }

  // Use the smallest shard — tiny swaps have least price impact
  const targetShard = shards[0];
  console.log(`  Target shard: ${targetShard.name} (${targetShard.address})`);

  const pool = new ethers.Contract(targetShard.address, POOL_ABI, wallet);
  const tokA = new ethers.Contract(tokAData.address, TOKEN_ABI, wallet);
  const tokB = new ethers.Contract(tokBData.address, TOKEN_ABI, wallet);

  // ── Approve ──
  console.log('\n  Checking approvals...');
  for (const [tok, sym] of [[tokA, tokASym], [tokB, tokBSym]]) {
    const allow = await tok.allowance(wallet.address, targetShard.address);
    if (allow < ethers.parseUnits('999999999', tokASym === sym ? tokAData.decimals : tokBData.decimals)) {
      console.log(`  Approving ${sym}...`);
      const tx = await tok.approve(targetShard.address, ethers.MaxUint256);
      await tx.wait();
    }
  }
  console.log('  ✅ Approvals ready\n');

  // ── Determine swap amount — very tiny to stay inside c-threshold ──
  // We alternate A→B and B→A to minimize net price impact
  let tinyAmtA, tinyAmtB;
  if (tokASym === 'WETH') { tinyAmtA = '1'; tinyAmtB = '0.0005'; }       // ~$1
  else if (tokASym === 'WBTC') { tinyAmtA = '1'; tinyAmtB = '0.00002'; } // ~$1
  else { tinyAmtA = '1'; tinyAmtB = '1'; }                               // stablecoins $1

  // ── Fire swaps ──
  console.log(`  🔥 Starting ${TARGET_SWAPS} swaps (alternating A→B / B→A)...\n`);
  const startTime = Date.now();
  let confirmed = 0, failed = 0;
  let currentNonce = await provider.getTransactionCount(wallet.address, 'pending');
  const txHashes = [];

  // Process in batches for throughput
  for (let batch = 0; batch < Math.ceil(TARGET_SWAPS / BATCH_SIZE); batch++) {
    const batchStart = batch * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, TARGET_SWAPS);
    const batchPromises = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const isAtoB = i % 2 === 0;
      const amtOutStr = isAtoB ? tinyAmtA : tinyAmtB;
      const tInAddr = isAtoB ? tokAData.address : tokBData.address;
      const tOutAddr = isAtoB ? tokBData.address : tokAData.address;
      const tOutDec = isAtoB ? tokBData.decimals : tokAData.decimals;
      const tInDec = isAtoB ? tokAData.decimals : tokBData.decimals;
      const amountOut = ethers.parseUnits(amtOutStr, tOutDec);

      const n = currentNonce++;

      const p = (async () => {
        try {
          // Quote
          const quote = await pool.calculateSwapSAMM(amountOut, tInAddr, tOutAddr);
          const maxIn = (quote.amountIn * 150n) / 100n; // 50% slippage tolerance for speed

          // Execute
          const tx = await pool.swapSAMM(amountOut, maxIn, tInAddr, tOutAddr, wallet.address,
            { nonce: n, gasLimit: 300_000 });
          const receipt = await tx.wait();
          return { success: true, txHash: receipt.hash, idx: i };
        } catch (e) {
          return { success: false, error: e.message?.slice(0, 60), idx: i };
        }
      })();

      batchPromises.push(p);
    }

    const batchResults = await Promise.all(batchPromises);
    for (const r of batchResults) {
      if (r.success) {
        confirmed++;
        txHashes.push(r.txHash);
      } else {
        failed++;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const tps = (confirmed / Math.max(parseFloat(elapsed), 0.1)).toFixed(1);
    process.stdout.write(`\r  Batch ${batch + 1}/${Math.ceil(TARGET_SWAPS / BATCH_SIZE)} | ${confirmed} confirmed, ${failed} failed | ${elapsed}s | ~${tps} TPS`);
  }

  const totalTime = (Date.now() - startTime) / 1000;
  const avgTPS = confirmed / Math.max(totalTime, 0.1);

  console.log(`\n\n${'─'.repeat(70)}`);
  console.log(`  RESULTS`);
  console.log(`${'─'.repeat(70)}`);
  console.log(`  Total swaps:    ${TARGET_SWAPS}`);
  console.log(`  Confirmed:      ${confirmed}`);
  console.log(`  Failed:         ${failed}`);
  console.log(`  Time:           ${totalTime.toFixed(1)}s`);
  console.log(`  Average TPS:    ${avgTPS.toFixed(1)}`);
  console.log(`  Peak throughput: ~${(BATCH_SIZE / 2).toFixed(0)}-${BATCH_SIZE} concurrent`);

  // Expected shard target
  const targetShards = Math.min(Math.max(1, Math.ceil(avgTPS / 50)), 10);
  console.log(`\n  📐 TPS formula: n = ceil(${avgTPS.toFixed(1)} / 50) = ${targetShards}`);
  console.log(`  📊 Current shards for ${PAIR}: ${shards.length}`);
  if (targetShards > shards.length) {
    console.log(`  📈 Shard manager should scale UP to ${targetShards} shards`);
  } else {
    console.log(`  ✅ Current shard count is sufficient`);
  }

  // First/last tx hashes
  if (txHashes.length > 0) {
    console.log(`\n  First tx: ${txHashes[0]}`);
    console.log(`  Last tx:  ${txHashes[txHashes.length - 1]}`);
  }

  // ── Trigger shard manager check ──
  if (TRIGGER_CHECK) {
    console.log('\n  🔧 Triggering shard manager check via API...');
    try {
      const resp = await fetch(`http://localhost:${process.env.PORT || 3000}/sharding/check`, { method: 'POST' });
      const data = await resp.json();
      console.log(`  ✅ Check triggered — status: ${JSON.stringify(data.status?.pairTPS || {})}`);
    } catch (e) {
      console.log(`  ⚠️  API not reachable: ${e.message?.slice(0, 60)}`);
      console.log('      Start the API server first: node api-server.js');
    }
  }

  // Save results
  const outFile = path.join(__dirname, '..', 'test-results', `tps-load-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    pair: PAIR, targetSwaps: TARGET_SWAPS, confirmed, failed,
    totalTimeSeconds: totalTime, averageTPS: avgTPS,
    targetShardCount: targetShards, currentShardCount: shards.length,
    firstTxHash: txHashes[0] || null, lastTxHash: txHashes[txHashes.length - 1] || null,
    allTxHashes: txHashes,
  }, null, 2));
  console.log(`\n  📁 Results: ${outFile}`);
  console.log('═'.repeat(70));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
