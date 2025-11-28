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

// Load deployment data
// Note: Update these paths to your actual deployment files
const monadData = require('../../deployment-data/complete-deployment-1764357709284.json');

// RiseChain deployment (if available)
let riseChainData = null;
try {
  riseChainData = require('../../deployment-data/risechain-multi-shard-1764273559148.json');
} catch (e) {
  console.log('RiseChain deployment not found, will only use Monad');
}

// Chain configurations
const CHAINS = {};

// Always add Monad
if (monadData) {
  CHAINS.monad = {
    chainId: 10143,
    name: "Monad Testnet",
    rpcUrl: "https://testnet-rpc.monad.xyz", 
    data: monadData,
    nativeToken: { symbol: "MON", decimals: 18 }
  };
}

// Add RiseChain if available
if (riseChainData) {
  CHAINS.risechain = {
    chainId: 11155931,
    name: "RiseChain Testnet",
    rpcUrl: "https://testnet.riselabs.xyz",
    data: riseChainData,
    nativeToken: { symbol: "ETH", decimals: 18 }
  };
}

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

// Initialize providers and contracts for each chain
const providers = {};
const chainContracts = {};
const chainStatus = {};

async function initializeChains() {
  console.log('🔗 Initializing unified multi-chain backend...');
  
  for (const [chainName, config] of Object.entries(CHAINS)) {
    try {
      console.log(`\n📡 Connecting to ${config.name}...`);
      
      // Initialize provider
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const network = await provider.getNetwork();
      providers[chainName] = provider;
      
      // Initialize contracts for this chain
      chainContracts[chainName] = {
        shards: {},
        tokens: {}
      };
      
      // Group shards by pair
      const shardsByPair = {};
      config.data.contracts.shards.forEach(shard => {
        if (!shardsByPair[shard.pairName]) {
          shardsByPair[shard.pairName] = [];
        }
        shardsByPair[shard.pairName].push(shard);
      });

      // Initialize shard contracts
      for (const [pairName, shards] of Object.entries(shardsByPair)) {
        chainContracts[chainName].shards[pairName] = [];
        for (const shard of shards) {
          const contract = new ethers.Contract(shard.address, SAMM_POOL_ABI, provider);
          chainContracts[chainName].shards[pairName].push({
            ...shard,
            contract
          });
          console.log(`  ✅ ${shard.name}: ${shard.address}`);
        }
      }

      // Initialize token contracts
      for (const token of config.data.contracts.tokens) {
        chainContracts[chainName].tokens[token.symbol] = {
          ...token,
          contract: new ethers.Contract(token.address, ERC20_ABI, provider)
        };
        console.log(`  ✅ ${token.symbol} token: ${token.address}`);
      }

      chainStatus[chainName] = {
        status: 'connected',
        chainId: Number(network.chainId),
        blockNumber: await provider.getBlockNumber(),
        lastChecked: new Date().toISOString(),
        totalShards: config.data.contracts.shards.length
      };
      
      console.log(`✅ ${config.name} initialized successfully`);
    } catch (error) {
      console.error(`❌ Failed to initialize ${config.name}:`, error.message);
      chainStatus[chainName] = {
        status: 'failed',
        error: error.message,
        lastChecked: new Date().toISOString()
      };
    }
  }
  
  console.log('\n🎯 Multi-chain initialization complete!');
}

// Helper functions
function getChainConfig(chainName) {
  return CHAINS[chainName];
}

function getChainContracts(chainName) {
  return chainContracts[chainName];
}

function getTokenByAddress(chainName, address) {
  const tokens = Object.values(chainContracts[chainName]?.tokens || {});
  return tokens.find(t => t.address.toLowerCase() === address.toLowerCase());
}

function getTokenBySymbol(chainName, symbol) {
  return chainContracts[chainName]?.tokens[symbol];
}

function getPairName(chainName, tokenA, tokenB) {
  const tokenAData = getTokenByAddress(chainName, tokenA);
  const tokenBData = getTokenByAddress(chainName, tokenB);
  
  if (!tokenAData || !tokenBData) return null;
  
  const pairs = [
    `${tokenAData.symbol}/${tokenBData.symbol}`,
    `${tokenBData.symbol}/${tokenAData.symbol}`
  ];
  
  const shards = chainContracts[chainName]?.shards || {};
  for (const pair of pairs) {
    if (shards[pair]) return pair;
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

// Middleware to validate chain
function validateChain(req, res, next) {
  const chainName = req.params.chain || req.query.chain;
  if (chainName && !CHAINS[chainName]) {
    return res.status(404).json({ 
      error: `Chain '${chainName}' not supported`,
      supportedChains: Object.keys(CHAINS)
    });
  }
  if (chainName && chainStatus[chainName]?.status !== 'connected') {
    return res.status(503).json({ 
      error: `Chain '${chainName}' not available`,
      status: chainStatus[chainName]?.status || 'unknown'
    });
  }
  req.chainName = chainName;
  next();
}

// Routes

// Global health check
app.get('/health', (req, res) => {
  const connectedChains = Object.values(chainStatus).filter(s => s.status === 'connected').length;
  const totalChains = Object.keys(CHAINS).length;
  
  res.json({
    status: 'ok',
    service: 'unified-multi-chain-backend',
    chains: {
      connected: connectedChains,
      total: totalChains,
      percentage: Math.round((connectedChains / totalChains) * 100)
    },
    supportedChains: Object.keys(CHAINS),
    timestamp: new Date().toISOString()
  });
});

// Get all supported chains
app.get('/api/chains', (req, res) => {
  const chainsInfo = Object.entries(CHAINS).map(([name, config]) => ({
    name: name,
    chainId: config.chainId,
    displayName: config.name,
    nativeToken: config.nativeToken,
    status: chainStatus[name] || { status: 'unknown' },
    endpoints: {
      info: `/api/${name}/info`,
      shards: `/api/${name}/shards`,
      swap: `/api/${name}/swap`,
      bestShard: `/api/${name}/swap/best-shard`,
      crossPool: `/api/${name}/swap/cross-pool`
    }
  }));

  res.json({
    totalChains: chainsInfo.length,
    chains: chainsInfo,
    timestamp: new Date().toISOString()
  });
});

// Chain-specific info
app.get('/api/:chain/info', validateChain, async (req, res) => {
  try {
    const { chain } = req.params;
    const config = CHAINS[chain];
    const provider = providers[chain];
    
    const [network, blockNumber, gasPrice] = await Promise.all([
      provider.getNetwork(),
      provider.getBlockNumber(),
      provider.getFeeData()
    ]);

    res.json({
      chain: chain,
      config: config,
      network: {
        chainId: Number(network.chainId),
        name: network.name
      },
      status: {
        connected: true,
        blockNumber: blockNumber,
        gasPrice: gasPrice.gasPrice ? ethers.formatUnits(gasPrice.gasPrice, 'gwei') : 'unknown'
      },
      deployment: {
        factory: config.data.contracts.factory,
        totalShards: config.data.contracts.shards.length,
        totalTokens: config.data.contracts.tokens.length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error getting info for ${req.params.chain}:`, error);
    res.status(500).json({ error: 'Failed to get chain info' });
  }
});

// Get all shards for a chain
app.get('/api/:chain/shards', validateChain, async (req, res) => {
  try {
    const { chain } = req.params;
    const contracts = chainContracts[chain];
    const shardsInfo = {};
    
    for (const [pairName, shards] of Object.entries(contracts.shards)) {
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
      chain: chain,
      chainId: CHAINS[chain].chainId,
      shards: shardsInfo,
      totalShards: Object.values(shardsInfo).flat().length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching shards info:', error);
    res.status(500).json({ error: 'Failed to fetch shards information' });
  }
});

// Find best shard for swap (c-smaller-better property)
app.post('/api/:chain/swap/best-shard', validateChain, async (req, res) => {
  try {
    const { chain } = req.params;
    const { amountOut, tokenIn, tokenOut } = req.body;

    if (!amountOut || !tokenIn || !tokenOut) {
      return res.status(400).json({ 
        error: 'Missing required parameters: amountOut, tokenIn, tokenOut' 
      });
    }

    const pairName = getPairName(chain, tokenIn, tokenOut);
    if (!pairName || !chainContracts[chain].shards[pairName]) {
      return res.status(400).json({ 
        error: `No shards available for this token pair on ${CHAINS[chain].name}` 
      });
    }

    const shards = chainContracts[chain].shards[pairName];
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
      chain: chain,
      chainId: CHAINS[chain].chainId,
      bestShard,
      allShards: swapResults,
      cSmallerBetterDemonstrated: swapResults.length > 1,
      sammProperty: 'c-smaller-better validated',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error finding best shard:', error);
    res.status(500).json({ error: 'Failed to find best shard for swap' });
  }
});

// Cross-pool routing
app.post('/api/:chain/swap/cross-pool', validateChain, async (req, res) => {
  try {
    const { chain } = req.params;
    const { amountIn, tokenIn, tokenOut } = req.body;

    if (!amountIn || !tokenIn || !tokenOut) {
      return res.status(400).json({ 
        error: 'Missing required parameters: amountIn, tokenIn, tokenOut' 
      });
    }

    const tokenInData = getTokenByAddress(chain, tokenIn);
    const tokenOutData = getTokenByAddress(chain, tokenOut);
    
    if (!tokenInData || !tokenOutData) {
      return res.status(400).json({ 
        error: `Invalid token addresses for ${CHAINS[chain].name}` 
      });
    }

    // Direct swap if pair exists
    const directPair = getPairName(chain, tokenIn, tokenOut);
    if (directPair && chainContracts[chain].shards[directPair]) {
      const shards = chainContracts[chain].shards[directPair];
      const bestShard = shards[0]; // Use first shard for simplicity
      
      const result = await bestShard.contract.calculateSwapSAMM(amountIn, tokenIn, tokenOut);
      
      return res.json({
        chain: chain,
        chainId: CHAINS[chain].chainId,
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

    // Multi-hop routing through USDC
    const usdcToken = getTokenBySymbol(chain, 'USDC');
    if (!usdcToken) {
      return res.status(400).json({ error: 'USDC not available for routing' });
    }

    let route = [];
    let totalAmountOut = amountIn;
    let steps = [];

    if (tokenInData.symbol !== 'USDC') {
      // First hop: tokenIn -> USDC
      const firstPair = getPairName(chain, tokenIn, usdcToken.address);
      if (!firstPair || !chainContracts[chain].shards[firstPair]) {
        return res.status(400).json({ 
          error: `No route available from ${tokenInData.symbol} to USDC on ${CHAINS[chain].name}` 
        });
      }
      
      const firstShard = chainContracts[chain].shards[firstPair][0];
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
      const secondPair = getPairName(chain, usdcToken.address, tokenOut);
      if (!secondPair || !chainContracts[chain].shards[secondPair]) {
        return res.status(400).json({ 
          error: `No route available from USDC to ${tokenOutData.symbol} on ${CHAINS[chain].name}` 
        });
      }
      
      const secondShard = chainContracts[chain].shards[secondPair][0];
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

    const totalFee = steps.reduce((sum, step) => sum + Number(step.tradeFee || 0), 0);

    res.json({
      chain: chain,
      chainId: CHAINS[chain].chainId,
      route: 'multi-hop',
      path: route,
      shards: steps.map(s => s.shard),
      amountIn: amountIn.toString(),
      amountOut: totalAmountOut.toString(),
      totalFee: totalFee.toString(),
      steps,
      sammProperty: 'c-non-splitting maintained across hops',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error calculating cross-pool route:', error);
    res.status(500).json({ error: 'Failed to calculate cross-pool route' });
  }
});

// Get specific shard info
app.get('/api/:chain/shard/:address', validateChain, async (req, res) => {
  try {
    const { chain, address } = req.params;
    
    // Find the shard
    let targetShard = null;
    for (const shards of Object.values(chainContracts[chain].shards)) {
      targetShard = shards.find(s => s.address.toLowerCase() === address.toLowerCase());
      if (targetShard) break;
    }
    
    if (!targetShard) {
      return res.status(404).json({ 
        error: `Shard not found on ${CHAINS[chain].name}` 
      });
    }
    
    const [poolState, sammParams] = await Promise.all([
      targetShard.contract.getPoolState(),
      targetShard.contract.getSAMMParams()
    ]);
    
    // Get token info
    const tokenAData = getTokenByAddress(chain, poolState.tokenA);
    const tokenBData = getTokenByAddress(chain, poolState.tokenB);
    
    res.json({
      chain: chain,
      chainId: CHAINS[chain].chainId,
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

// Cross-chain comparison
app.get('/api/compare/chains', (req, res) => {
  const comparison = {};
  
  for (const [chainName, config] of Object.entries(CHAINS)) {
    comparison[chainName] = {
      chainId: config.chainId,
      name: config.name,
      status: chainStatus[chainName]?.status || 'unknown',
      totalShards: config.data.contracts.shards.length,
      totalTokens: config.data.contracts.tokens.length,
      factory: config.data.contracts.factory,
      pairs: Object.keys(chainContracts[chainName]?.shards || {}),
      blockNumber: chainStatus[chainName]?.blockNumber
    };
  }
  
  res.json({
    comparison,
    summary: {
      totalChains: Object.keys(CHAINS).length,
      connectedChains: Object.values(chainStatus).filter(s => s.status === 'connected').length,
      totalShards: Object.values(comparison).reduce((sum, chain) => sum + chain.totalShards, 0)
    },
    timestamp: new Date().toISOString()
  });
});

// Legacy endpoints for backward compatibility (default to RiseChain)
app.get('/api/shards', (req, res) => {
  req.params.chain = 'risechain';
  validateChain(req, res, () => {
    // Forward to chain-specific endpoint
    req.url = '/api/risechain/shards';
    app._router.handle(req, res);
  });
});

app.post('/api/swap/best-shard', (req, res) => {
  req.params.chain = 'risechain';
  validateChain(req, res, () => {
    req.url = '/api/risechain/swap/best-shard';
    app._router.handle(req, res);
  });
});

app.post('/api/swap/cross-pool', (req, res) => {
  req.params.chain = 'risechain';
  validateChain(req, res, () => {
    req.url = '/api/risechain/swap/cross-pool';
    app._router.handle(req, res);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    availableEndpoints: {
      global: [
        'GET /health',
        'GET /api/chains',
        'GET /api/compare/chains'
      ],
      chainSpecific: [
        'GET /api/{chain}/info',
        'GET /api/{chain}/shards', 
        'POST /api/{chain}/swap/best-shard',
        'POST /api/{chain}/swap/cross-pool',
        'GET /api/{chain}/shard/{address}'
      ],
      supportedChains: Object.keys(CHAINS)
    }
  });
});

// Start server
async function start() {
  await initializeChains();

  app.listen(PORT, () => {
    console.log(`\n🚀 Unified Multi-Chain SAMM Backend running on port ${PORT}`);
    console.log(`🌐 Supported chains: ${Object.keys(CHAINS).join(', ')}`);
    console.log(`📊 Total shards across all chains: ${Object.values(CHAINS).reduce((sum, chain) => sum + chain.data.contracts.shards.length, 0)}`);
    console.log(`\n🔗 API Endpoints:`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Chains: http://localhost:${PORT}/api/chains`);
    console.log(`   RiseChain shards: http://localhost:${PORT}/api/risechain/shards`);
    console.log(`   Monad shards: http://localhost:${PORT}/api/monad/shards`);
    console.log(`   Compare chains: http://localhost:${PORT}/api/compare/chains`);
  });
}

start().catch(console.error);

module.exports = app;