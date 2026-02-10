const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Load deployment data
const DEPLOYMENT_FILE = process.env.DEPLOYMENT_FILE || 'production-risechain-1770744587343.json';
const deploymentPath = path.join(__dirname, 'deployment-data', DEPLOYMENT_FILE);
const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));

// Setup provider
const RPC_URL = process.env.RISECHAIN_RPC_URL || 'https://testnet.riselabs.xyz/http';
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Contract instances
let router, factory;
const tokens = {};
const poolCache = new Map();

// ABIs
const POOL_ABI = [
  'function getReserves() view returns (uint256 _reserveA, uint256 _reserveB)',
  'function tokenA() view returns (address)',
  'function tokenB() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function sammParams() view returns (int256 beta1, uint256 rmin, uint256 rmax, uint256 c)',
  'function feeParams() view returns (uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator)'
];

async function initialize() {
  router = new ethers.Contract(
    deployment.contracts.router,
    [
      'function quoteSwap((address tokenIn, address tokenOut, uint256 amountOut)[] hops) view returns (tuple(uint256 expectedAmountIn, uint256[] hopAmountsIn, uint256[] hopFees, address[] selectedShards, uint256[] priceImpacts))'
    ],
    provider
  );
  
  factory = new ethers.Contract(
    deployment.contracts.factory,
    [
      'function getShardsForPair(address tokenA, address tokenB) view returns (address[] memory)',
      'function getShardInfo(address shard) view returns (address creator, bool isActive, uint256 createdAt)'
    ],
    provider
  );
  
  // Load token contracts
  for (const [symbol, data] of Object.entries(deployment.contracts.tokens)) {
    tokens[symbol] = {
      address: data.address,
      decimals: data.decimals,
      price: data.price,
      contract: new ethers.Contract(
        data.address,
        ['function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function balanceOf(address) view returns (uint256)', 'function name() view returns (string)'],
        provider
      )
    };
  }
  
  console.log('✅ Initialized with deployment:', DEPLOYMENT_FILE);
  console.log(`📍 Router: ${deployment.contracts.router}`);
  console.log(`📍 Factory: ${deployment.contracts.factory}`);
  console.log(`🪙 Tokens: ${Object.keys(tokens).join(', ')}`);
}

// Helper: Get pool data from blockchain (simplified - only reserves)
async function getPoolData(poolAddress) {
  if (poolCache.has(poolAddress)) {
    const cached = poolCache.get(poolAddress);
    if (Date.now() - cached.timestamp < 10000) { // 10s cache
      return cached.data;
    }
  }
  
  console.log(`📡 Fetching pool data for ${poolAddress}...`);
  
  try {
    const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
    
    const [reserves, tokenA, tokenB] = await Promise.all([
      pool.getReserves(),
      pool.tokenA(),
      pool.tokenB()
    ]);
    
    const [reserveA, reserveB] = reserves;
    
    // Find token symbols
    let tokenASymbol, tokenBSymbol, decimalsA, decimalsB;
    for (const [symbol, data] of Object.entries(tokens)) {
      if (data.address.toLowerCase() === tokenA.toLowerCase()) {
        tokenASymbol = symbol;
        decimalsA = data.decimals;
      }
      if (data.address.toLowerCase() === tokenB.toLowerCase()) {
        tokenBSymbol = symbol;
        decimalsB = data.decimals;
      }
    }
    
    const data = {
      address: poolAddress,
      tokenA: tokenASymbol,
      tokenB: tokenBSymbol,
      tokenAAddress: tokenA,
      tokenBAddress: tokenB,
      reserveA: ethers.formatUnits(reserveA, decimalsA),
      reserveB: ethers.formatUnits(reserveB, decimalsB),
      reserveARaw: reserveA.toString(),
      reserveBRaw: reserveB.toString()
    };
    
    poolCache.set(poolAddress, { data, timestamp: Date.now() });
    console.log(`  ✅ Pool data cached: ${tokenASymbol}/${tokenBSymbol}`);
    return data;
  } catch (error) {
    console.error(`  ❌ Error fetching pool data: ${error.message}`);
    throw error;
  }
}

// GET /health - Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', deployment: DEPLOYMENT_FILE });
});

// GET /tokens - List all tokens
app.get('/tokens', (req, res) => {
  const tokenList = Object.entries(tokens).map(([symbol, data]) => ({
    symbol,
    address: data.address,
    decimals: data.decimals,
    price: data.price
  }));
  res.json({ tokens: tokenList });
});

// GET /pools - List all pools with real-time data
app.get('/pools', async (req, res) => {
  try {
    const poolList = [];
    
    for (const [pair, shards] of Object.entries(deployment.contracts.shards)) {
      const shardsData = await Promise.all(
        shards.map(async (s) => {
          const poolData = await getPoolData(s.address);
          const liquidityUSD = parseFloat(poolData.reserveA) * tokens[poolData.tokenA].price + 
                               parseFloat(poolData.reserveB) * tokens[poolData.tokenB].price;
          
          return {
            name: s.name,
            address: s.address,
            tokenA: poolData.tokenA,
            tokenB: poolData.tokenB,
            reserveA: poolData.reserveA,
            reserveB: poolData.reserveB,
            liquidityUSD: liquidityUSD.toFixed(2)
          };
        })
      );
      
      poolList.push({ pair, shards: shardsData });
    }
    
    res.json({ pools: poolList });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /pools/:tokenA/:tokenB - Get pools for a specific pair with real-time data
app.get('/pools/:tokenA/:tokenB', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;
    const pairKey = `${tokenA}-${tokenB}`;
    const reversePairKey = `${tokenB}-${tokenA}`;
    
    const shards = deployment.contracts.shards[pairKey] || deployment.contracts.shards[reversePairKey];
    
    if (!shards) {
      return res.status(404).json({ error: 'Pool not found' });
    }
    
    const shardsData = await Promise.all(
      shards.map(async (s) => {
        const poolData = await getPoolData(s.address);
        const liquidityUSD = parseFloat(poolData.reserveA) * tokens[poolData.tokenA].price + 
                             parseFloat(poolData.reserveB) * tokens[poolData.tokenB].price;
        
        return {
          name: s.name,
          address: s.address,
          tokenA: poolData.tokenA,
          tokenB: poolData.tokenB,
          reserveA: poolData.reserveA,
          reserveB: poolData.reserveB,
          liquidityUSD: liquidityUSD.toFixed(2)
        };
      })
    );
    
    res.json({ pair: pairKey, shards: shardsData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /quote - Get quote for a swap
app.post('/quote', async (req, res) => {
  try {
    const { tokenIn, tokenOut, amountOut } = req.body;
    
    console.log(`\n📊 Quote request: ${tokenIn} → ${tokenOut}, amount: ${amountOut}`);
    
    if (!tokenIn || !tokenOut || !amountOut) {
      return res.status(400).json({ error: 'Missing required fields: tokenIn, tokenOut, amountOut' });
    }
    
    const tokenInData = tokens[tokenIn];
    const tokenOutData = tokens[tokenOut];
    
    if (!tokenInData || !tokenOutData) {
      console.log(`  ❌ Invalid token: ${tokenIn} or ${tokenOut}`);
      return res.status(400).json({ error: 'Invalid token symbol' });
    }
    
    const amountOutParsed = ethers.parseUnits(amountOut.toString(), tokenOutData.decimals);
    console.log(`  ↳ Amount out parsed: ${amountOutParsed.toString()}`);
    console.log(`  ↳ TokenIn: ${tokenInData.address}`);
    console.log(`  ↳ TokenOut: ${tokenOutData.address}`);
    
    console.log(`  ↳ Calling router.quoteSwap()...`);
    const quote = await router.quoteSwap([{
      tokenIn: tokenInData.address,
      tokenOut: tokenOutData.address,
      amountOut: amountOutParsed
    }]);
    
    console.log(`  ✅ Quote received`);
    console.log(`  ↳ Expected amount in: ${quote.expectedAmountIn.toString()}`);
    console.log(`  ↳ Selected shard: ${quote.selectedShards[0]}`);
    
    const expectedAmountIn = ethers.formatUnits(quote.expectedAmountIn, tokenInData.decimals);
    const fee = ethers.formatUnits(quote.hopFees[0], tokenInData.decimals);
    const priceImpact = Number(quote.priceImpacts[0]) / 10000; // basis points to percentage
    
    res.json({
      tokenIn,
      tokenOut,
      amountOut,
      expectedAmountIn,
      fee,
      priceImpact: `${priceImpact.toFixed(2)}%`,
      selectedShard: quote.selectedShards[0],
      route: [tokenIn, tokenOut]
    });
  } catch (error) {
    console.error(`  ❌ Quote error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// POST /quote-multi - Get quote for multi-hop swap
app.post('/quote-multi', async (req, res) => {
  try {
    const { route, amountOut } = req.body;
    
    if (!route || !Array.isArray(route) || route.length < 2 || !amountOut) {
      return res.status(400).json({ error: 'Invalid route or amountOut' });
    }
    
    const hops = [];
    for (let i = 0; i < route.length - 1; i++) {
      const tokenInData = tokens[route[i]];
      const tokenOutData = tokens[route[i + 1]];
      
      if (!tokenInData || !tokenOutData) {
        return res.status(400).json({ error: `Invalid token in route: ${route[i]} or ${route[i + 1]}` });
      }
      
      const amount = i === route.length - 2 
        ? ethers.parseUnits(amountOut.toString(), tokenOutData.decimals)
        : 0n; // Router calculates intermediate amounts
      
      hops.push({
        tokenIn: tokenInData.address,
        tokenOut: tokenOutData.address,
        amountOut: amount
      });
    }
    
    const quote = await router.quoteSwap(hops);
    const firstTokenDecimals = tokens[route[0]].decimals;
    
    const expectedAmountIn = ethers.formatUnits(quote.expectedAmountIn, firstTokenDecimals);
    const totalFee = quote.hopFees.reduce((sum, fee, i) => {
      const decimals = tokens[route[i]].decimals;
      return sum + parseFloat(ethers.formatUnits(fee, decimals));
    }, 0);
    
    res.json({
      route,
      amountOut,
      expectedAmountIn,
      totalFee: totalFee.toFixed(6),
      hops: quote.selectedShards.length,
      selectedShards: quote.selectedShards,
      priceImpacts: quote.priceImpacts.map(pi => `${(Number(pi) / 10000).toFixed(2)}%`)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /balance/:address/:token - Get token balance
app.get('/balance/:address/:token', async (req, res) => {
  try {
    const { address, token } = req.params;
    
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    
    const tokenData = tokens[token];
    if (!tokenData) {
      return res.status(400).json({ error: 'Invalid token symbol' });
    }
    
    const balance = await tokenData.contract.balanceOf(address);
    const formatted = ethers.formatUnits(balance, tokenData.decimals);
    
    res.json({
      address,
      token,
      balance: formatted,
      balanceRaw: balance.toString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /balances/:address - Get all token balances for an address
app.get('/balances/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    
    const balances = {};
    
    for (const [symbol, tokenData] of Object.entries(tokens)) {
      const balance = await tokenData.contract.balanceOf(address);
      balances[symbol] = {
        balance: ethers.formatUnits(balance, tokenData.decimals),
        balanceRaw: balance.toString(),
        decimals: tokenData.decimals,
        address: tokenData.address
      };
    }
    
    res.json({ address, balances });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /stats - Get overall DEX statistics with real-time data
app.get('/stats', async (req, res) => {
  try {
    const totalPools = Object.values(deployment.contracts.shards).reduce((sum, shards) => sum + shards.length, 0);
    
    // Calculate real-time TVL
    let totalLiquidity = 0;
    for (const shards of Object.values(deployment.contracts.shards)) {
      for (const shard of shards) {
        const poolData = await getPoolData(shard.address);
        const liquidityUSD = parseFloat(poolData.reserveA) * tokens[poolData.tokenA].price + 
                             parseFloat(poolData.reserveB) * tokens[poolData.tokenB].price;
        totalLiquidity += liquidityUSD;
      }
    }
    
    res.json({
      totalPools,
      totalPairs: Object.keys(deployment.contracts.shards).length,
      totalLiquidityUSD: totalLiquidity.toFixed(2),
      tokens: Object.keys(tokens).length,
      router: deployment.contracts.router,
      factory: deployment.contracts.factory
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /price/:tokenA/:tokenB - Get current price (bypasses c-threshold for price discovery)
app.get('/price/:tokenA/:tokenB', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;
    
    console.log(`\n💱 Price request: ${tokenA}/${tokenB}`);
    
    const tokenAData = tokens[tokenA];
    const tokenBData = tokens[tokenB];
    
    if (!tokenAData || !tokenBData) {
      return res.status(400).json({ error: 'Invalid token symbol' });
    }
    
    // Get any pool for this pair (we just need price, not actual swap)
    const pairKey = `${tokenA}-${tokenB}`;
    const reversePairKey = `${tokenB}-${tokenA}`;
    const shards = deployment.contracts.shards[pairKey] || deployment.contracts.shards[reversePairKey];
    
    if (!shards || shards.length === 0) {
      return res.status(404).json({ error: 'No pool found for this pair' });
    }
    
    // Use the largest pool for most accurate price
    const largestPool = shards[shards.length - 1];
    console.log(`  ↳ Using pool: ${largestPool.name} (${largestPool.address})`);
    
    // Query pool directly with calculateSwapSAMM (no c-threshold check)
    const poolContract = new ethers.Contract(
      largestPool.address,
      [
        'function calculateSwapSAMM(uint256 amountOut, address tokenIn, address tokenOut) view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))'
      ],
      provider
    );
    
    // Calculate for 1 unit of tokenB
    const amountOut = ethers.parseUnits('1', tokenBData.decimals);
    
    const result = await poolContract.calculateSwapSAMM(
      amountOut,
      tokenAData.address,
      tokenBData.address
    );
    
    const price = ethers.formatUnits(result.amountIn, tokenAData.decimals);
    
    console.log(`  ✅ Price: 1 ${tokenB} = ${price} ${tokenA}`);
    
    res.json({
      pair: `${tokenA}/${tokenB}`,
      price,
      description: `1 ${tokenB} = ${price} ${tokenA}`,
      pool: largestPool.name,
      note: 'Price from pool.calculateSwapSAMM() - for reference only, actual swap may be limited by c-threshold'
    });
  } catch (error) {
    console.error(`  ❌ Price error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;

initialize().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 SAMM DEX API Server running on port ${PORT}`);
    console.log(`\n📚 Available endpoints:`);
    console.log(`   GET  /health - Health check`);
    console.log(`   GET  /tokens - List all tokens`);
    console.log(`   GET  /pools - List all pools`);
    console.log(`   GET  /pools/:tokenA/:tokenB - Get pools for pair`);
    console.log(`   POST /quote - Get swap quote`);
    console.log(`   POST /quote-multi - Get multi-hop quote`);
    console.log(`   GET  /balance/:address/:token - Get token balance`);
    console.log(`   GET  /balances/:address - Get all balances`);
    console.log(`   GET  /stats - Get DEX statistics`);
    console.log(`   GET  /price/:tokenA/:tokenB - Get current price`);
    console.log(`\n💡 Example: curl http://localhost:${PORT}/tokens\n`);
  });
}).catch(error => {
  console.error('Failed to initialize:', error);
  process.exit(1);
});
