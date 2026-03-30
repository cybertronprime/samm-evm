#!/usr/bin/env node
/**
 * API Verification Script — tests every endpoint on the SAMM DEX API server.
 * No swaps executed — read-only / quote-only tests.
 *
 * Usage:
 *   1. Start the server: node api-server.js
 *   2. In another terminal: node scripts/verify-all-apis.js
 */
require('dotenv').config();

const BASE = `http://localhost:${process.env.PORT || 3000}`;
let passed = 0, failed = 0;
const results = [];

async function test(method, urlPath, body, opts = {}) {
  const { expectStatus, check, label } = opts;
  const tag = label || `${method.padEnd(4)} ${urlPath}`;
  try {
    const fetchOpts = { method, headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000) };
    if (body) fetchOpts.body = JSON.stringify(body);
    const resp = await fetch(`${BASE}${urlPath}`, fetchOpts);
    const data = await resp.json();

    // For error-handling tests, we EXPECT a non-200 status
    const statusOk = expectStatus
      ? resp.status === expectStatus
      : resp.ok;
    const checkOk = check ? check(data, resp.status) : true;
    const ok = statusOk && checkOk;

    if (ok) {
      passed++;
      const summary = summarize(data);
      console.log(`  \u2705 ${tag}  \u2192  ${summary}`);
      results.push({ endpoint: tag, status: 'pass', code: resp.status, summary });
    } else {
      failed++;
      console.log(`  \u274c ${tag}  \u2192  HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 150)}`);
      results.push({ endpoint: tag, status: 'fail', code: resp.status, data });
    }
    return data;
  } catch (e) {
    failed++;
    console.log(`  \u274c ${tag}  \u2192  ERROR: ${e.message?.slice(0, 120)}`);
    results.push({ endpoint: tag, status: 'error', error: e.message });
    return null;
  }
}

function summarize(d) {
  if (!d) return 'null';
  const p = [];
  if (d.status) p.push(`status=${d.status}`);
  if (d.deployment) p.push(`deploy=${d.deployment.split('-').pop()?.slice(0, 13)}`);
  if (d.tokens?.length) p.push(`${d.tokens.length} tokens`);
  if (d.pools?.length) p.push(`${d.pools.length} pairs`);
  if (d.totalShards !== undefined) p.push(`${d.totalShards} shards`);
  if (d.totalLiquidityUSD !== undefined) p.push(`$${Math.round(d.totalLiquidityUSD).toLocaleString()} TVL`);
  if (d.pair) p.push(`pair=${d.pair}`);
  if (d.shards?.length) p.push(`${d.shards.length} shards`);
  if (d.tokenIn && d.tokenOut) p.push(`${d.tokenIn}\u2192${d.tokenOut}`);
  if (d.amountIn) p.push(`in=${d.amountIn}`);
  if (d.amountOut) p.push(`out=${d.amountOut}`);
  if (d.amountInUSD) p.push(`$${d.amountInUSD}`);
  if (d.slippagePct) p.push(`slip=${d.slippagePct}%`);
  if (d.feePct) p.push(`fee=${d.feePct}%`);
  if (d.feeUSD) p.push(`fee$=${d.feeUSD}`);
  if (d.selectedShard) p.push(`shard=${d.selectedShard}`);
  if (d.effectiveRate) p.push(`rate=${d.effectiveRate}`);
  if (d.price) p.push(`price=${d.price}`);
  if (d.deviationPct) p.push(`dev=${d.deviationPct}%`);
  if (d.balance) p.push(`bal=${d.balance}`);
  if (d.balances) p.push(`${Object.keys(d.balances).length} tokens`);
  if (d.totalPairs) p.push(`${d.totalPairs} pairs`);
  if (d.running !== undefined) p.push(`running=${d.running}`);
  if (d.enabled !== undefined) p.push(`enabled=${d.enabled}`);
  if (d.history?.length !== undefined) p.push(`${d.history.length} entries`);
  if (d.route?.length) p.push(`route=${d.route.join('\u2192')}`);
  if (d.hops?.length) p.push(`${d.hops.length} hops`);
  if (d.totalFeeUSD) p.push(`totalFee$=${d.totalFeeUSD}`);
  if (d.error) p.push(`error="${d.error.slice(0, 50)}"`);
  if (d.pairTPS) p.push('tps=present');
  return p.length ? p.join(', ') : JSON.stringify(d).slice(0, 120);
}

async function main() {
  console.log('\u2550'.repeat(70));
  console.log('  SAMM DEX API \u2014 Full Endpoint Verification');
  console.log('\u2550'.repeat(70));
  console.log(`  Server: ${BASE}\n`);

  // Connectivity check
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.log(`  \u274c Server not reachable at ${BASE} (${e.message})`);
    console.log('     Start it first: node api-server.js');
    process.exit(1);
  }

  // ==========================================================
  //  1. Health & Info
  // ==========================================================
  console.log('\n\u2500\u2500\u2500 1. Health & Info \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  await test('GET', '/health', null, {
    check: d => d.status === 'ok' && d.deployment && d.oraclePrices });
  await test('GET', '/tokens', null, {
    check: d => d.tokens?.length >= 5 });
  await test('GET', '/stats', null, {
    check: d => d.totalPairs >= 5 && d.totalShards >= 20 && d.totalLiquidityUSD > 0 });

  // ==========================================================
  //  2. Pools & Shards (all 5 pairs)
  // ==========================================================
  console.log('\n\u2500\u2500\u2500 2. Pools & Shards \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  const poolData = await test('GET', '/pools', null, {
    check: d => d.pools?.length >= 5 && d.totalShards >= 20 });

  const pairs = ['WETH/USDC', 'USDC/USDT', 'WETH/USDT', 'WBTC/USDC', 'USDC/DAI'];
  for (const pair of pairs) {
    const [a, b] = pair.split('/');
    await test('GET', `/pools/${a}/${b}`, null, {
      check: d => d.shards?.length >= 3,
      label: `GET  /pools/${a}/${b}` });
  }

  // On-chain shard query (includes any dynamically created shards)
  await test('GET', '/shards/WETH/USDC', null, {
    check: d => d.shards?.length >= 3 && d.totalLiquidityUSD > 0 });
  await test('GET', '/shards/USDC/USDT', null, {
    check: d => d.shards?.length >= 3 });

  // ==========================================================
  //  3. Quotes - single hop (all pairs, both directions)
  // ==========================================================
  console.log('\n\u2500\u2500\u2500 3. Quotes (single-hop, read-only) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  const quoteTests = [
    ['/quote/WETH/USDC/100',  'Buy 100 USDC with WETH'],
    ['/quote/USDC/WETH/0.05', 'Buy 0.05 WETH with USDC'],
    ['/quote/WBTC/USDC/100',  'Buy 100 USDC with WBTC'],
    ['/quote/USDC/USDT/100',  'Buy 100 USDT with USDC'],
    ['/quote/USDT/USDC/100',  'Buy 100 USDC with USDT'],
    ['/quote/USDC/DAI/100',   'Buy 100 DAI with USDC'],
    ['/quote/DAI/USDC/100',   'Buy 100 USDC with DAI'],
    ['/quote/WETH/USDT/100',  'Buy 100 USDT with WETH'],
    ['/quote/USDT/WETH/0.05', 'Buy 0.05 WETH with USDT'],
    ['/quote/WBTC/USDC/1000', 'Buy 1000 USDC with WBTC (larger)'],
  ];
  for (const [qpath, qlabel] of quoteTests) {
    await test('GET', qpath, null, {
      check: d => d.amountIn && d.slippagePct && d.feePct && d.selectedShard,
      label: `GET  ${qpath.padEnd(28)} ${qlabel}` });
  }

  // ==========================================================
  //  4. Quotes - POST single & multi-hop
  // ==========================================================
  console.log('\n\u2500\u2500\u2500 4. Quotes (multi-hop, read-only) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  await test('POST', '/quote',
    { tokenIn: 'WETH', tokenOut: 'USDC', amountOut: '500' },
    { check: d => d.amountIn && d.hops?.length === 1,
      label: 'POST /quote  WETH\u2192USDC 500 (single)' });
  await test('POST', '/quote',
    { route: ['WETH', 'USDC', 'USDT'], amountOut: '500' },
    { check: d => d.hops?.length === 2 && d.totalFeeUSD,
      label: 'POST /quote  WETH\u2192USDC\u2192USDT 500 (2-hop)' });
  await test('POST', '/quote',
    { route: ['WBTC', 'USDC', 'WETH'], amountOut: '0.25' },
    { check: d => d.hops?.length === 2,
      label: 'POST /quote  WBTC\u2192USDC\u2192WETH 0.25 (2-hop)' });
  await test('POST', '/quote',
    { route: ['DAI', 'USDC', 'WETH'], amountOut: '0.1' },
    { check: d => d.hops?.length === 2,
      label: 'POST /quote  DAI\u2192USDC\u2192WETH 0.1 (2-hop)' });
  await test('POST', '/quote',
    { route: ['WETH', 'USDT', 'USDC'], amountOut: '1000' },
    { check: d => d.hops?.length === 2,
      label: 'POST /quote  WETH\u2192USDT\u2192USDC 1000 (2-hop)' });

  // ==========================================================
  //  5. Spot Prices
  // ==========================================================
  console.log('\n\u2500\u2500\u2500 5. Spot Prices \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  for (const pair of pairs) {
    const [a, b] = pair.split('/');
    await test('GET', `/price/${a}/${b}`, null, {
      check: d => d.price && d.deviationPct !== undefined,
      label: `GET  /price/${a}/${b}` });
  }

  // ==========================================================
  //  6. Balances
  // ==========================================================
  console.log('\n\u2500\u2500\u2500 6. Balances \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  let walletAddr;
  try {
    const pk = process.env.PRIVATE_KEY;
    walletAddr = pk
      ? require('ethers').computeAddress(pk.startsWith('0x') ? pk : `0x${pk}`)
      : '0x004566C322f5F1CBC0594928556441f8D38EA589';
  } catch { walletAddr = '0x004566C322f5F1CBC0594928556441f8D38EA589'; }

  await test('GET', `/balance/${walletAddr}/WETH`, null, {
    check: d => d.balance !== undefined });
  await test('GET', `/balance/${walletAddr}/USDC`, null, {
    check: d => d.balance !== undefined });
  await test('GET', `/balances/${walletAddr}`, null, {
    check: d => Object.keys(d.balances || {}).length >= 5 });

  // ==========================================================
  //  7. Arbitrage Bot
  // ==========================================================
  console.log('\n\u2500\u2500\u2500 7. Arbitrage Bot \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  await test('GET', '/arbitrage/status', null, {
    check: d => d.running !== undefined || d.enabled !== undefined });
  await test('GET', '/arbitrage/history', null, {
    check: d => d.history !== undefined });
  await test('GET', '/arbitrage/history?limit=5', null, {
    check: d => d.history !== undefined,
    label: 'GET  /arbitrage/history?limit=5' });

  // ==========================================================
  //  8. Dynamic Shard Manager
  // ==========================================================
  console.log('\n\u2500\u2500\u2500 8. Dynamic Shard Manager \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  await test('GET', '/sharding/status', null, {
    check: d => d.running !== undefined || d.enabled !== undefined });

  // ==========================================================
  //  9. Error Handling (expect proper error responses)
  // ==========================================================
  console.log('\n\u2500\u2500\u2500 9. Error Handling \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  await test('GET', '/pools/FAKE/TOKEN', null, {
    expectStatus: 404,
    check: d => d.error !== undefined,
    label: 'GET  /pools/FAKE/TOKEN     (expect 404)' });
  await test('GET', '/quote/FAKE/USDC/100', null, {
    expectStatus: 400,
    check: d => d.error !== undefined,
    label: 'GET  /quote/FAKE/USDC/100  (expect 400)' });
  await test('GET', '/balance/0xinvalid/WETH', null, {
    expectStatus: 400,
    check: d => d.error !== undefined,
    label: 'GET  /balance/invalid      (expect 400)' });
  await test('POST', '/quote', { amountOut: '100' }, {
    expectStatus: 400,
    check: d => d.error !== undefined,
    label: 'POST /quote no route       (expect 400)' });

  // ==========================================================
  //  SUMMARY
  // ==========================================================
  const total = passed + failed;
  console.log(`\n${'═'.repeat(70)}`);
  if (failed === 0) {
    console.log(`  \u2705 ALL ${total} TESTS PASSED`);
  } else {
    console.log(`  RESULTS: ${passed}/${total} passed, ${failed} failed`);
  }
  console.log(`${'═'.repeat(70)}`);

  // Deployment overview
  if (poolData?.pools) {
    console.log('\n  \ud83d\udcca Deployment Overview:');
    console.log(`     Pairs: ${poolData.pools.length}`);
    console.log(`     Total shards: ${poolData.totalShards} (incl. dynamic)`);
    let totalTVL = 0;
    for (const pool of poolData.pools) {
      const shardList = pool.shards.map(s => {
        const short = s.name.replace(pool.pair + '-', '');
        return `${short}($${Math.round(s.liquidityUSD / 1000)}k)`;
      }).join(', ');
      console.log(`     ${pool.pair}: ${pool.shards.length} shards [${shardList}] = $${pool.totalLiquidityUSD?.toLocaleString()}`);
      totalTVL += pool.totalLiquidityUSD || 0;
    }
    console.log(`     Total TVL: $${Math.round(totalTVL).toLocaleString()}`);
  }

  // Save
  const fs = require('fs');
  const fpath = require('path');
  const outFile = fpath.join(__dirname, '..', 'test-results', `api-verification-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    timestamp: new Date().toISOString(), passed, failed, total, results,
  }, null, 2));
  console.log(`\n  \ud83d\udcc1 Results: ${outFile}`);
  console.log('═'.repeat(70));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
