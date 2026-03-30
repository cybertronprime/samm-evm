/**
 * SAMM DEX API Server
 *
 * Self-contained — just run `node api-server.js` with a .env file.
 * No CLI params needed. Auto-discovers deployment, starts arb bot
 * and dynamic shard manager with shared TxQueue.
 */
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const ArbitrageBot = require('./arbitrage-bot');
const DynamicShardManager = require('./dynamic-shard-manager');
const TxQueue = require('./tx-queue');
require('dotenv').config();

// ─── Process-level error handlers (prevent crash on RPC 429 etc) ────
process.on('uncaughtException', (err) => {
  console.error(`\n⚠️  Uncaught exception (non-fatal): ${err.message?.slice(0, 150)}`);
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`\n⚠️  Unhandled rejection (non-fatal): ${msg?.slice(0, 150)}`);
});

const app = express();
app.use(cors());
app.use(express.json());

// ─── Config ─────────────────────────────────────────────────────
function findLatestDeployment() {
  if (process.env.DEPLOYMENT_FILE) return process.env.DEPLOYMENT_FILE;
  const deployDir = path.join(__dirname, 'deployment-data');
  const files = fs.readdirSync(deployDir)
    .filter(f => f.startsWith('production-risechain-') && f.endsWith('.json'))
    .sort().reverse();
  if (files.length === 0) throw new Error('No deployment files found');
  return files[0];
}

function normalizePK(pk) {
  return pk.startsWith('0x') ? pk : `0x${pk}`;
}

const DEPLOYMENT_FILE = findLatestDeployment();
const deploymentPath = path.join(__dirname, 'deployment-data', DEPLOYMENT_FILE);
const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));

const RPC_URL = process.env.RISECHAIN_RPC_URL || 'https://testnet.riselabs.xyz/http';
const provider = new ethers.JsonRpcProvider(RPC_URL);
const PORT = parseInt(process.env.PORT || '3000');

// Wallet + TxQueue (created once, shared everywhere)
let wallet = null;
let txQueue = null;
if (process.env.PRIVATE_KEY) {
  wallet = new ethers.Wallet(normalizePK(process.env.PRIVATE_KEY), provider);
  txQueue = new TxQueue(wallet, provider);
}

// Contracts & state
let router;
const tokens = {};
const poolCache = new Map();
let arbitrageBot = null;
let shardManager = null;

// ABIs
const POOL_ABI = [
  'function getReserves() view returns (uint256, uint256)',
  'function tokenA() view returns (address)',
  'function tokenB() view returns (address)',
  'function totalSupply() view returns (uint256)',
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
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

// ─── Oracle ─────────────────────────────────────────────────────
const geckoIds = { WETH: 'ethereum', WBTC: 'bitcoin', USDC: 'usd-coin', USDT: 'tether', DAI: 'dai' };
let oraclePrices = {};
let lastOracleUpdate = 0;

async function refreshOracle() {
  if (Date.now() - lastOracleUpdate < 60_000 && Object.keys(oraclePrices).length > 0) return oraclePrices;
  try {
    const ids = Object.values(geckoIds).join(',');
    const resp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(10000) });
    if (resp.ok) {
      const data = await resp.json();
      for (const [sym, id] of Object.entries(geckoIds)) {
        if (data[id]?.usd) oraclePrices[sym] = data[id].usd;
      }
      lastOracleUpdate = Date.now();
    }
  } catch { /* fall through */ }
  for (const [sym, d] of Object.entries(deployment.contracts.tokens)) {
    if (!oraclePrices[sym]) oraclePrices[sym] = d.price;
  }
  return oraclePrices;
}

// ─── Initialize ─────────────────────────────────────────────────
async function initialize() {
  await refreshOracle();

  router = new ethers.Contract(deployment.contracts.router, ROUTER_ABI, wallet || provider);

  for (const [symbol, data] of Object.entries(deployment.contracts.tokens)) {
    tokens[symbol] = {
      address: data.address,
      decimals: data.decimals,
      price: oraclePrices[symbol] || data.price,
      contract: new ethers.Contract(data.address, TOKEN_ABI, wallet || provider),
    };
  }

  console.log('✅ Initialized:', DEPLOYMENT_FILE);
  console.log(`📍 Router: ${deployment.contracts.router}`);
  console.log(`📍 Factory: ${deployment.contracts.factory}`);
  console.log(`🪙 Tokens: ${Object.keys(tokens).join(', ')}`);

  if (!wallet) {
    console.log('\n⏸️  No PRIVATE_KEY — read-only mode (no arb bot, no shard manager)');
    return;
  }

  console.log(`\n📡 TxQueue ready (wallet: ${wallet.address})`);

  // Auto-start arb bot (unless ENABLE_ARBITRAGE=false)
  if (process.env.ENABLE_ARBITRAGE !== 'false') {
    console.log('\n🤖 Starting arbitrage bot...');
    arbitrageBot = new ArbitrageBot(DEPLOYMENT_FILE, normalizePK(process.env.PRIVATE_KEY), RPC_URL, txQueue);
    try { await arbitrageBot.start(); }
    catch (e) { console.error('⚠️  Arb bot error (non-fatal):', e.message?.slice(0, 100)); }
  }

  // Auto-start shard manager (unless ENABLE_DYNAMIC_SHARDING=false)
  if (process.env.ENABLE_DYNAMIC_SHARDING !== 'false') {
    console.log('\n🔧 Starting dynamic shard manager...');
    shardManager = new DynamicShardManager(DEPLOYMENT_FILE, normalizePK(process.env.PRIVATE_KEY), RPC_URL, txQueue);
    setTimeout(async () => {
      try { await shardManager.start(); }
      catch (e) { console.error('⚠️  Shard manager error (non-fatal):', e.message?.slice(0, 100)); }
    }, 5000);
  }
}

// ─── Helpers ────────────────────────────────────────────────────
async function getPoolData(poolAddress) {
  const cached = poolCache.get(poolAddress);
  if (cached && Date.now() - cached.timestamp < 10000) return cached.data;

  const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
  const [reserves, tA, tB] = await Promise.all([pool.getReserves(), pool.tokenA(), pool.tokenB()]);

  let symA, symB, decA, decB;
  for (const [sym, d] of Object.entries(tokens)) {
    if (d.address.toLowerCase() === tA.toLowerCase()) { symA = sym; decA = d.decimals; }
    if (d.address.toLowerCase() === tB.toLowerCase()) { symB = sym; decB = d.decimals; }
  }

  const data = {
    address: poolAddress, tokenA: symA, tokenB: symB,
    tokenAAddress: tA, tokenBAddress: tB,
    reserveA: ethers.formatUnits(reserves[0], decA),
    reserveB: ethers.formatUnits(reserves[1], decB),
  };
  poolCache.set(poolAddress, { data, timestamp: Date.now() });
  return data;
}

function findShardName(addr) {
  for (const shards of Object.values(deployment.contracts.shards)) {
    for (const s of shards) {
      if (s.address.toLowerCase() === addr.toLowerCase()) return s.name;
    }
  }
  return addr.slice(0, 12) + '…';
}

function buildHops(routeArray, amountOut) {
  const hops = [];
  for (let i = 0; i < routeArray.length - 1; i++) {
    const tIn = tokens[routeArray[i]], tOut = tokens[routeArray[i + 1]];
    if (!tIn || !tOut) throw new Error(`Invalid token: ${routeArray[i]} or ${routeArray[i + 1]}`);
    hops.push({
      tokenIn: tIn.address, tokenOut: tOut.address,
      amountOut: i === routeArray.length - 2 ? ethers.parseUnits(amountOut.toString(), tOut.decimals) : 0n,
    });
  }
  return hops;
}

// ═════════════════════════════════════════════════════════════════
//  ENDPOINTS
// ═════════════════════════════════════════════════════════════════

// ── Health ──
app.get('/health', async (req, res) => {
  await refreshOracle();
  res.json({
    status: 'ok', deployment: DEPLOYMENT_FILE, chain: deployment.chain || 'risechain',
    oraclePrices, wallet: wallet?.address || null,
    arbitrageBot: arbitrageBot ? { running: arbitrageBot.isRunning, stats: arbitrageBot.stats } : { enabled: false },
    shardManager: shardManager ? { running: shardManager.isRunning } : { enabled: false },
    txQueue: txQueue?.getStats() || null,
  });
});

// ── Tokens ──
app.get('/tokens', async (req, res) => {
  await refreshOracle();
  res.json({ tokens: Object.entries(tokens).map(([sym, d]) => ({
    symbol: sym, address: d.address, decimals: d.decimals, price: oraclePrices[sym] || d.price,
  })) });
});

// ── All pools ──
app.get('/pools', async (req, res) => {
  try {
    await refreshOracle();
    const pools = [];
    for (const [pair, shards] of Object.entries(deployment.contracts.shards)) {
      const sd = await Promise.all(shards.map(async (s) => {
        const pd = await getPoolData(s.address);
        const liq = parseFloat(pd.reserveA) * (oraclePrices[pd.tokenA] || 1) +
                    parseFloat(pd.reserveB) * (oraclePrices[pd.tokenB] || 1);
        return { name: s.name, address: s.address, tokenA: pd.tokenA, tokenB: pd.tokenB,
          reserveA: pd.reserveA, reserveB: pd.reserveB, liquidityUSD: Math.round(liq) };
      }));
      pools.push({ pair, shards: sd, totalLiquidityUSD: sd.reduce((a, b) => a + b.liquidityUSD, 0) });
    }
    res.json({ pools, totalPairs: pools.length, totalShards: pools.reduce((a, p) => a + p.shards.length, 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Pools for pair ──
app.get('/pools/:tokenA/:tokenB', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;
    const shards = deployment.contracts.shards[`${tokenA}-${tokenB}`] ||
                   deployment.contracts.shards[`${tokenB}-${tokenA}`];
    if (!shards) return res.status(404).json({ error: 'Pair not found', pairs: Object.keys(deployment.contracts.shards) });
    await refreshOracle();
    const sd = await Promise.all(shards.map(async (s) => {
      const pd = await getPoolData(s.address);
      const liq = parseFloat(pd.reserveA) * (oraclePrices[pd.tokenA] || 1) +
                  parseFloat(pd.reserveB) * (oraclePrices[pd.tokenB] || 1);
      return { name: s.name, address: s.address, tokenA: pd.tokenA, tokenB: pd.tokenB,
        reserveA: pd.reserveA, reserveB: pd.reserveB, liquidityUSD: Math.round(liq) };
    }));
    res.json({ pair: `${tokenA}-${tokenB}`, shards: sd });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Shards from blockchain ──
app.get('/shards/:tokenA/:tokenB', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;
    const tA = tokens[tokenA], tB = tokens[tokenB];
    if (!tA || !tB) return res.status(400).json({ error: 'Invalid token', tokens: Object.keys(tokens) });
    await refreshOracle();
    const fac = new ethers.Contract(deployment.contracts.factory,
      ['function getShardsForPair(address,address) view returns (address[])'], provider);
    const addrs = await fac.getShardsForPair(tA.address, tB.address);
    if (addrs.length === 0) return res.status(404).json({ error: 'No shards' });
    const sd = await Promise.all(addrs.map(async (a) => {
      const pd = await getPoolData(a);
      const liq = parseFloat(pd.reserveA) * (oraclePrices[pd.tokenA] || 1) +
                  parseFloat(pd.reserveB) * (oraclePrices[pd.tokenB] || 1);
      return { address: a, name: findShardName(a), tokenA: pd.tokenA, tokenB: pd.tokenB,
        reserveA: pd.reserveA, reserveB: pd.reserveB, liquidityUSD: Math.round(liq) };
    }));
    sd.sort((a, b) => a.liquidityUSD - b.liquidityUSD);
    res.json({ tokenA, tokenB, shards: sd, totalShards: sd.length,
      totalLiquidityUSD: sd.reduce((a, b) => a + b.liquidityUSD, 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /quote/:tokenIn/:tokenOut/:amountOut — quick quote with slippage ──
app.get('/quote/:tokenIn/:tokenOut/:amountOut', async (req, res) => {
  try {
    const { tokenIn, tokenOut, amountOut } = req.params;
    const tIn = tokens[tokenIn], tOut = tokens[tokenOut];
    if (!tIn || !tOut) return res.status(400).json({ error: 'Invalid token' });
    await refreshOracle();

    const hops = [{ tokenIn: tIn.address, tokenOut: tOut.address,
      amountOut: ethers.parseUnits(amountOut, tOut.decimals) }];
    const q = await router.quoteSwap(hops);

    const amtIn = parseFloat(ethers.formatUnits(q.expectedAmountIn, tIn.decimals));
    const amtOut = parseFloat(amountOut);
    const fee = parseFloat(ethers.formatUnits(q.hopFees[0], tIn.decimals));
    const feePct = (fee / amtIn) * 100;
    const rate = amtOut / amtIn;
    const oracle = (oraclePrices[tokenIn] || 1) / (oraclePrices[tokenOut] || 1);
    const slip = ((rate - oracle) / oracle) * 100;
    const usd = amtOut * (oraclePrices[tokenOut] || 1);

    const amtInUSD = amtIn * (oraclePrices[tokenIn] || 1);
    const feeUSD = fee * (oraclePrices[tokenIn] || 1);

    res.json({
      tokenIn, tokenOut, amountOut,
      amountIn: amtIn.toFixed(8),
      amountInUSD: amtInUSD.toFixed(2),
      amountOutUSD: usd.toFixed(2),
      effectiveRate: rate.toFixed(8),
      rateDescription: `1 ${tokenOut} = ${(1 / rate).toFixed(8)} ${tokenIn}`,
      oracleRate: oracle.toFixed(8),
      oracleRateDescription: `1 ${tokenOut} = ${(1 / oracle).toFixed(8)} ${tokenIn} (CoinGecko)`,
      slippagePct: slip.toFixed(4),
      fee: fee.toFixed(8),
      feeUSD: feeUSD.toFixed(4),
      feePct: feePct.toFixed(4),
      selectedShard: findShardName(q.selectedShards[0]),
      selectedShardAddress: q.selectedShards[0],
      priceImpact: `${(Number(q.priceImpacts[0]) / 10000).toFixed(2)}%`,
      oraclePrices: { [tokenIn]: oraclePrices[tokenIn], [tokenOut]: oraclePrices[tokenOut] },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /quote — full quote (single or multi-hop) ──
app.post('/quote', async (req, res) => {
  try {
    const { tokenIn, tokenOut, route, amountOut } = req.body;
    if (!amountOut) return res.status(400).json({ error: 'Missing: amountOut' });
    await refreshOracle();

    const routeArr = route && Array.isArray(route) ? route : [tokenIn, tokenOut];
    if (routeArr.length < 2 || routeArr.some(t => !tokens[t]))
      return res.status(400).json({ error: 'Invalid route', tokens: Object.keys(tokens) });

    const hops = buildHops(routeArr, amountOut);
    const q = await router.quoteSwap(hops);

    const amtIn = parseFloat(ethers.formatUnits(q.expectedAmountIn, tokens[routeArr[0]].decimals));
    const amtOut = parseFloat(amountOut);
    const rate = amtOut / amtIn;
    const oracle = (oraclePrices[routeArr[0]] || 1) / (oraclePrices[routeArr[routeArr.length - 1]] || 1);
    const slip = ((rate - oracle) / oracle) * 100;

    let totalFeeUSD = 0;
    const hopDetails = [];
    for (let i = 0; i < q.hopFees.length; i++) {
      const f = parseFloat(ethers.formatUnits(q.hopFees[i], tokens[routeArr[i]].decimals));
      totalFeeUSD += f * (oraclePrices[routeArr[i]] || 1);
      hopDetails.push({
        tokenIn: routeArr[i], tokenOut: routeArr[i + 1],
        fee: f.toFixed(8), shard: findShardName(q.selectedShards[i]),
        shardAddress: q.selectedShards[i],
        priceImpact: `${(Number(q.priceImpacts[i]) / 10000).toFixed(2)}%`,
      });
    }

    const amtInUSD = amtIn * (oraclePrices[routeArr[0]] || 1);
    const amtOutUSD = amtOut * (oraclePrices[routeArr[routeArr.length - 1]] || 1);

    res.json({
      route: routeArr, amountOut, amountIn: amtIn.toFixed(8),
      amountInUSD: amtInUSD.toFixed(2),
      amountOutUSD: amtOutUSD.toFixed(2),
      effectiveRate: rate.toFixed(8),
      rateDescription: `1 ${routeArr[routeArr.length-1]} = ${(1/rate).toFixed(8)} ${routeArr[0]}`,
      oracleRate: oracle.toFixed(8),
      slippagePct: slip.toFixed(4),
      totalFeeUSD: totalFeeUSD.toFixed(4),
      feePctOfInput: ((totalFeeUSD / amtInUSD) * 100).toFixed(4),
      hops: hopDetails,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /swap — execute swap via router (requires wallet) ──
app.post('/swap', async (req, res) => {
  if (!wallet) return res.status(400).json({ error: 'No wallet — read-only mode' });
  try {
    const { tokenIn, tokenOut, route, amountOut, slippagePct } = req.body;
    if (!amountOut) return res.status(400).json({ error: 'Missing: amountOut' });
    const slip = parseFloat(slippagePct || '1.0');

    const routeArr = route && Array.isArray(route) ? route : [tokenIn, tokenOut];
    if (routeArr.length < 2 || routeArr.some(t => !tokens[t]))
      return res.status(400).json({ error: 'Invalid route' });

    const hops = buildHops(routeArr, amountOut);
    const q = await router.quoteSwap(hops);
    const maxIn = q.expectedAmountIn * BigInt(Math.round(10000 + slip * 100)) / 10000n;

    // Ensure approval
    const tIn = tokens[routeArr[0]];
    const routerAddr = deployment.contracts.router;
    const allow = await tIn.contract.allowance(wallet.address, routerAddr);
    if (allow < maxIn) {
      const r = await txQueue.send(
        (nonce) => tIn.contract.approve(routerAddr, ethers.MaxUint256, { nonce, gasLimit: 100_000 }),
        `approve ${routeArr[0]}→router`
      );
      if (!r.success) return res.status(500).json({ error: `Approve failed: ${r.error}` });
    }

    // Execute
    const result = await txQueue.send(
      (nonce) => router.executeSwap(hops, maxIn, wallet.address, { nonce, gasLimit: 800_000 }),
      `swap ${routeArr.join('→')}`
    );
    if (!result.success) return res.status(500).json({ error: result.error });

    const amtIn = ethers.formatUnits(q.expectedAmountIn, tIn.decimals);
    res.json({
      success: true, txHash: result.txHash, blockNumber: result.receipt.blockNumber,
      route: routeArr, amountOut, amountIn: amtIn,
      selectedShards: q.selectedShards.map(a => findShardName(a)),
      gasUsed: result.receipt.gasUsed.toString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Price ──
app.get('/price/:tokenA/:tokenB', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;
    const tA = tokens[tokenA], tB = tokens[tokenB];
    if (!tA || !tB) return res.status(400).json({ error: 'Invalid token' });

    const shards = deployment.contracts.shards[`${tokenA}-${tokenB}`] ||
                   deployment.contracts.shards[`${tokenB}-${tokenA}`];
    if (!shards?.length) return res.status(404).json({ error: 'No pool' });

    const pool = new ethers.Contract(shards[shards.length - 1].address, POOL_ABI, provider);
    const oneUnit = ethers.parseUnits('1', tB.decimals);
    const q = await pool.calculateSwapSAMM(oneUnit, tA.address, tB.address);
    const price = ethers.formatUnits(q.amountIn, tA.decimals);

    await refreshOracle();
    const oracleRate = (oraclePrices[tokenA] || 1) / (oraclePrices[tokenB] || 1);
    const spotRate = parseFloat(price);
    const deviation = ((spotRate - oracleRate) / oracleRate * 100);
    const spotPriceUSD = oraclePrices[tokenB] || 1;

    res.json({
      pair: `${tokenA}/${tokenB}`,
      price,
      description: `1 ${tokenB} = ${price} ${tokenA}`,
      spotPriceUSD: spotPriceUSD.toFixed(2),
      oracleRate: oracleRate.toFixed(8),
      deviationPct: deviation.toFixed(4),
      pool: shards[shards.length - 1].name,
      poolAddress: shards[shards.length - 1].address,
      oraclePrices: { [tokenA]: oraclePrices[tokenA], [tokenB]: oraclePrices[tokenB] },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Balances ──
app.get('/balance/:address/:token', async (req, res) => {
  try {
    const { address, token } = req.params;
    if (!ethers.isAddress(address)) return res.status(400).json({ error: 'Invalid address' });
    const t = tokens[token];
    if (!t) return res.status(400).json({ error: 'Invalid token' });
    const bal = await t.contract.balanceOf(address);
    res.json({ address, token, balance: ethers.formatUnits(bal, t.decimals), balanceRaw: bal.toString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/balances/:address', async (req, res) => {
  try {
    const { address } = req.params;
    if (!ethers.isAddress(address)) return res.status(400).json({ error: 'Invalid address' });
    const bals = {};
    for (const [sym, t] of Object.entries(tokens)) {
      const bal = await t.contract.balanceOf(address);
      bals[sym] = { balance: ethers.formatUnits(bal, t.decimals), balanceRaw: bal.toString(),
        decimals: t.decimals, address: t.address };
    }
    res.json({ address, balances: bals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Stats ──
app.get('/stats', async (req, res) => {
  try {
    await refreshOracle();
    let totalLiq = 0;
    const pairStats = {};
    for (const [pair, shards] of Object.entries(deployment.contracts.shards)) {
      let pairLiq = 0;
      for (const s of shards) {
        const pd = await getPoolData(s.address);
        const l = parseFloat(pd.reserveA) * (oraclePrices[pd.tokenA] || 1) +
                  parseFloat(pd.reserveB) * (oraclePrices[pd.tokenB] || 1);
        pairLiq += l;
      }
      totalLiq += pairLiq;
      pairStats[pair] = { shards: shards.length, liquidityUSD: Math.round(pairLiq),
        shardNames: shards.map(s => s.name) };
    }
    res.json({
      totalPairs: Object.keys(deployment.contracts.shards).length,
      totalShards: Object.values(deployment.contracts.shards).reduce((s, a) => s + a.length, 0),
      totalLiquidityUSD: Math.round(totalLiq),
      pairs: pairStats, tokens: Object.keys(tokens).length,
      router: deployment.contracts.router, factory: deployment.contracts.factory,
      orchestrator: deployment.contracts.orchestrator || null,
      oraclePrices,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Arbitrage Bot ──────────────────────────────────────────────
app.get('/arbitrage/status', (req, res) => {
  if (!arbitrageBot) return res.json({ enabled: false });
  res.json(arbitrageBot.getStatus());
});

app.get('/arbitrage/history', (req, res) => {
  if (!arbitrageBot) return res.json({ enabled: false, history: [] });
  const limit = parseInt(req.query.limit || '50');
  const pair = req.query.pair || undefined;
  const status = req.query.status || undefined;
  res.json({ history: arbitrageBot.getHistory(limit, { pair, status }) });
});

app.post('/arbitrage/start', async (req, res) => {
  if (!wallet) return res.status(400).json({ error: 'No PRIVATE_KEY' });
  if (!arbitrageBot) {
    arbitrageBot = new ArbitrageBot(DEPLOYMENT_FILE, normalizePK(process.env.PRIVATE_KEY), RPC_URL, txQueue);
  }
  try { await arbitrageBot.start(); res.json({ success: true, status: arbitrageBot.getStatus() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/arbitrage/stop', (req, res) => {
  if (!arbitrageBot) return res.status(400).json({ error: 'Not initialized' });
  arbitrageBot.stop();
  res.json({ success: true, status: arbitrageBot.getStatus() });
});

// ─── Dynamic Shard Manager ─────────────────────────────────────
app.get('/sharding/status', (req, res) => {
  if (!shardManager) return res.json({ enabled: false });
  res.json(shardManager.getStatus());
});

app.post('/sharding/start', async (req, res) => {
  if (!wallet) return res.status(400).json({ error: 'No PRIVATE_KEY' });
  if (!shardManager) {
    shardManager = new DynamicShardManager(DEPLOYMENT_FILE, normalizePK(process.env.PRIVATE_KEY), RPC_URL, txQueue);
  }
  try { await shardManager.start(); res.json({ success: true, status: shardManager.getStatus() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/sharding/stop', (req, res) => {
  if (!shardManager) return res.status(400).json({ error: 'Not initialized' });
  shardManager.stop();
  res.json({ success: true, status: shardManager.getStatus() });
});

app.post('/sharding/check', async (req, res) => {
  if (!shardManager) return res.status(400).json({ error: 'Not initialized' });
  try { await shardManager.checkAndManageShards(); res.json({ success: true, status: shardManager.getStatus() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ──────────────────────────────────────────────────────
initialize().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 SAMM DEX API Server on port ${PORT}`);
    console.log(`\n📚 Endpoints:`);
    console.log(`   GET  /health                          — health + status`);
    console.log(`   GET  /tokens                          — tokens with prices`);
    console.log(`   GET  /pools                           — all pools with TVL`);
    console.log(`   GET  /pools/:tokenA/:tokenB           — pools for pair`);
    console.log(`   GET  /shards/:tokenA/:tokenB          — shards from chain`);
    console.log(`   GET  /quote/:tokenIn/:tokenOut/:amt   — quick quote + slippage`);
    console.log(`   POST /quote                           — full quote (multi-hop)`);
    console.log(`   POST /swap                            — execute swap via router`);
    console.log(`   GET  /price/:tokenA/:tokenB           — spot price`);
    console.log(`   GET  /balance/:addr/:token            — token balance`);
    console.log(`   GET  /balances/:addr                  — all balances`);
    console.log(`   GET  /stats                           — DEX statistics`);
    console.log(`   GET  /arbitrage/status                — arb bot status`);
    console.log(`   GET  /arbitrage/history?limit=50      — arb swap log`);
    console.log(`   POST /arbitrage/start|stop            — control arb bot`);
    console.log(`   GET  /sharding/status                 — shard manager status`);
    console.log(`   POST /sharding/start|stop|check       — control shard manager`);
    console.log(`\n💡 curl http://localhost:${PORT}/health\n`);
  });
}).catch(err => { console.error('Failed:', err); process.exit(1); });
