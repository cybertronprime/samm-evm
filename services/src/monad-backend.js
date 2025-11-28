require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.MONAD_PORT || 3001;

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

// Monad Testnet provider
const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');

// Load Monad deployment data - LATEST DEPLOYMENT WITH USDT/DAI POOLS
const monadData = require('../../deployment-data/monad-complete-deployment.json');

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

// Initialize contracts from deployment data
let shardContracts = {};
let tokenContracts = {};

async function initializeContracts() {
  try {
    console.log('Initializing Monad contracts...');
    
    // Group shards by pair
    const shardsByPair = {};
    monadData.contracts.shards.forEach(shard => {
      if (!shardsByPair[shard.pairName]) {
        shardsByPair[shard.pairName] = [];
      }
      shardsByPair[shard.pairName].push(shard);
    });

    // Initialize shard contracts
    for (const [pairName, shards] of Object.entries(shardsByPair)) {
      shardContracts[pairName] = [];
      for (const shard of shards) {
        const contract = new ethers.Contract(shard.address, SAMM_POOL_ABI, provider);
        shardContracts[pairName].push({
          ...shard,
          contract
        });
        console.log(`✅ Initialized ${shard.name}: ${shard.address}`);
      }
    }

    // Initialize token contracts
    for (const token of monadData.contracts.tokens) {
      tokenContracts[token.symbol] = new ethers.Contract(token.address, ERC20_ABI, provider);
      console.log(`✅ Initialized ${token.symbol} token: ${token.address}`);
    }

    console.log('✅ All Monad contracts initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing Monad contracts:', error);
  }
}

// Helper functions
function getTokenBySymbol(symbol) {
  return monadData.contracts.tokens.find(t => t.symbol === symbol);
}

function getTokenByAddress(address) {
  return monadData.contracts.tokens.find(t => 
    t.address.toLowerCase() === address.toLowerCase()
  );
}

function getPairName(tokenA, tokenB) {
  const tokenAData = getTokenByAddress(tokenA);
  const tokenBData = getTokenByAddress(tokenB);
  
  if (!tokenAData || !tokenBData) return null;
  
  // Try both combinations
  const pairs = [
    `${tokenAData.symbol}/${tokenBData.symbol}`,
    `${tokenBData.symbol}/${tokenAData.symbol}`
  ];
  
  for (const pair of pairs) {
    if (shardContracts[pair]) return pair;
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
    chain: 'Monad Testnet',
    chainId: 10143,
    timestamp: new Date().toISOString(),
    shards: Object.keys(shardContracts).reduce((acc, pair) => {
      acc[pair] = shardContracts[pair].length;
      return acc;
    }, {}),
    totalShards: Object.values(shardContracts).flat().length
  });
});

// Get deployment info
app.get('/api/deployment', (req, res) => {
  res.json({
    network: monadData.network,
    chainId: monadData.chainId,
    deployer: monadData.deployer,
    contracts: monadData.contracts,
    stats: monadData.multiShardStats,
    timestamp: new Date().toISOString()
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
      chain: 'Monad Testnet',
      chainId: 10143,
      shards: shardsInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching shards info:', error);
    res.status(500).json({ error: 'Failed to fetch shards information' });
  }
});

// Get best shard for a swap (c-smaller-better property)
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
        error: 'No shards available for this token pair on Monad' 
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
      chain: 'Monad Testnet',
      chainId: 10143,
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

// Cross-pool routing
app.post('/api/swap/cross-pool', async (req, res) => {
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
      return res.status(400).json({ error: 'Invalid token addresses for Monad' });
    }

    // Direct swap if pair exists
    const directPair = getPairName(tokenIn, tokenOut);
    if (directPair && shardContracts[directPair]) {
      const shards = shardContracts[directPair];
      const bestShard = shards[0]; // Use first shard for simplicity
      
      const result = await bestShard.contract.calculateSwapSAMM(amountIn, tokenIn, tokenOut);
      
      return res.json({
        chain: 'Monad Testnet',
        chainId: 10143,
        route: 'direct',
        path: [tokenInData.symbol, tokenOutData.symbol],
        shards: [bestShard.name],
        amountIn: amountIn.toString(),
        amountOut: result.amountOut.toString(),
        totalFee: result.tradeFee.toString(),
        steps: [{
          from: tokenInData.symbol,
          to: tokenOutData.symbol,
          shard: bestShard.name,
          amountIn: amountIn.toString(),
          amountOut: result.amountOut.toString()
        }],
        timestamp: new Date().toISOString()
      });
    }

    // Multi-hop routing through USDT (USDC -> USDT -> DAI)
    const usdcToken = getTokenBySymbol('USDC');
    const usdtToken = getTokenBySymbol('USDT');
    const daiToken = getTokenBySymbol('DAI');
    
    let route = [];
    let totalAmountOut = amountIn;
    let steps = [];

    // Special case: USDC -> DAI requires routing through USDT
    if (tokenInData.symbol === 'USDC' && tokenOutData.symbol === 'DAI') {
      // Step 1: USDC -> USDT
      const firstPair = getPairName(tokenIn, usdtToken.address);
      if (!firstPair || !shardContracts[firstPair]) {
        return res.status(400).json({ 
          error: `No USDC/USDT pool available on Monad` 
        });
      }
      
      const firstShard = shardContracts[firstPair][0];
      const firstResult = await firstShard.contract.calculateSwapSAMM(totalAmountOut, tokenIn, usdtToken.address);
      
      steps.push({
        from: 'USDC',
        to: 'USDT',
        shard: firstShard.name,
        amountIn: totalAmountOut.toString(),
        amountOut: firstResult.amountOut.toString(),
        tradeFee: firstResult.tradeFee.toString()
      });
      
      totalAmountOut = firstResult.amountOut;
      route.push('USDC', 'USDT');
      
      // Step 2: USDT -> DAI
      const secondPair = getPairName(usdtToken.address, tokenOut);
      if (!secondPair || !shardContracts[secondPair]) {
        return res.status(400).json({ 
          error: `No USDT/DAI pool available on Monad` 
        });
      }
      
      const secondShard = shardContracts[secondPair][0];
      const secondResult = await secondShard.contract.calculateSwapSAMM(totalAmountOut, usdtToken.address, tokenOut);
      
      steps.push({
        from: 'USDT',
        to: 'DAI',
        shard: secondShard.name,
        amountIn: totalAmountOut.toString(),
        amountOut: secondResult.amountOut.toString(),
        tradeFee: secondResult.tradeFee.toString()
      });
      
      totalAmountOut = secondResult.amountOut;
      route.push('DAI');
    } else {
      // Original 2-hop routing logic for other pairs
      if (tokenInData.symbol !== 'USDC') {
        // First hop: tokenIn -> USDC
        const firstPair = getPairName(tokenIn, usdcToken.address);
        if (!firstPair || !shardContracts[firstPair]) {
          return res.status(400).json({ 
            error: `No route available from ${tokenInData.symbol} to USDC on Monad` 
          });
        }
        
        const firstShard = shardContracts[firstPair][0];
        const firstResult = await firstShard.contract.calculateSwapSAMM(totalAmountOut, tokenIn, usdcToken.address);
        
        steps.push({
          from: tokenInData.symbol,
          to: 'USDC',
          shard: firstShard.name,
          amountIn: totalAmountOut.toString(),
          amountOut: firstResult.amountOut.toString(),
          tradeFee: firstResult.tradeFee.toString()
        });
        
        totalAmountOut = firstResult.amountOut;
        route.push(tokenInData.symbol, 'USDC');
      } else {
        route.push('USDC');
      }

      if (tokenOutData.symbol !== 'USDC') {
        // Second hop: USDC -> tokenOut
        const secondPair = getPairName(usdcToken.address, tokenOut);
        if (!secondPair || !shardContracts[secondPair]) {
          return res.status(400).json({ 
            error: `No route available from USDC to ${tokenOutData.symbol} on Monad` 
          });
        }
        
        const secondShard = shardContracts[secondPair][0];
        const secondResult = await secondShard.contract.calculateSwapSAMM(totalAmountOut, usdcToken.address, tokenOut);
        
        steps.push({
          from: 'USDC',
          to: tokenOutData.symbol,
          shard: secondShard.name,
          amountIn: totalAmountOut.toString(),
          amountOut: secondResult.amountOut.toString(),
          tradeFee: secondResult.tradeFee.toString()
        });
        
        totalAmountOut = secondResult.amountOut;
        route.push(tokenOutData.symbol);
      }
    }

    const totalFee = steps.reduce((sum, step) => sum + Number(step.tradeFee || 0), 0);

    res.json({
      chain: 'Monad Testnet',
      chainId: 10143,
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
      return res.status(404).json({ error: 'Shard not found on Monad' });
    }
    
    const [poolState, sammParams] = await Promise.all([
      targetShard.contract.getPoolState(),
      targetShard.contract.getSAMMParams()
    ]);
    
    // Get token info
    const tokenAData = getTokenByAddress(poolState.tokenA);
    const tokenBData = getTokenByAddress(poolState.tokenB);
    
    res.json({
      chain: 'Monad Testnet',
      chainId: 10143,
      name: targetShard.name,
      address: targetShard.address,
      liquidity: targetShard.liquidity,
      tokens: {
        tokenA: {
          address: poolState.tokenA,
          symbol: tokenAData?.symbol
        },
        tokenB: {
          address: poolState.tokenB,
          symbol: tokenBData?.symbol
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

// Compare with RiseChain
app.get('/api/compare/risechain', (req, res) => {
  res.json({
    comparison: {
      monad: {
        chainId: 10143,
        totalShards: monadData.contracts.shards.length,
        factory: monadData.contracts.factory,
        tokens: monadData.contracts.tokens.length
      },
      risechain: {
        chainId: 11155931,
        note: 'Use RiseChain backend on port 3000 for comparison'
      }
    },
    timestamp: new Date().toISOString()
  });
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
    console.log(`🚀 Monad SAMM Service running on port ${PORT}`);
    console.log(`Chain: Monad Testnet (${monadData.chainId})`);
    console.log(`RPC URL: https://testnet-rpc.monad.xyz`);
    console.log(`Total Shards: ${monadData.contracts.shards.length}`);
    console.log(`Factory: ${monadData.contracts.factory}`);
    console.log(`Supported Pairs: ${Object.keys(shardContracts).join(', ')}`);
  });
}

start().catch(console.error);

module.exports = app;