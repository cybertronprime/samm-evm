/**
 * Liquidity Router Service
 * Main service class that coordinates pool analysis and fillup strategy
 * Implements the LiquidityRouter interface from the design document
 */

import {
  TokenPair,
  LiquidityAmount,
  LiquidityRecommendation,
  FillupStrategy,
  ExpectedReturns,
  ChainConfig,
  LiquidityRouterConfig
} from './types';
import { PoolAnalysisService } from './PoolAnalysisService';
import { FillupStrategyEngine } from './FillupStrategyEngine';

export class LiquidityRouterService {
  private poolAnalysisService: PoolAnalysisService;
  private fillupStrategyEngine: FillupStrategyEngine;
  private isInitialized: boolean = false;

  constructor(private config: LiquidityRouterConfig) {
    this.initializeServices();
  }

  private initializeServices(): void {
    this.poolAnalysisService = new PoolAnalysisService(this.config.chains);
    this.fillupStrategyEngine = new FillupStrategyEngine(
      this.poolAnalysisService,
      this.config.chains
    );
    this.isInitialized = true;
  }

  /**
   * Find single best pool for liquidity provision on specific chain
   * Implements Requirements 3.1: Identify the single best SAMM pool for a given token pair
   */
  async findBestPoolForLiquidity(
    tokenPair: TokenPair,
    liquidityAmount: LiquidityAmount,
    chainId: number
  ): Promise<LiquidityRecommendation> {
    this.validateInitialization();
    this.validateChainSupport(chainId);
    this.validateLiquidityAmount(liquidityAmount);

    try {
      const recommendation = await this.fillupStrategyEngine.generateLiquidityRecommendation(
        tokenPair,
        liquidityAmount,
        chainId
      );

      // Validate recommendation meets minimum thresholds
      if (recommendation.expectedApr < 0) {
        throw new Error('No profitable liquidity opportunities found');
      }

      return recommendation;
    } catch (error) {
      console.error(`Error finding best pool for liquidity:`, error);
      throw new Error(`Failed to find best pool: ${error.message}`);
    }
  }

  /**
   * Calculate expected returns for a specific pool
   * Implements Requirements 3.3: Calculate expected returns based on pool size and fee generation
   */
  async calculateExpectedReturns(
    poolAddress: string,
    liquidityAmount: LiquidityAmount,
    chainId: number
  ): Promise<ExpectedReturns> {
    this.validateInitialization();
    this.validateChainSupport(chainId);
    this.validateLiquidityAmount(liquidityAmount);

    try {
      return await this.poolAnalysisService.calculateExpectedReturns(
        poolAddress,
        liquidityAmount,
        chainId
      );
    } catch (error) {
      console.error(`Error calculating expected returns:`, error);
      throw new Error(`Failed to calculate expected returns: ${error.message}`);
    }
  }

  /**
   * Get fillup strategy recommendation
   * Implements Requirements 3.2, 3.4: Implement fillup strategy and guide liquidity providers
   */
  async getFillupStrategy(
    tokenPair: TokenPair,
    chainId: number
  ): Promise<FillupStrategy> {
    this.validateInitialization();
    this.validateChainSupport(chainId);

    try {
      return await this.fillupStrategyEngine.getFillupStrategy(tokenPair, chainId);
    } catch (error) {
      console.error(`Error getting fillup strategy:`, error);
      throw new Error(`Failed to get fillup strategy: ${error.message}`);
    }
  }

  /**
   * Execute liquidity addition to recommended pool
   * Note: This would integrate with wallet/transaction services in production
   */
  async addLiquidityToPool(
    recommendation: LiquidityRecommendation,
    userAddress: string
  ): Promise<string> {
    this.validateInitialization();
    
    if (!userAddress || !this.isValidAddress(userAddress)) {
      throw new Error('Invalid user address provided');
    }

    try {
      // In a real implementation, this would:
      // 1. Validate user has sufficient tokens
      // 2. Prepare transaction for liquidity addition
      // 3. Execute transaction through wallet integration
      // 4. Return transaction hash
      
      console.log(`Executing liquidity addition for user ${userAddress} to pool ${recommendation.poolAddress}`);
      
      // Simulate transaction execution
      const simulatedTxHash = `0x${Math.random().toString(16).substr(2, 64)}`;
      
      return simulatedTxHash;
    } catch (error) {
      console.error(`Error executing liquidity addition:`, error);
      throw new Error(`Failed to execute liquidity addition: ${error.message}`);
    }
  }

  /**
   * Get multiple liquidity recommendations for optimal distribution
   */
  async getOptimalLiquidityDistribution(
    tokenPair: TokenPair,
    maxLiquidityAmount: LiquidityAmount,
    chainId: number
  ): Promise<LiquidityRecommendation[]> {
    this.validateInitialization();
    this.validateChainSupport(chainId);
    this.validateLiquidityAmount(maxLiquidityAmount);

    try {
      return await this.fillupStrategyEngine.getOptimalDepositRecommendations(
        tokenPair,
        maxLiquidityAmount,
        chainId
      );
    } catch (error) {
      console.error(`Error getting optimal liquidity distribution:`, error);
      throw new Error(`Failed to get optimal distribution: ${error.message}`);
    }
  }

  /**
   * Get all available pools for a token pair on specific chain
   */
  async getAvailablePoolsForTokenPair(
    tokenPair: TokenPair,
    chainId: number
  ): Promise<LiquidityRecommendation[]> {
    this.validateInitialization();
    this.validateChainSupport(chainId);

    try {
      const poolAnalyses = await this.poolAnalysisService.analyzePoolsForTokenPair(
        tokenPair,
        chainId
      );

      const recommendations: LiquidityRecommendation[] = [];
      
      for (const analysis of poolAnalyses) {
        recommendations.push({
          poolAddress: analysis.poolInfo.poolAddress,
          isSmallestShard: false, // Will be determined by comparison
          expectedApr: analysis.expectedApr,
          feeGeneration24h: analysis.metrics.feesGenerated24h,
          liquidityUtilization: analysis.metrics.liquidityUtilization,
          chainId,
          reasoning: `Pool analysis: APR ${(analysis.expectedApr * 100).toFixed(2)}%, Risk Score ${analysis.riskScore.toFixed(2)}`,
          confidence: 1.0 - analysis.riskScore
        });
      }

      // Mark the smallest shard
      if (recommendations.length > 0) {
        const sortedBySize = recommendations.sort((a, b) => 
          Number(a.feeGeneration24h) - Number(b.feeGeneration24h)
        );
        sortedBySize[0].isSmallestShard = true;
      }

      return recommendations;
    } catch (error) {
      console.error(`Error getting available pools:`, error);
      throw new Error(`Failed to get available pools: ${error.message}`);
    }
  }

  /**
   * Validate that the service is properly initialized
   */
  private validateInitialization(): void {
    if (!this.isInitialized) {
      throw new Error('LiquidityRouterService not properly initialized');
    }
  }

  /**
   * Validate that the chain is supported
   */
  private validateChainSupport(chainId: number): void {
    const supportedChain = this.config.chains.find(c => c.chainId === chainId);
    if (!supportedChain) {
      throw new Error(`Chain ${chainId} is not supported`);
    }
  }

  /**
   * Validate liquidity amount parameters
   */
  private validateLiquidityAmount(liquidityAmount: LiquidityAmount): void {
    if (liquidityAmount.tokenA < 0n || liquidityAmount.tokenB < 0n) {
      throw new Error('Liquidity amounts must be non-negative');
    }

    if (liquidityAmount.tokenA === 0n && liquidityAmount.tokenB === 0n) {
      throw new Error('At least one token amount must be greater than zero');
    }

    // Check against minimum threshold
    const totalValue = liquidityAmount.tokenA + liquidityAmount.tokenB;
    if (totalValue < this.config.minLiquidityThreshold) {
      throw new Error(`Liquidity amount below minimum threshold: ${this.config.minLiquidityThreshold}`);
    }
  }

  /**
   * Validate Ethereum address format
   */
  private isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  /**
   * Get supported chains
   */
  getSupportedChains(): number[] {
    return this.config.chains.map(c => c.chainId);
  }

  /**
   * Get chain configuration
   */
  getChainConfig(chainId: number): ChainConfig | undefined {
    return this.config.chains.find(c => c.chainId === chainId);
  }

  /**
   * Health check for the service
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    chains: { chainId: number; status: 'connected' | 'disconnected' }[];
    lastUpdated: Date;
  }> {
    const chainStatuses = [];
    let overallHealthy = true;

    for (const chain of this.config.chains) {
      try {
        // Test connection by trying to get a simple pool analysis
        // In a real implementation, this would ping the RPC endpoint
        chainStatuses.push({
          chainId: chain.chainId,
          status: 'connected' as const
        });
      } catch (error) {
        chainStatuses.push({
          chainId: chain.chainId,
          status: 'disconnected' as const
        });
        overallHealthy = false;
      }
    }

    return {
      status: overallHealthy ? 'healthy' : 'unhealthy',
      chains: chainStatuses,
      lastUpdated: new Date()
    };
  }

  /**
   * Clear caches and refresh data
   */
  async refreshData(): Promise<void> {
    try {
      this.poolAnalysisService.clearExpiredCache();
      console.log('Liquidity router data refreshed successfully');
    } catch (error) {
      console.error('Error refreshing liquidity router data:', error);
      throw new Error(`Failed to refresh data: ${error.message}`);
    }
  }

  /**
   * Get service statistics
   */
  getServiceStats(): {
    supportedChains: number;
    cacheSize: number;
    uptime: number;
  } {
    return {
      supportedChains: this.config.chains.length,
      cacheSize: 0, // Would track actual cache size in production
      uptime: Date.now() // Would track actual uptime in production
    };
  }
}