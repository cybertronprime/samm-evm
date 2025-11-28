require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Ethereum provider setup
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://localhost:8545');

// Contract ABIs
const SAMM_POOL_ABI = [
  "function getReserves() view returns (uint256 reserveA, uint256 reserveB)",
  "function calculateSwapSAMM(uint256 amountOut, address tokenIn, address tokenOut) view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))",
  "function getPoolState() view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))",
  "function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) pure returns (uint256 amountB)",
  "function getSAMMParams() view returns (int256 beta1, uint256 rmin, uint256 rmax, uint256 c)"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

// Multi-shard configuration from deployment data
const SHARDS = {
  'USDC/USDT': [
    {
      name: 'USDC/USDT-1',
      address: process.env.USDC_USDT_SHARD_1,
      liquidity: '100.0'
    },
    {
      name: 'USDC/USDT-2', 
      address: process.env.USDC_USDT_SHARD_2,
      liquidity: '500.0'
    },
    {
      name: 'USDC/USDT-3',
      address: process.env.USDC_USDT_SHARD_3,
      liquidity: '1000.0'
    }
  ],
  'USDC/DAI': [
    {
      name: 'USDC/DAI-1',
      address: process.env.USDC_DAI_SHARD_1,
      liquidity: '200.0'
    },
    {
      name: 'USDC/DAI-2',
      address: process.env.USDC_DAI_SHARD_2,
      liquidity: '800.0'
    }
  ]
};

const TOKENS = {
  USDC: process.env.USDC_ADDRESS,
  USDT: process.env.USDT_ADDRESS,
  DAI: process.env.DAI_ADDRESS
};

// Initialize contracts
let shardContracts = {};
let tokenContracts = {};

async function initializeContracts() {
  try {
    console.log('Initializing multi-shard contracts...');
    
    // Initialize all shard contracts
    for (const [pairName, shards] of Object.entries(SHARDS)) {
      shardContracts[pairName] = [];
      for (const shard of shards) {
        if (shard.address) {
          const contract = new ethers.Contract(shard.address, SAMM_POOL_ABI, provider);
          shardContracts[pairName].push({
            ...shard,
            contract
          });
          console.log(`✅ Initialized ${shard.name}: ${shard.address}`);
        }
      }
    }

    // Initialize token contracts
    for (const [symbol, address] of Object.entries(TOKENS)) {
      if (address) {
        tokenContracts[symbol] = new ethers.Contract(address, ERC20_ABI, provider);
        console.log(`✅ Initialized ${symbol} token: ${address}`);
      }
    }

    console.log('✅ All contracts initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing contracts:', error);
  }
}

// Helper functions
function getTokenSymbol(address) {
  for (const [symbol, tokenAddress] of Object.entries(TOKENS)) {
    if (tokenAddress && tokenAddress.toLowerCase() === address.toLowerCase()) {
      return symbol;
    }
  }
  return null;
}

function getPairName(tokenA, tokenB) {
  const symbolA = getTokenSymbol(tokenA);
  const symbolB = getTokenSymbol(tokenB);
  
  if (!symbolA || !symbolB) return null;
  
  // Normalize pair names
  const pairs = [`${symbolA}/${symbolB}`, `${symbolB}/${symbolA}`];
  for (const pair of pairs) {
    if (SHARDS[pair]) return pair;
  }
  return null;
}

function calculatePriceImpact(amountIn, amountOut, reserveIn, reserveOut) {
  try {
    const spotPriceBefore = Number(reserveOut) / Number(reserveIn);
    const effectivePrice = Number(amountOut) / Number(amountIn);
    const priceImpact = ((spotPriceBefore - effectivePrice) / spotPriceBefore) * 100;
    return priceImpact.toFixed(4);
  } catch (error) {
    return '0';
  }
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    shards: Object.keys(SHARDS).reduce((acc, pair) => {
      acc[pair] = SHARDS[pair].length;
      return acc;
    }, {}),
    totalShards: Object.values(SHARDS).flat().length
  });
});

// Get all shards info
app.get('/api/shards', async (req, res) => {
  try {
    const shardsInfo = {};
    
    for (const [pairName, shards] of Object.entries(shardContracts)) {
      shardsInfo[pairName] = [];
      
      for (const shard of shards) {
        try {
          const [poolState, sammParams] = await Promise.all([
            shard.contract.getPoolState(),
            shard.contract.getSAMMParams()
          ]);
          
          shardsInfo[pairName].push({
            name: shard.name,
            address: shard.address,
            liquidity: shard.liquidity,
            reserves: {
              tokenA: poolState.reserveA.toString(),
              tokenB: poolState.reserveB.toString()
            },
            sammParams: {
              beta1: sammParams[0].toString(),
              rmin: sammParams[1].toString(),
              rmax: sammParams[2].toString(),
              c: sammParams[3].toString()
            },
            fees: {
              tradeFeeNumerator: poolState.tradeFeeNumerator.toString(),
              tradeFeeDenominator: poolState.tradeFeeDenominator.toString(),
              ownerFeeNumerator: poolState.ownerFeeNumerator.toString(),
              ownerFeeDenominator: poolState.ownerFeeDenominator.toString()
            }
          });
        } catch (error) {
          console.error(`Error fetching info for ${shard.name}:`, error);
        }
      }
    }
    
    res.json({
      shards: shardsInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching shards info:', error);
    res.status(500).json({ error: 'Failed to fetch shards information' });
  }
});

// Get best shard for a swap (smallest shard with best rate)
app.post('/api/swap/best-shard', async (req, res) => {
  try {
    const { amountOut, tokenIn, tokenOut } = req.body;

    if (!amountOut || !tokenIn || !tokenOut) {
      return res.status(400).json({ 
        error: 'Missing required parameters: amountOut, tokenIn, tokenOut' 
      });
    }

    const pairName = getPairName(tokenIn, tokenOut);
    if (!pairName || !shardContracts[pairName]) {
      return res.status(400).json({ 
        error: 'No shards available for this token pair' 
      });
    }

    const shards = shardContracts[pairName];
    const swapResults = [];

    // Calculate swap on all shards
    for (const shard of shards) {
      try {
        const result = await shard.contract.calculateSwapSAMM(amountOut, tokenIn, tokenOut);
        const poolState = await shard.contract.getPoolState();
        
        swapResults.push({
          shardName: shard.name,
          shardAddress: shard.address,
          liquidity: shard.liquidity,
          amountIn: result.amountIn.toString(),
          amountOut: result.amountOut.toString(),
          tradeFee: result.tradeFee.toString(),
          ownerFee: result.ownerFee.toString(),
          totalCost: result.amountIn.toString(),
          priceImpact: calculatePriceImpact(
            result.amountIn,
            result.amountOut,
            tokenIn.toLowerCase() === poolState.tokenA.toLowerCase() ? poolState.reserveA : poolState.reserveB,
            tokenIn.toLowerCase() === poolState.tokenA.toLowerCase() ? poolState.reserveB : poolState.reserveA
          )
        });
      } catch (error) {
        console.error(`Error calculating swap for ${shard.name}:`, error);
      }
    }

    if (swapResults.length === 0) {
      return res.status(500).json({ error: 'No valid swap results found' });
    }

    // Sort by total cost (ascending) - best rate first
    swapResults.sort((a, b) => Number(a.totalCost) - Number(b.totalCost));
    
    const bestShard = swapResults[0];
    
    res.json({
      bestShard,
      allShards: swapResults,
      cSmallerBetterDemonstrated: swapResults.length > 1,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error finding best shard:', error);
    res.status(500).json({ error: 'Failed to find best shard for swap' });
  }
});

// Cross-pool routing (USDC -> USDT -> DAI)
app.post('/api/swap/cross-pool', async (req, res) => {
  try {
    const { amountIn, tokenIn, tokenOut } = req.body;

    if (!amountIn || !tokenIn || !tokenOut) {
      return res.status(400).json({ 
        error: 'Missing required parameters: amountIn, tokenIn, tokenOut' 
      });
    }

    const tokenInSymbol = getTokenSymbol(tokenIn);
    const tokenOutSymbol = getTokenSymbol(tokenOut);
    
    if (!tokenInSymbol || !tokenOutSymbol) {
      return res.status(400).json({ error: 'Invalid token addresses' });
    }

    // Direct swap if pair exists
    const directPair = getPairName(tokenIn, tokenOut);
    if (directPair && shardContracts[directPair]) {
      const shards = shardContracts[directPair];
      const bestShard = shards[0]; // Use first shard for simplicity
      
      const result = await bestShard.contract.calculateSwapSAMM(amountIn, tokenIn, tokenOut);
      
      return res.json({
        route: 'direct',
        path: [tokenInSymbol, tokenOutSymbol],
        shards: [bestShard.name],
        amountIn: amountIn.toString(),
        amountOut: result.amountOut.toString(),
        totalFee: result.tradeFee.toString(),
        steps: [{
          from: tokenInSymbol,
          to: tokenOutSymbol,
          shard: bestShard.name,
          amountIn: amountIn.toString(),
          amountOut: result.amountOut.toString()
        }],
        timestamp: new Date().toISOString()
      });
    }

    // Multi-hop routing through USDC
    let route = [];
    let totalAmountOut = amountIn;
    let steps = [];

    if (tokenInSymbol !== 'USDC') {
      // First hop: tokenIn -> USDC
      const firstPair = getPairName(tokenIn, TOKENS.USDC);
      if (!firstPair || !shardContracts[firstPair]) {
        return res.status(400).json({ error: `No route available from ${tokenInSymbol} to USDC` });
      }
      
      const firstShard = shardContracts[firstPair][0];
      const firstResult = await firstShard.contract.calculateSwapSAMM(totalAmountOut, tokenIn, TOKENS.USDC);
      
      steps.push({
        from: tokenInSymbol,
        to: 'USDC',
        shard: firstShard.name,
        amountIn: totalAmountOut.toString(),
        amountOut: firstResult.amountOut.toString()
      });
      
      totalAmountOut = firstResult.amountOut;
      route.push(tokenInSymbol, 'USDC');
    } else {
      route.push('USDC');
    }

    if (tokenOutSymbol !== 'USDC') {
      // Second hop: USDC -> tokenOut
      const secondPair = getPairName(TOKENS.USDC, tokenOut);
      if (!secondPair || !shardContracts[secondPair]) {
        return res.status(400).json({ error: `No route available from USDC to ${tokenOutSymbol}` });
      }
      
      const secondShard = shardContracts[secondPair][0];
      const secondResult = await secondShard.contract.calculateSwapSAMM(totalAmountOut, TOKENS.USDC, tokenOut);
      
      steps.push({
        from: 'USDC',
        to: tokenOutSymbol,
        shard: secondShard.name,
        amountIn: totalAmountOut.toString(),
        amountOut: secondResult.amountOut.toString()
      });
      
      totalAmountOut = secondResult.amountOut;
      route.push(tokenOutSymbol);
    }

    const totalFee = steps.reduce((sum, step) => sum + Number(step.tradeFee || 0), 0);

    res.json({
      route: 'multi-hop',
      path: route,
      shards: steps.map(s => s.shard),
      amountIn: amountIn.toString(),
      amountOut: totalAmountOut.toString(),
      totalFee: totalFee.toString(),
      steps,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error calculating cross-pool route:', error);
    res.status(500).json({ error: 'Failed to calculate cross-pool route' });
  }
});

// Get specific shard info
app.get('/api/shard/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    // Find the shard
    let targetShard = null;
    for (const shards of Object.values(shardContracts)) {
      targetShard = shards.find(s => s.address.toLowerCase() === address.toLowerCase());
      if (targetShard) break;
    }
    
    if (!targetShard) {
      return res.status(404).json({ error: 'Shard not found' });
    }
    
    const [poolState, sammParams] = await Promise.all([
      targetShard.contract.getPoolState(),
      targetShard.contract.getSAMMParams()
    ]);
    
    // Get token info
    const tokenASymbol = getTokenSymbol(poolState.tokenA);
    const tokenBSymbol = getTokenSymbol(poolState.tokenB);
    
    res.json({
      name: targetShard.name,
      address: targetShard.address,
      liquidity: targetShard.liquidity,
      tokens: {
        tokenA: {
          address: poolState.tokenA,
          symbol: tokenASymbol
        },
        tokenB: {
          address: poolState.tokenB,
          symbol: tokenBSymbol
        }
      },
      reserves: {
        tokenA: poolState.reserveA.toString(),
        tokenB: poolState.reserveB.toString()
      },
      sammParams: {
        beta1: sammParams[0].toString(),
        rmin: sammParams[1].toString(),
        rmax: sammParams[2].toString(),
        c: sammParams[3].toString()
      },
      fees: {
        tradeFeeNumerator: poolState.tradeFeeNumerator.toString(),
        tradeFeeDenominator: poolState.tradeFeeDenominator.toString(),
        ownerFeeNumerator: poolState.ownerFeeNumerator.toString(),
        ownerFeeDenominator: poolState.ownerFeeDenominator.toString()
      },
      totalSupply: poolState.totalSupply.toString(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching shard info:', error);
    res.status(500).json({ error: 'Failed to fetch shard information' });
  }
});

// Legacy endpoints for backward compatibility
app.get('/api/pool/info', async (req, res) => {
  try {
    // Return info for the first USDC/USDT shard for compatibility
    const usdcUsdtShards = shardContracts['USDC/USDT'];
    if (!usdcUsdtShards || usdcUsdtShards.length === 0) {
      return res.status(503).json({ error: 'No USDC/USDT shards available' });
    }
    
    const shard = usdcUsdtShards[0];
    const poolState = await shard.contract.getPoolState();
    
    res.json({
      pool: {
        address: shard.address,
        name: shard.name,
        reserveA: poolState.reserveA.toString(),
        reserveB: poolState.reserveB.toString(),
        totalSupply: poolState.totalSupply.toString(),
        fees: {
          tradeFeeNumerator: poolState.tradeFeeNumerator.toString(),
          tradeFeeDenominator: poolState.tradeFeeDenominator.toString(),
          ownerFeeNumerator: poolState.ownerFeeNumerator.toString(),
          ownerFeeDenominator: poolState.ownerFeeDenominator.toString(),
        },
      },
      tokenA: {
        address: poolState.tokenA,
        symbol: 'USDC'
      },
      tokenB: {
        address: poolState.tokenB,
        symbol: 'USDT'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching pool info:', error);
    res.status(500).json({ error: 'Failed to fetch pool information' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
async function start() {
  await initializeContracts();

  app.listen(PORT, () => {
    console.log(`🚀 Multi-Shard SAMM Service running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`RPC URL: ${process.env.RPC_URL}`);
    console.log(`Total Shards: ${Object.values(SHARDS).flat().length}`);
    console.log(`Supported Pairs: ${Object.keys(SHARDS).join(', ')}`);
  });
}

start().catch(console.error);

module.exports = app;