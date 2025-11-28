require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.MULTI_CHAIN_PORT || 3002;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Chain configurations
const CHAINS = {
  risechain: {
    chainId: 11155931,
    name: "RISE Testnet",
    rpcUrl: "https://testnet.riselabs.xyz",
    nativeToken: { symbol: "ETH", decimals: 18 }
  },
  sepolia: {
    chainId: 11155111,
    name: "Ethereum Sepolia Testnet", 
    rpcUrl: "https://sepolia.infura.io/v3/YOUR_INFURA_KEY",
    nativeToken: { symbol: "ETH", decimals: 18 }
  },
  monad: {
    chainId: 41455,
    name: "Monad Testnet",
    rpcUrl: "https://testnet-rpc.monad.xyz",
    nativeToken: { symbol: "MON", decimals: 18 }
  }
};

// Initialize providers for each chain
const providers = {};
const chainStatus = {};

async function initializeChains() {
  console.log('🔗 Initializing multi-chain providers...');
  
  for (const [chainName, config] of Object.entries(CHAINS)) {
    try {
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      
      // Test connection
      const network = await provider.getNetwork();
      providers[chainName] = provider;
      chainStatus[chainName] = {
        status: 'connected',
        chainId: Number(network.chainId),
        blockNumber: await provider.getBlockNumber(),
        lastChecked: new Date().toISOString()
      };
      
      console.log(`✅ ${config.name} connected (Chain ID: ${network.chainId})`);
    } catch (error) {
      console.error(`❌ Failed to connect to ${config.name}:`, error.message);
      chainStatus[chainName] = {
        status: 'failed',
        error: error.message,
        lastChecked: new Date().toISOString()
      };
    }
  }
}

// Routes

// Health check
app.get('/health', (req, res) => {
  const connectedChains = Object.values(chainStatus).filter(s => s.status === 'connected').length;
  const totalChains = Object.keys(CHAINS).length;
  
  res.json({
    status: 'ok',
    service: 'multi-chain-backend',
    chains: {
      connected: connectedChains,
      total: totalChains,
      percentage: Math.round((connectedChains / totalChains) * 100)
    },
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
      pools: `/api/${name}/pools`,
      swap: `/api/${name}/swap`
    }
  }));

  res.json({
    totalChains: chainsInfo.length,
    chains: chainsInfo,
    timestamp: new Date().toISOString()
  });
});

// Chain-specific info endpoint
app.get('/api/:chainName/info', async (req, res) => {
  try {
    const { chainName } = req.params;
    const config = CHAINS[chainName];
    const provider = providers[chainName];
    
    if (!config) {
      return res.status(404).json({ error: `Chain ${chainName} not supported` });
    }
    
    if (!provider) {
      return res.status(503).json({ error: `Chain ${chainName} not connected` });
    }

    const [network, blockNumber, gasPrice] = await Promise.all([
      provider.getNetwork(),
      provider.getBlockNumber(),
      provider.getFeeData()
    ]);

    res.json({
      chain: chainName,
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
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error getting info for ${req.params.chainName}:`, error);
    res.status(500).json({ error: 'Failed to get chain info' });
  }
});

// Chain-specific pools endpoint (placeholder)
app.get('/api/:chainName/pools', (req, res) => {
  const { chainName } = req.params;
  const config = CHAINS[chainName];
  
  if (!config) {
    return res.status(404).json({ error: `Chain ${chainName} not supported` });
  }

  // For RiseChain, return our deployed pools
  if (chainName === 'risechain') {
    res.json({
      chain: chainName,
      pools: [
        {
          name: "USDC/USDT-1",
          address: "0x36A3950Ed31A2875dA4df2588528BDA6d9F4709A",
          liquidity: "100.0"
        },
        {
          name: "USDC/USDT-2", 
          address: "0x28784E66A02Eee695086Cd05F67d9B9866AA68F0",
          liquidity: "500.0"
        },
        {
          name: "USDC/USDT-3",
          address: "0x7C68ebB44C1EA6CF3c48F12AB8BF77BD5A834Db7",
          liquidity: "1000.0"
        },
        {
          name: "USDC/DAI-1",
          address: "0xD80bAf05268B9c8eF662ce14D5D92860CF3D3B90",
          liquidity: "200.0"
        },
        {
          name: "USDC/DAI-2",
          address: "0xA2eb11c134e58B9fD423b9e5C66B990C15D484D5",
          liquidity: "800.0"
        }
      ],
      totalPools: 5,
      timestamp: new Date().toISOString()
    });
  } else {
    res.json({
      chain: chainName,
      pools: [],
      totalPools: 0,
      message: `No pools deployed on ${config.name} yet`,
      timestamp: new Date().toISOString()
    });
  }
});

// Cross-chain routing endpoint
app.post('/api/cross-chain/route', (req, res) => {
  const { fromChain, toChain, tokenIn, tokenOut, amountIn } = req.body;
  
  if (!fromChain || !toChain || !tokenIn || !tokenOut || !amountIn) {
    return res.status(400).json({ 
      error: 'Missing required parameters: fromChain, toChain, tokenIn, tokenOut, amountIn' 
    });
  }

  // Placeholder for cross-chain routing logic
  res.json({
    route: {
      fromChain: fromChain,
      toChain: toChain,
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      amountIn: amountIn,
      steps: [
        {
          chain: fromChain,
          action: 'swap',
          description: `Swap ${tokenIn} to bridge token on ${fromChain}`
        },
        {
          chain: 'bridge',
          action: 'bridge',
          description: `Bridge tokens from ${fromChain} to ${toChain}`
        },
        {
          chain: toChain,
          action: 'swap',
          description: `Swap bridge token to ${tokenOut} on ${toChain}`
        }
      ]
    },
    status: 'simulation',
    message: 'Cross-chain routing is in development',
    timestamp: new Date().toISOString()
  });
});

// Chain isolation test endpoint
app.get('/api/isolation/test', async (req, res) => {
  try {
    const isolationResults = [];
    
    for (const [chainName, config] of Object.entries(CHAINS)) {
      const provider = providers[chainName];
      
      if (provider) {
        try {
          const blockNumber = await provider.getBlockNumber();
          isolationResults.push({
            chain: chainName,
            status: 'isolated',
            blockNumber: blockNumber,
            independent: true
          });
        } catch (error) {
          isolationResults.push({
            chain: chainName,
            status: 'failed',
            error: error.message,
            independent: false
          });
        }
      } else {
        isolationResults.push({
          chain: chainName,
          status: 'not_connected',
          independent: false
        });
      }
    }

    const successfulIsolations = isolationResults.filter(r => r.independent).length;
    
    res.json({
      isolationTest: {
        passed: successfulIsolations === Object.keys(CHAINS).length,
        successfulChains: successfulIsolations,
        totalChains: Object.keys(CHAINS).length
      },
      results: isolationResults,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error testing chain isolation:', error);
    res.status(500).json({ error: 'Failed to test chain isolation' });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
async function start() {
  await initializeChains();
  
  app.listen(PORT, () => {
    console.log(`🌐 Multi-Chain SAMM Service running on port ${PORT}`);
    console.log(`📊 Chains initialized: ${Object.keys(providers).length}/${Object.keys(CHAINS).length}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`📋 Chains info: http://localhost:${PORT}/api/chains`);
  });
}

start().catch(console.error);

module.exports = app;