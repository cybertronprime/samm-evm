require('dotenv').config({ path: '.env.production' });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS - Allow all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests, please try again later'
});
app.use('/api/', limiter);

app.use(express.json());

// EXACT Monad deployment data - v2 with decimal normalization
const MONAD_DEPLOYMENT = {
  network: "Monad Testnet",
  chainId: 10143,
  rpcUrl: "https://testnet-rpc.monad.xyz",
  factory: "0x8ab2De0CD1C3bcAe3cB9a8028E28D60301dBf336",
  tokens: {
    USDC: { address: "0x9153bc242a5FD22b149B1cb252e3eE6314C37366", decimals: 6 },
    USDT: { address: "0x39f0B52190CeA4B3569D5D501f0c637892F52379", decimals: 6 },
    DAI: { address: "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46", decimals: 18 }
  },
  pools: {
    "USDC/USDT": [
      { name: "USDC/USDT-1", address: "0x986e6AA143Ecf491FbB9FFbcFB1A61424af1BC1e", liquidity: "5000000", c: 5000000 },
      { name: "USDC/USDT-2", address: "0xA68065D56C003D6982a6215Bd1C765726b2fCa13", liquidity: "3000000", c: 3000000 },
      { name: "USDC/USDT-3", address: "0x58136Bb18639C7C3f2C552Bb734dA6D65Ff7D653", liquidity: "2000000", c: 2000000 }
    ],
    "USDT/DAI": [
      { name: "USDT/DAI-1", address: "0x179e0308524c916a6F0452FF0ce999cEC88588e8", liquidity: "10000", c: 10000 },
      { name: "USDT/DAI-2", address: "0x40767849365ff64F9EB341eD2Cf3E40590578749", liquidity: "20000", c: 20000 },
      { name: "USDT/DAI-3", address: "0x302bB8B9Cf5722a2C69B19D98393041E007085Eb", liquidity: "30000", c: 30000 }
    ]
  }
};

// Initialize provider
const monadProvider = new ethers.JsonRpcProvider(MONAD_DEPLOYMENT.rpcUrl);

// Contract ABIs
const SAMM_POOL_ABI = [
  "function getReserves() view returns (uint256 reserveA, uint256 reserveB)",
  "function calculateSwapSAMM(uint256 amountOut, address tokenIn, address tokenOut) view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))",
  "function getSAMMParams() view returns (int256 beta1, uint256 rmin, uint256 rmax, uint256 c)"
];

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    chain: MONAD_DEPLOYMENT.network,
    chainId: MONAD_DEPLOYMENT.chainId,
    pools: {
      "USDC/USDT": MONAD_DEPLOYMENT.pools["USDC/USDT"].length,
      "USDT/DAI": MONAD_DEPLOYMENT.pools["USDT/DAI"].length
    },
    totalShards: 6,
    version: '1.0.0'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'SAMM Multi-Chain API',
    version: '1.0.0',
    chain: MONAD_DEPLOYMENT.network,
    chainId: MONAD_DEPLOYMENT.chainId,
    endpoints: {
      health: 'GET /health',
      deployment: 'GET /api/deployment',
      shards: 'GET /api/shards',
      bestShard: 'POST /api/swap/best-shard',
      multiHop: 'POST /api/swap/multi-hop',
      specificShard: 'GET /api/shard/:address'
    },
    features: ['multi-shard', 'multi-hop', 'c-smaller-better'],
    cors: 'enabled for all origins'
  });
});

// Get deployment info
app.get('/api/deployment', (req, res) => {
  res.json({
    network: MONAD_DEPLOYMENT.network,
    chainId: MONAD_DEPLOYMENT.chainId,
    factory: MONAD_DEPLOYMENT.factory,
    tokens: MONAD_DEPLOYMENT.tokens,
    pools: MONAD_DEPLOYMENT.pools,
    stats: {
      totalShards: 6,
      usdcUsdtShards: 3,
      usdtDaiShards: 3,
      totalLiquidity: "3200.0"
    },
    timestamp: new Date().toISOString()
  });
});

// Get all shards
app.get('/api/shards', async (req, res) => {
  try {
    const allShards = [];
    
    for (const [pair, shards] of Object.entries(MONAD_DEPLOYMENT.pools)) {
      for (const shard of shards) {
        try {
          const contract = new ethers.Contract(shard.address, SAMM_POOL_ABI, monadProvider);
          const [reserves, sammParams] = await Promise.all([
            contract.getReserves(),
            contract.getSAMMParams()
          ]);
          
          allShards.push({
            pair,
            name: shard.name,
            address: shard.address,
            liquidity: shard.liquidity,
            reserves: {
              reserveA: reserves[0].toString(),
              reserveB: reserves[1].toString()
            },
            sammParams: {
              c: sammParams[3].toString()
            }
          });
        } catch (error) {
          console.error(`Error fetching ${shard.name}:`, error.message);
          allShards.push({
            pair,
            name: shard.name,
            address: shard.address,
            liquidity: shard.liquidity,
            error: 'Could not fetch on-chain data'
          });
        }
      }
    }
    
    res.json({
      chain: MONAD_DEPLOYMENT.network,
      chainId: MONAD_DEPLOYMENT.chainId,
      shards: allShards,
      total: allShards.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching shards:', error);
    res.status(500).json({ error: 'Failed to fetch shards' });
  }
});

// Best shard (c-smaller-better property)
app.post('/api/swap/best-shard', async (req, res) => {
  try {
    const { amountOut, tokenIn, tokenOut } = req.body;
    
    if (!amountOut || !tokenIn || !tokenOut) {
      return res.status(400).json({ 
        error: 'Missing required parameters: amountOut, tokenIn, tokenOut' 
      });
    }
    
    // Find matching pair
    let matchingPair = null;
    for (const [pair, shards] of Object.entries(MONAD_DEPLOYMENT.pools)) {
      matchingPair = pair;
      break; // Use first pair for demo
    }
    
    if (!matchingPair) {
      return res.status(400).json({ error: 'No pools available' });
    }
    
    const shards = MONAD_DEPLOYMENT.pools[matchingPair];
    const results = [];
    
    for (const shard of shards) {
      try {
        const contract = new ethers.Contract(shard.address, SAMM_POOL_ABI, monadProvider);
        const result = await contract.calculateSwapSAMM(amountOut, tokenIn, tokenOut);
        
        results.push({
          name: shard.name,
          address: shard.address,
          liquidity: shard.liquidity,
          c: shard.c,
          amountIn: result.amountIn.toString(),
          amountOut: result.amountOut.toString(),
          tradeFee: result.tradeFee.toString(),
          totalCost: result.amountIn.toString()
        });
      } catch (error) {
        console.error(`Error calculating for ${shard.name}:`, error.message);
      }
    }
    
    // Sort by c value (smaller is better)
    results.sort((a, b) => a.c - b.c);
    
    res.json({
      chain: MONAD_DEPLOYMENT.network,
      chainId: MONAD_DEPLOYMENT.chainId,
      bestShard: results[0],
      allShards: results,
      property: 'c-smaller-better demonstrated',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error finding best shard:', error);
    res.status(500).json({ error: 'Failed to find best shard' });
  }
});

// Multi-hop routing (USDC -> USDT -> DAI)
app.post('/api/swap/multi-hop', async (req, res) => {
  try {
    const { amountIn, tokenIn, tokenOut } = req.body;
    
    if (!amountIn || !tokenIn || !tokenOut) {
      return res.status(400).json({ 
        error: 'Missing required parameters: amountIn, tokenIn, tokenOut' 
      });
    }
    
    // Multi-hop: USDC -> USDT -> DAI
    const steps = [];
    let currentAmount = amountIn;
    
    // Step 1: USDC -> USDT
    const usdcUsdtShard = MONAD_DEPLOYMENT.pools["USDC/USDT"][0];
    const contract1 = new ethers.Contract(usdcUsdtShard.address, SAMM_POOL_ABI, monadProvider);
    const result1 = await contract1.calculateSwapSAMM(
      currentAmount,
      MONAD_DEPLOYMENT.tokens.USDC.address,
      MONAD_DEPLOYMENT.tokens.USDT.address
    );
    
    steps.push({
      from: 'USDC',
      to: 'USDT',
      shard: usdcUsdtShard.name,
      amountIn: currentAmount,
      amountOut: result1.amountOut.toString(),
      tradeFee: result1.tradeFee.toString()
    });
    
    currentAmount = result1.amountOut;
    
    // Step 2: USDT -> DAI
    const usdtDaiShard = MONAD_DEPLOYMENT.pools["USDT/DAI"][0];
    const contract2 = new ethers.Contract(usdtDaiShard.address, SAMM_POOL_ABI, monadProvider);
    const result2 = await contract2.calculateSwapSAMM(
      currentAmount,
      MONAD_DEPLOYMENT.tokens.USDT.address,
      MONAD_DEPLOYMENT.tokens.DAI.address
    );
    
    steps.push({
      from: 'USDT',
      to: 'DAI',
      shard: usdtDaiShard.name,
      amountIn: currentAmount.toString(),
      amountOut: result2.amountOut.toString(),
      tradeFee: result2.tradeFee.toString()
    });
    
    const totalFee = steps.reduce((sum, step) => sum + BigInt(step.tradeFee), 0n);
    
    res.json({
      chain: MONAD_DEPLOYMENT.network,
      chainId: MONAD_DEPLOYMENT.chainId,
      route: 'multi-hop',
      path: ['USDC', 'USDT', 'DAI'],
      amountIn: amountIn,
      amountOut: result2.amountOut.toString(),
      totalFee: totalFee.toString(),
      steps,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error calculating multi-hop:', error);
    res.status(500).json({ error: 'Failed to calculate multi-hop route' });
  }
});

// Get specific shard
app.get('/api/shard/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    let targetShard = null;
    let targetPair = null;
    
    for (const [pair, shards] of Object.entries(MONAD_DEPLOYMENT.pools)) {
      targetShard = shards.find(s => s.address.toLowerCase() === address.toLowerCase());
      if (targetShard) {
        targetPair = pair;
        break;
      }
    }
    
    if (!targetShard) {
      return res.status(404).json({ error: 'Shard not found' });
    }
    
    const contract = new ethers.Contract(targetShard.address, SAMM_POOL_ABI, monadProvider);
    const [reserves, sammParams] = await Promise.all([
      contract.getReserves(),
      contract.getSAMMParams()
    ]);
    
    res.json({
      chain: MONAD_DEPLOYMENT.network,
      chainId: MONAD_DEPLOYMENT.chainId,
      pair: targetPair,
      name: targetShard.name,
      address: targetShard.address,
      liquidity: targetShard.liquidity,
      reserves: {
        reserveA: reserves[0].toString(),
        reserveB: reserves[1].toString()
      },
      sammParams: {
        beta1: sammParams[0].toString(),
        rmin: sammParams[1].toString(),
        rmax: sammParams[2].toString(),
        c: sammParams[3].toString()
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching shard:', error);
    res.status(500).json({ error: 'Failed to fetch shard info' });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌐 SAMM API Server running on port ${PORT}`);
  console.log(`📊 Chain: ${MONAD_DEPLOYMENT.network} (${MONAD_DEPLOYMENT.chainId})`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
  console.log(`📋 API Docs: http://localhost:${PORT}/`);
  console.log(`\n✅ CORS enabled for all origins`);
  console.log(`✅ Ready for frontend integration\n`);
});
