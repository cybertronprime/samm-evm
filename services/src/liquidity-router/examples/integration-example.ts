/**
 * Liquidity Router Integration Example
 * Demonstrates how to use the Liquidity Router Service for optimal liquidity provision
 */

import { 
  LiquidityRouterService, 
  LiquidityRouterAPI,
  createDefaultConfig,
  TokenPair,
  LiquidityAmount,
  ChainConfig
} from '../index';

async function demonstrateLiquidityRouter() {
  console.log('🚀 SAMM Liquidity Router Integration Example\n');

  // 1. Create configuration for multiple chains
  const config = {
    chains: [
      {
        chainId: 11155111, // Sepolia
        name: 'Ethereum Sepolia',
        rpcEndpoint: process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/YOUR_KEY',
        contractAddresses: {
          sammPoolFactory: process.env.SEPOLIA_SAMM_FACTORY || '0x1234567890123456789012345678901234567890',
          router: process.env.SEPOLIA_ROUTER || '0x0987654321098765432109876543210987654321'
        }
      },
      {
        chainId: 1234, // Monad (example)
        name: 'Monad Testnet',
        rpcEndpoint: process.env.MONAD_RPC_URL || 'https://monad-testnet.example.com',
        contractAddresses: {
          sammPoolFactory: process.env.MONAD_SAMM_FACTORY || '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
          router: process.env.MONAD_ROUTER || '0x1234567890ABCDEF1234567890ABCDEF12345678'
        }
      }
    ],
    analysisInterval: 5 * 60 * 1000, // 5 minutes
    metricsRetentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
    minLiquidityThreshold: BigInt(1000),
    maxRiskScore: 0.8
  };

  // 2. Initialize the Liquidity Router Service
  console.log('📊 Initializing Liquidity Router Service...');
  const liquidityRouter = new LiquidityRouterService(config);

  // 3. Define token pairs for testing
  const usdcEthPair: TokenPair = {
    tokenA: {
      address: '0xA0b86a33E6441E6C7D3E4C2C0b5c7E6D8F9E0A1B',
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin'
    },
    tokenB: {
      address: '0xB1c97a44F7552F7C4E5D3F8E9A0B1C2D3E4F5A6B',
      symbol: 'ETH',
      decimals: 18,
      name: 'Ethereum'
    }
  };

  const liquidityAmount: LiquidityAmount = {
    tokenA: BigInt(1000 * 10**6), // 1000 USDC
    tokenB: BigInt(1 * 10**18)    // 1 ETH
  };

  console.log('💰 Token Pair: USDC/ETH');
  console.log(`💰 Liquidity Amount: ${liquidityAmount.tokenA.toString()} USDC, ${liquidityAmount.tokenB.toString()} ETH\n`);

  // 4. Demonstrate chain isolation - test on multiple chains
  const testChains = [11155111, 1234]; // Sepolia and Monad

  for (const chainId of testChains) {
    console.log(`🔗 Testing on Chain ID: ${chainId}`);
    
    try {
      // 4.1 Get fillup strategy
      console.log('  📈 Getting fillup strategy...');
      const fillupStrategy = await liquidityRouter.getFillupStrategy(usdcEthPair, chainId);
      
      console.log(`  ✅ Fillup Strategy:`);
      console.log(`     Target Pool: ${fillupStrategy.targetPoolAddress}`);
      console.log(`     Current Size: ${fillupStrategy.currentSize.toString()}`);
      console.log(`     Target Size: ${fillupStrategy.targetSize.toString()}`);
      console.log(`     Recommended Amount: ${fillupStrategy.recommendedAmount.toString()}`);
      console.log(`     Priority: ${fillupStrategy.priority}`);
      console.log(`     Reasoning: ${fillupStrategy.reasoning}\n`);

      // 4.2 Get liquidity recommendation
      console.log('  🎯 Getting liquidity recommendation...');
      const recommendation = await liquidityRouter.findBestPoolForLiquidity(
        usdcEthPair,
        liquidityAmount,
        chainId
      );

      console.log(`  ✅ Liquidity Recommendation:`);
      console.log(`     Pool Address: ${recommendation.poolAddress}`);
      console.log(`     Is Smallest Shard: ${recommendation.isSmallestShard}`);
      console.log(`     Expected APR: ${(recommendation.expectedApr * 100).toFixed(2)}%`);
      console.log(`     Fee Generation (24h): ${recommendation.feeGeneration24h.toString()}`);
      console.log(`     Liquidity Utilization: ${(recommendation.liquidityUtilization * 100).toFixed(1)}%`);
      console.log(`     Confidence: ${(recommendation.confidence * 100).toFixed(1)}%`);
      console.log(`     Reasoning: ${recommendation.reasoning}\n`);

      // 4.3 Calculate expected returns
      console.log('  💹 Calculating expected returns...');
      const expectedReturns = await liquidityRouter.calculateExpectedReturns(
        recommendation.poolAddress,
        liquidityAmount,
        chainId
      );

      console.log(`  ✅ Expected Returns:`);
      console.log(`     Daily Fees: ${expectedReturns.dailyFees.toString()}`);
      console.log(`     Weekly Fees: ${expectedReturns.weeklyFees.toString()}`);
      console.log(`     Monthly Fees: ${expectedReturns.monthlyFees.toString()}`);
      console.log(`     Estimated APR: ${(expectedReturns.estimatedApr * 100).toFixed(2)}%`);
      console.log(`     Impermanent Loss Risk: ${(expectedReturns.impermanentLossRisk * 100).toFixed(2)}%`);
      console.log(`     Liquidity Share: ${(expectedReturns.liquidityShare * 100).toFixed(2)}%\n`);

      // 4.4 Get optimal distribution for larger amounts
      const largerAmount: LiquidityAmount = {
        tokenA: BigInt(10000 * 10**6), // 10,000 USDC
        tokenB: BigInt(5 * 10**18)     // 5 ETH
      };

      console.log('  📊 Getting optimal distribution for larger amount...');
      const distribution = await liquidityRouter.getOptimalLiquidityDistribution(
        usdcEthPair,
        largerAmount,
        chainId
      );

      console.log(`  ✅ Optimal Distribution (${distribution.length} recommendations):`);
      distribution.forEach((rec, index) => {
        console.log(`     ${index + 1}. Pool: ${rec.poolAddress}`);
        console.log(`        Smallest Shard: ${rec.isSmallestShard}`);
        console.log(`        Expected APR: ${(rec.expectedApr * 100).toFixed(2)}%`);
        console.log(`        Confidence: ${(rec.confidence * 100).toFixed(1)}%`);
      });

    } catch (error) {
      console.log(`  ❌ Error on chain ${chainId}: ${error.message}`);
    }

    console.log('  ' + '─'.repeat(50) + '\n');
  }

  // 5. Demonstrate service health and statistics
  console.log('🏥 Service Health Check...');
  const health = await liquidityRouter.healthCheck();
  
  console.log(`✅ Service Status: ${health.status}`);
  console.log(`📊 Chain Status:`);
  health.chains.forEach(chain => {
    console.log(`   Chain ${chain.chainId}: ${chain.status}`);
  });

  const stats = liquidityRouter.getServiceStats();
  console.log(`📈 Service Statistics:`);
  console.log(`   Supported Chains: ${stats.supportedChains}`);
  console.log(`   Cache Size: ${stats.cacheSize}`);
  console.log(`   Uptime: ${stats.uptime}\n`);

  // 6. Demonstrate error handling
  console.log('🚨 Testing Error Handling...');
  
  try {
    // Test unsupported chain
    await liquidityRouter.getFillupStrategy(usdcEthPair, 999999);
  } catch (error) {
    console.log(`✅ Correctly handled unsupported chain: ${error.message}`);
  }

  try {
    // Test invalid liquidity amount
    const invalidAmount: LiquidityAmount = {
      tokenA: -1n,
      tokenB: 1000n
    };
    await liquidityRouter.findBestPoolForLiquidity(usdcEthPair, invalidAmount, 11155111);
  } catch (error) {
    console.log(`✅ Correctly handled invalid liquidity amount: ${error.message}`);
  }

  console.log('\n🎉 Liquidity Router Integration Example Complete!');
}

// Example of starting the API server
async function demonstrateLiquidityRouterAPI() {
  console.log('\n🌐 Starting Liquidity Router API Server...\n');

  const config = createDefaultConfig();
  const api = new LiquidityRouterAPI(config, 3002);

  try {
    await api.start();
    console.log('✅ Liquidity Router API Server started successfully!');
    console.log('📡 Available endpoints:');
    console.log('   GET  /health - Health check');
    console.log('   GET  /api/liquidity-router/info - Service information');
    console.log('   GET  /api/liquidity-router/{chainId}/pools - Available pools');
    console.log('   POST /api/liquidity-router/{chainId}/recommend - Get recommendation');
    console.log('   POST /api/liquidity-router/{chainId}/fillup-strategy - Get fillup strategy');
    console.log('   POST /api/liquidity-router/{chainId}/expected-returns - Calculate returns');
    console.log('   POST /api/liquidity-router/{chainId}/optimal-distribution - Get distribution');
    console.log('   POST /api/liquidity-router/{chainId}/add-liquidity - Execute liquidity addition');
    
    console.log('\n💡 Example API calls:');
    console.log('curl http://localhost:3002/health');
    console.log('curl http://localhost:3002/api/liquidity-router/info');
    
  } catch (error) {
    console.error('❌ Failed to start API server:', error.message);
  }
}

// Run the examples
if (require.main === module) {
  demonstrateLiquidityRouter()
    .then(() => demonstrateLiquidityRouterAPI())
    .catch(console.error);
}

export {
  demonstrateLiquidityRouter,
  demonstrateLiquidityRouterAPI
};