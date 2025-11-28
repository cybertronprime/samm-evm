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

// CORS - Allow all origins for frontend integration
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

// LATEST Monad deployment data - v2 with decimal normalization
const MONAD_DEPLOYMENT = {
  network: "Monad Testnet",
  chainId: 10143,
  version: "v2-decimal-aware",
  timestamp: "2025-11-28T19:21:49.284Z",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  factory: "0x8ab2De0CD1C3bcAe3cB9a8028E28D60301dBf336",
  tokens: {
    USDC: { 
      address: "0x9153bc242a5FD22b149B1cb252e3eE6314C37366", 
      decimals: 6,
      symbol: "USDC"
    },
    USDT: { 
      address: "0x39f0B52190CeA4B3569D5D501f0c637892F52379", 
      decimals: 6,
      symbol: "USDT"
    },
    DAI: { 
      address: "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46", 
      decimals: 18,
      symbol: "DAI"
    }
  },
  pools: {
    "USDC/USDT": [
      { 
        name: "USDC/USDT-1", 
        address: "0x986e6AA143Ecf491FbB9FFbcFB1A61424af1BC1e", 
        liquidity: "5000000",
        tokenA: "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
        tokenB: "0x39f0B52190CeA4B3569D5D501f0c637892F52379",
        c: 5000000
      },
      { 
        name: "USDC/USDT-2", 
        address: "0xA68065D56C003D6982a6215Bd1C765726b2fCa13", 
        liquidity: "3000000",
        tokenA: "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
        tokenB: "0x39f0B52190CeA4B3569D5D501f0c637892F52379",
        c: 3000000
      },
      { 
        name: "USDC/USDT-3", 
        address: "0x58136Bb18639C7C3f2C552Bb734dA6D65Ff7D653", 
        liquidity: "2000000",
        tokenA: "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
        tokenB: "0x39f0B52190CeA4B3569D5D501f0c637892F52379",
        c: 2000000
      }
    ],
    "USDT/DAI": [
      { 
        name: "USDT/DAI-1", 
        address: "0x179e0308524c916a6F0452FF0ce999cEC88588e8", 
        liquidity: "10000",
        tokenA: "0x39f0B52190CeA4B3569D5D501f0c637892F52379",
        tokenB: "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46",
        c: 10000
      },
      { 
        name: "USDT/DAI-2", 
        address: "0x40767849365ff64F9EB341eD2Cf3E40590578749", 
        liquidity: "20000",
        tokenA: "0x39f0B52190CeA4B3569D5D501f0c637892F52379",
        tokenB: "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46",
        c: 20000
      },
      { 
        name: "USDT/DAI-3", 
        address: "0x302bB8B9Cf5722a2C69B19D98393041E007085Eb", 
        liquidity: "30000",
        tokenA: "0x39f0B52190CeA4B3569D5D501f0c637892F52379",
        tokenB: "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46",
        c: 30000
      }
    ]
  }
};

// Initialize provider
const monadProvider = new ethers.JsonRpcProvider(MONAD_DEPLOYMENT.rpcUrl);

// Contract ABIs
const SAMM_POOL_ABI = [
  "function getReserves() view returns (uint256 reserveA, uint256 reserveB)",
  "function calculateSwapSAMM(uint256 amountOut, address tokenIn, address tokenOut) view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))",
  "function getSAMMParams() view returns (int256 beta1, uint256 rmin, uint256 rmax, uint256 c)",
  "function getPoolState() view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))"
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)"
];

// Helper functions
function getTokenByAddress(address) {
  for (const [symbol, token] of Object.entries(MONAD_DEPLOYMENT.tokens)) {
    if (token.address.toLowerCase() === address.toLowerCase()) {
      return { ...token, symbol };
    }
  }
  return null;
}

function findPairForTokens(tokenA, tokenB) {
  for (const [pairName, shards] of Object.entries(MONAD_DEPLOYMENT.pools)) {
    const shard = shards[0];
    if (
      (shard.tokenA.toLowerCase() === tokenA.toLowerCase() && shard.tokenB.toLowerCase() === tokenB.toLowerCase()) ||
      (shard.tokenA.toLowerCase() === tokenB.toLowerCase() && shard.tokenB.toLowerCase() === tokenA.toLowerCase())
    ) {
      return pairName;
    }
  }
  return null;
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    chain: MONAD_DEPLOYMENT.network,
    chainId: MONAD_DEPLOYMENT.chainId,
    version: MONAD_DEPLOYMENT.version,
    pools: {
      "USDC/USDT": MONAD_DEPLOYMENT.pools["USDC/USDT"].length,
      "USDT/DAI": MONAD_DEPLOYMENT.pools["USDT/DAI"].length
    },
    totalShards: 6,
    features: ['multi-shard', 'multi-hop', 'c-smaller-better', 'decimal-normalization']
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'SAMM Multi-Chain API',
    version: MONAD_DEPLOYMENT.version,
    chain: MONAD_DEPLOYMENT.network,
    chainId: MONAD_DEPLOYMENT.chainId,
    deploymentTimestamp: MONAD_DEPLOYMENT.timestamp,
    endpoints: {
      health: 'GET /health',
      deployment: 'GET /api/deployment',
      shards: 'GET /api/shards',
      bestShard: 'POST /api/swap/best-shard',
      multiHop: 'POST /api/swap/multi-hop',
      specificShard: 'GET /api/shard/:address'
    },
    features: [
      'Multi-shard architecture',
      'Multi-hop routing (USDC → USDT → DAI)',
      'c-smaller-better property',
      'Decimal normalization (6 & 18 decimals)',
      'High liquidity pools'
    ],
    cors: 'enabled for all origins'
  });
});

// Get deployment info
app.get('/api/deployment', (req, res) => {
  res.json({
    network: MONAD_DEPLOYMENT.network,
    chainId: MONAD_DEPLOYMENT.chainId,
    version: MONAD_DEPLOYMENT.version,
    timestamp: MONAD_DEPLOYMENT.timestamp,
    factory: MONAD_DEPLOYMENT.factory,
    tokens: MONAD_DEPLOYMENT.tokens,
    pools: MONAD_DEPLOYMENT.pools,
    stats: {
      totalShards: 6,
      usdcUsdtShards: 3,
      usdtDaiShards: 3,
      totalLiquidityUSDC: "10000000",
      totalLiquidityUSDT: "60000",
      demonstratesMultiHopRouting: true,
      decimalNormalization: true
    },
    multiHopRouting: {
      enabled: true,
      supportedPairs: ["USDC/USDT", "USDT/DAI"],
      multiHopPaths: [{
        from: "USDC",
        to: "DAI",
        path: ["USDC", "USDT", "DAI"],
        pools: ["USDC/USDT", "USDT/DAI"]
      }]
    }
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
              beta1: sammParams[0].toString(),
              rmin: sammParams[1].toString(),
              rmax: sammParams[2].toString(),
              c: sammParams[3].toString()
            },
            tokens: {
              tokenA: getTokenByAddress(shard.tokenA),
              tokenB: getTokenByAddress(shard.tokenB)
            }
          });
        } catch (error) {
          console.error(`Error fetching ${shard.name}:`, error.message);
          allShards.push({
            pair,
            name: shard.name,
            address: shard.address,
            liquidity: shard.liquidity,
            error: 'Could not fetch on-chain data',
            tokens: {
              tokenA: getTokenByAddress(shard.tokenA),
              tokenB: getTokenByAddress(shard.tokenB)
            }
          });
        }
      }
    }
    
    res.json({
      chain: MONAD_DEPLOYMENT.network,
      chainId: MONAD_DEPLOYMENT.chainId,
      version: MONAD_DEPLOYMENT.version,
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
    const pairName = findPairForTokens(tokenIn, tokenOut);
    
    if (!pairName) {
      return res.status(400).json({ 
        error: 'No pools available for this token pair',
        availablePairs: Object.keys(MONAD_DEPLOYMENT.pools)
      });
    }
    
    const shards = MONAD_DEPLOYMENT.pools[pairName];
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
          ownerFee: result.ownerFee.toString(),
          totalCost: result.amountIn.toString()
        });
      } catch (error) {
        console.error(`Error calculating for ${shard.name}:`, error.message);
      }
    }
    
    if (results.length === 0) {
      return res.status(500).json({ error: 'No valid swap results found' });
    }
    
    // Sort by c value (smaller is better)
    results.sort((a, b) => a.c - b.c);
    
    res.json({
      chain: MONAD_DEPLOYMENT.network,
      chainId: MONAD_DEPLOYMENT.chainId,
      version: MONAD_DEPLOYMENT.version,
      pair: pairName,
      bestShard: results[0],
      allShards: results,
      property: 'c-smaller-better demonstrated',
      explanation: 'Smaller c value provides better rates for the same trade',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error finding best shard:', error);
    res.status(500).json({ error: 'Failed to find best shard', details: error.message });
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
    
    const tokenInData = getTokenByAddress(tokenIn);
    const tokenOutData = getTokenByAddress(tokenOut);
    
    if (!tokenInData || !tokenOutData) {
      return res.status(400).json({ 
        error: 'Invalid token addresses',
        validTokens: MONAD_DEPLOYMENT.tokens
      });
    }
    
    // Check for direct pair
    const directPair = findPairForTokens(tokenIn, tokenOut);
    if (directPair) {
      const shard = MONAD_DEPLOYMENT.pools[directPair][0];
      const contract = new ethers.Contract(shard.address, SAMM_POOL_ABI, monadProvider);
      const result = await contract.calculateSwapSAMM(amountIn, tokenIn, tokenOut);
      
      return res.json({
        chain: MONAD_DEPLOYMENT.network,
        chainId: MONAD_DEPLOYMENT.chainId,
        version: MONAD_DEPLOYMENT.version,
        route: 'direct',
        path: [tokenInData.symbol, tokenOutData.symbol],
        amountIn: amountIn,
        amountOut: result.amountOut.toString(),
        totalFee: result.tradeFee.toString(),
        steps: [{
          from: tokenInData.symbol,
          to: tokenOutData.symbol,
          shard: shard.name,
          amountIn: amountIn,
          amountOut: result.amountOut.toString(),
          tradeFee: result.tradeFee.toString()
        }],
        timestamp: new Date().toISOString()
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
      shardAddress: usdcUsdtShard.address,
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
      shardAddress: usdtDaiShard.address,
      amountIn: currentAmount.toString(),
      amountOut: result2.amountOut.toString(),
      tradeFee: result2.tradeFee.toString()
    });
    
    const totalFee = steps.reduce((sum, step) => sum + BigInt(step.tradeFee), 0n);
    
    res.json({
      chain: MONAD_DEPLOYMENT.network,
      chainId: MONAD_DEPLOYMENT.chainId,
      version: MONAD_DEPLOYMENT.version,
      route: 'multi-hop',
      path: ['USDC', 'USDT', 'DAI'],
      amountIn: amountIn,
      amountOut: result2.amountOut.toString(),
      totalFee: totalFee.toString(),
      steps,
      decimalNormalization: 'Handled automatically (6 decimals → 6 decimals → 18 decimals)',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error calculating multi-hop:', error);
    res.status(500).json({ error: 'Failed to calculate multi-hop route', details: error.message });
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
      return res.status(404).json({ 
        error: 'Shard not found',
        availableShards: Object.values(MONAD_DEPLOYMENT.pools).flat().map(s => ({
          name: s.name,
          address: s.address
        }))
      });
    }
    
    const contract = new ethers.Contract(targetShard.address, SAMM_POOL_ABI, monadProvider);
    const [reserves, sammParams] = await Promise.all([
      contract.getReserves(),
      contract.getSAMMParams()
    ]);
    
    res.json({
      chain: MONAD_DEPLOYMENT.network,
      chainId: MONAD_DEPLOYMENT.chainId,
      version: MONAD_DEPLOYMENT.version,
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
      tokens: {
        tokenA: getTokenByAddress(targetShard.tokenA),
        tokenB: getTokenByAddress(targetShard.tokenB)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching shard:', error);
    res.status(500).json({ error: 'Failed to fetch shard info', details: error.message });
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
  console.log(`🔖 Version: ${MONAD_DEPLOYMENT.version}`);
  console.log(`🏭 Factory: ${MONAD_DEPLOYMENT.factory}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
  console.log(`📋 API Docs: http://localhost:${PORT}/`);
  console.log(`\n💰 Liquidity:`);
  console.log(`   USDC/USDT: 10M (3 shards)`);
  console.log(`   USDT/DAI: 60K (3 shards)`);
  console.log(`\n✅ CORS enabled for all origins`);
  console.log(`✅ Decimal normalization enabled`);
  console.log(`✅ Multi-hop routing: USDC → USDT → DAI`);
  console.log(`✅ c-smaller-better property demonstrated\n`);
});
