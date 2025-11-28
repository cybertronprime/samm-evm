/**
 * Router Service Integration Example
 * Demonstrates how to use the Router Service with Cross-Pool Router
 */

import { ethers } from 'ethers';
import { RouterService, RouterSDK, createRouterService } from '../index';
import { CrossPoolRouterAPI } from '../../cross-pool-router/CrossPoolRouterAPI';
import { ShardDiscoveryConfig, RouterServiceConfig, TokenPair } from '../types';

/**
 * Complete integration example showing Router Service usage
 */
export class RouterIntegrationExample {
  private provider: ethers.Provider;
  private signer: ethers.Signer;
  private routerService?: RouterService;
  private routerSDK?: RouterSDK;
  private crossPoolAPI?: CrossPoolRouterAPI;

  constructor(rpcEndpoint: string, privateKey: string) {
    this.provider = new ethers.JsonRpcProvider(rpcEndpoint);
    this.signer = new ethers.Wallet(privateKey, this.provider);
  }

  /**
   * Initialize all services
   */
  async initialize(): Promise<void> {
    console.log('Initializing Router Service integration...');

    // 1. Setup Router Service
    await this.setupRouterService();

    // 2. Setup Router SDK
    this.setupRouterSDK();

    // 3. Setup Cross-Pool Router (for multi-hop trades)
    await this.setupCrossPoolRouter();

    console.log('Integration setup complete!');
  }

  /**
   * Setup Router Service for single-pool routing
   */
  private async setupRouterService(): Promise<void> {
    const chainConfig: ShardDiscoveryConfig = {
      chainId: 1, // Ethereum mainnet
      rpcEndpoint: 'https://mainnet.infura.io/v3/your-key',
      poolFactoryAddress: '0x...', // SAMM Pool Factory address
      refreshInterval: 30000, // 30 seconds
      minLiquidityThreshold: ethers.parseEther('1000'), // Min 1000 tokens
      maxCacheAge: 60000, // 1 minute
      enableRealTimeMonitoring: true,
      batchSize: 10
    };

    const { router, api } = await createRouterService(
      chainConfig,
      this.provider,
      this.signer,
      {
        port: 3001,
        apiPrefix: '/api/v1/router'
      }
    );

    this.routerService = router;
    
    // Start the service
    await router.start();
    await api.start();

    console.log('Router Service started on port 3001');
  }

  /**
   * Setup Router SDK for client interactions
   */
  private setupRouterSDK(): void {
    this.routerSDK = new RouterSDK({
      baseURL: 'http://localhost:3001',
      timeout: 30000,
      retries: 3,
      retryDelay: 1000
    });

    console.log('Router SDK initialized');
  }

  /**
   * Setup Cross-Pool Router for multi-hop trades
   */
  private async setupCrossPoolRouter(): Promise<void> {
    // This would integrate with the existing Cross-Pool Router
    // For demonstration purposes, we'll show how they work together
    console.log('Cross-Pool Router integration ready');
  }

  /**
   * Example 1: Simple single-pool trade
   */
  async exampleSinglePoolTrade(): Promise<void> {
    console.log('\n=== Example 1: Single-Pool Trade ===');

    if (!this.routerSDK) {
      throw new Error('Router SDK not initialized');
    }

    // Define token pair
    const tokenPair: TokenPair = {
      tokenA: {
        address: '0xA0b86a33E6441c8C06DD2b7c94b7E0e8b8b8b8b8', // USDC
        symbol: 'USDC',
        decimals: 6,
        chainId: 1
      },
      tokenB: {
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        symbol: 'WETH',
        decimals: 18,
        chainId: 1
      },
      chainId: 1
    };

    const userAddress = await this.signer.getAddress();
    const desiredOutput = ethers.parseEther('1'); // Want 1 WETH

    try {
      // 1. Find optimal shard
      console.log('Finding optimal shard for 1 WETH...');
      const routingResult = await this.routerSDK.findOptimalShard({
        tokenPair,
        outputAmount: desiredOutput,
        chainId: 1,
        userAddress,
        slippageTolerance: 1.0 // 1% slippage
      });

      if (!routingResult.success || !routingResult.data?.routing) {
        console.error('No optimal shard found:', routingResult.error);
        return;
      }

      const routing = routingResult.data.routing;
      console.log('Optimal shard found:', {
        shardId: routing.shardId,
        expectedAmountIn: ethers.formatUnits(routing.expectedAmountIn, 6),
        isSmallestShard: routing.isSmallestShard,
        confidenceScore: routing.confidenceScore
      });

      // 2. Get quote first (dry run)
      console.log('Getting trade quote...');
      const quoteResult = await this.routerSDK.quoteRoute({
        tokenPair,
        outputAmount: desiredOutput,
        chainId: 1,
        userAddress
      });

      if (quoteResult.success) {
        console.log('Trade quote:', {
          expectedAmountIn: quoteResult.data?.expectedAmountIn,
          estimatedFee: quoteResult.data?.estimatedFee,
          priceImpact: `${quoteResult.data?.priceImpact}%`,
          cThresholdValidated: quoteResult.data?.cThresholdValidated
        });
      }

      // 3. Execute the trade
      console.log('Executing trade...');
      const maxAmountIn = BigInt(routing.expectedAmountIn) * BigInt(110) / BigInt(100); // 10% slippage buffer

      const tradeResult = await this.routerSDK.executeTrade({
        routing,
        maxAmountIn,
        userAddress,
        recipient: userAddress,
        deadline: Math.floor(Date.now() / 1000) + 1800 // 30 minutes
      });

      if (tradeResult.success) {
        console.log('Trade executed successfully!', {
          transactionHash: tradeResult.data?.transactionHash,
          actualAmountIn: tradeResult.data?.actualAmountIn,
          actualAmountOut: tradeResult.data?.actualAmountOut,
          gasUsed: tradeResult.data?.gasUsed
        });
      } else {
        console.error('Trade execution failed:', tradeResult.error);
      }

    } catch (error) {
      console.error('Single-pool trade example failed:', error);
    }
  }

  /**
   * Example 2: Shard discovery and analysis
   */
  async exampleShardDiscovery(): Promise<void> {
    console.log('\n=== Example 2: Shard Discovery ===');

    if (!this.routerSDK) {
      throw new Error('Router SDK not initialized');
    }

    try {
      // 1. Get all shards overview
      console.log('Getting all shards overview...');
      const allShardsResult = await this.routerSDK.getAllShards();
      
      if (allShardsResult.success) {
        console.log('Shards overview:', allShardsResult.data);
      }

      // 2. Get available shards for specific token pair
      const tokenPair: TokenPair = {
        tokenA: {
          address: '0xA0b86a33E6441c8C06DD2b7c94b7E0e8b8b8b8b8', // USDC
          symbol: 'USDC',
          decimals: 6,
          chainId: 1
        },
        tokenB: {
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
          symbol: 'WETH',
          decimals: 18,
          chainId: 1
        },
        chainId: 1
      };

      console.log('Getting available shards for USDC/WETH...');
      const availableShardsResult = await this.routerSDK.getAvailableShards(tokenPair);
      
      if (availableShardsResult.success) {
        console.log(`Found ${availableShardsResult.data?.count} available shards`);
        
        // Analyze shard sizes
        const shards = availableShardsResult.data?.shards || [];
        if (shards.length > 0) {
          console.log('Shard analysis:');
          shards.forEach((shard, index) => {
            console.log(`  Shard ${index + 1}:`, {
              poolAddress: shard.poolAddress,
              reserveA: ethers.formatUnits(shard.reserveA, 6),
              reserveB: ethers.formatEther(shard.reserveB),
              status: shard.status
            });
          });
        }
      }

      // 3. Get specific shard information
      if (availableShardsResult.success && availableShardsResult.data?.shards.length > 0) {
        const firstShard = availableShardsResult.data.shards[0];
        console.log('Getting detailed info for first shard...');
        
        const shardInfoResult = await this.routerSDK.getShardInfo(firstShard.poolAddress);
        
        if (shardInfoResult.success) {
          console.log('Detailed shard info:', {
            sammParams: shardInfoResult.data?.sammParams,
            fees: shardInfoResult.data?.fees,
            metrics: shardInfoResult.data?.metrics
          });
        }
      }

    } catch (error) {
      console.error('Shard discovery example failed:', error);
    }
  }

  /**
   * Example 3: C-threshold validation
   */
  async exampleCThresholdValidation(): Promise<void> {
    console.log('\n=== Example 3: C-Threshold Validation ===');

    if (!this.routerSDK) {
      throw new Error('Router SDK not initialized');
    }

    try {
      // Get a shard to test with
      const tokenPair: TokenPair = {
        tokenA: {
          address: '0xA0b86a33E6441c8C06DD2b7c94b7E0e8b8b8b8b8', // USDC
          symbol: 'USDC',
          decimals: 6,
          chainId: 1
        },
        tokenB: {
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
          symbol: 'WETH',
          decimals: 18,
          chainId: 1
        },
        chainId: 1
      };

      const availableShardsResult = await this.routerSDK.getAvailableShards(tokenPair);
      
      if (!availableShardsResult.success || !availableShardsResult.data?.shards.length) {
        console.log('No shards available for c-threshold testing');
        return;
      }

      const testShard = availableShardsResult.data.shards[0];
      const poolAddress = testShard.poolAddress;
      const inputToken = testShard.tokenA.address; // Use tokenA as input

      // Test different trade amounts
      const testAmounts = [
        ethers.parseEther('0.1'),   // Small trade
        ethers.parseEther('1'),     // Medium trade
        ethers.parseEther('10'),    // Large trade
        ethers.parseEther('100')    // Very large trade
      ];

      console.log('Testing c-threshold validation for different trade amounts...');

      for (const amount of testAmounts) {
        const validationResult = await this.routerSDK.validateCThreshold(
          poolAddress,
          amount,
          inputToken
        );

        if (validationResult.success) {
          console.log(`Amount ${ethers.formatEther(amount)} ETH:`, {
            isValid: validationResult.data?.isValid,
            ratio: validationResult.data?.ratio,
            cParameter: validationResult.data?.cParameter
          });
        }
      }

    } catch (error) {
      console.error('C-threshold validation example failed:', error);
    }
  }

  /**
   * Example 4: Performance monitoring
   */
  async examplePerformanceMonitoring(): Promise<void> {
    console.log('\n=== Example 4: Performance Monitoring ===');

    if (!this.routerSDK) {
      throw new Error('Router SDK not initialized');
    }

    try {
      // Get current statistics
      console.log('Getting router statistics...');
      const statsResult = await this.routerSDK.getStats();
      
      if (statsResult.success) {
        console.log('Router Statistics:', {
          totalRequests: statsResult.data?.totalRequests,
          successRate: `${statsResult.data?.successRate.toFixed(2)}%`,
          avgRoutingTime: `${statsResult.data?.avgRoutingTime.toFixed(2)}ms`,
          totalTradesExecuted: statsResult.data?.totalTradesExecuted,
          cacheHitRate: `${statsResult.data?.cacheHitRate.toFixed(2)}%`
        });
      }

      // Get shard metrics
      console.log('Getting shard metrics...');
      const metricsResult = await this.routerSDK.getMetrics();
      
      if (metricsResult.success) {
        console.log('Shard Metrics:', {
          totalActiveShards: metricsResult.data?.totalActiveShards,
          tokenPairCount: metricsResult.data?.tokenPairCount,
          healthStatus: metricsResult.data?.healthStatus,
          errorCount: metricsResult.data?.errorCount
        });
      }

      // Get comprehensive status
      console.log('Getting comprehensive router status...');
      const statusResult = await this.routerSDK.getRouterStatus();
      
      if (statusResult.success) {
        console.log('Router Status:', {
          health: statusResult.data?.health.status,
          performance: {
            successRate: statusResult.data?.stats.successRate,
            activeShards: statusResult.data?.metrics.totalActiveShards
          }
        });
      }

    } catch (error) {
      console.error('Performance monitoring example failed:', error);
    }
  }

  /**
   * Run all examples
   */
  async runAllExamples(): Promise<void> {
    try {
      await this.initialize();
      
      await this.exampleSinglePoolTrade();
      await this.exampleShardDiscovery();
      await this.exampleCThresholdValidation();
      await this.examplePerformanceMonitoring();
      
      console.log('\n=== All examples completed successfully! ===');
      
    } catch (error) {
      console.error('Examples failed:', error);
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.routerService) {
      this.routerService.stop();
    }
    console.log('Cleanup completed');
  }
}

/**
 * Run the integration example
 */
async function main() {
  const example = new RouterIntegrationExample(
    'https://mainnet.infura.io/v3/your-key',
    'your-private-key'
  );

  try {
    await example.runAllExamples();
  } finally {
    await example.cleanup();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { RouterIntegrationExample };