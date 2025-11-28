/**
 * Fillup Strategy Recommendation Engine
 * Implements SAMM's fillup strategy by identifying smallest shards for liquidity addition
 * Guides liquidity providers to optimal pools following the research paper's strategy
 */

import {
  TokenPair,
  PoolInfo,
  PoolAnalysis,
  LiquidityRecommendation,
  FillupStrategy,
  LiquidityAmount,
  ChainConfig
} from './types';
import { PoolAnalysisService } from './PoolAnalysisService';

export class FillupStrategyEngine {
  constructor(
    private poolAnalysisService: PoolAnalysisService,
    private chainConfigs: ChainConfig[]
  ) {}

  /**
   * Get fillup strategy recommendation for a token pair on specific chain
   * Implements the core SAMM fillup strategy: direct liquidity to smallest shards
   */
  async getFillupStrategy(
    tokenPair: TokenPair,
    chainId: number
  ): Promise<FillupStrategy> {
    try {
      const poolAnalyses = await this.poolAnalysisService.analyzePoolsForTokenPair(
        tokenPair,
        chainId
      );

      if (poolAnalyses.length === 0) {
        throw new Error(`No pools found for token pair on chain ${chainId}`);
      }

      // Find the smallest shard (pool with minimum reserves)
      const smallestShard = this.identifySmallestShard(poolAnalyses);
      
      // Calculate recommended liquidity amount based on fillup strategy
      const recommendedAmount = this.calculateOptimalFillupAmount(smallestShard);

      // Determine priority based on size difference and potential returns
      const priority = this.calculateFillupPriority(smallestShard, poolAnalyses);

      return {
        targetPoolAddress: smallestShard.poolInfo.poolAddress,
        currentSize: this.calculatePoolSize(smallestShard.poolInfo),
        targetSize: this.calculateTargetSize(smallestShard, poolAnalyses),
        recommendedAmount,
        reasoning: this.generateFillupReasoning(smallestShard, poolAnalyses),
        priority
      };
    } catch (error) {
      console.error(`Error generating fillup strategy:`, error);
      throw new Error(`Failed to generate fillup strategy: ${error.message}`);
    }
  }

  /**
   * Generate liquidity recommendation for a specific amount
   */
  async generateLiquidityRecommendation(
    tokenPair: TokenPair,
    liquidityAmount: LiquidityAmount,
    chainId: number
  ): Promise<LiquidityRecommendation> {
    try {
      const poolAnalyses = await this.poolAnalysisService.analyzePoolsForTokenPair(
        tokenPair,
        chainId
      );

      if (poolAnalyses.length === 0) {
        throw new Error(`No pools found for token pair on chain ${chainId}`);
      }

      // Apply fillup strategy: recommend the smallest shard
      const smallestShard = this.identifySmallestShard(poolAnalyses);
      
      // Calculate expected returns for the recommended pool
      const expectedReturns = await this.poolAnalysisService.calculateExpectedReturns(
        smallestShard.poolInfo.poolAddress,
        liquidityAmount,
        chainId
      );

      // Calculate confidence score based on pool analysis
      const confidence = this.calculateRecommendationConfidence(smallestShard);

      return {
        poolAddress: smallestShard.poolInfo.poolAddress,
        isSmallestShard: true,
        expectedApr: expectedReturns.estimatedApr,
        feeGeneration24h: smallestShard.metrics.feesGenerated24h,
        liquidityUtilization: smallestShard.metrics.liquidityUtilization,
        chainId,
        reasoning: this.generateRecommendationReasoning(smallestShard, poolAnalyses),
        confidence
      };
    } catch (error) {
      console.error(`Error generating liquidity recommendation:`, error);
      throw new Error(`Failed to generate liquidity recommendation: ${error.message}`);
    }
  }

  /**
   * Get optimal deposit recommendations for liquidity providers
   */
  async getOptimalDepositRecommendations(
    tokenPair: TokenPair,
    maxLiquidityAmount: LiquidityAmount,
    chainId: number
  ): Promise<LiquidityRecommendation[]> {
    try {
      const poolAnalyses = await this.poolAnalysisService.analyzePoolsForTokenPair(
        tokenPair,
        chainId
      );

      if (poolAnalyses.length === 0) {
        return [];
      }

      // Sort pools by size (smallest first) - core fillup strategy
      const sortedPools = this.sortPoolsBySize(poolAnalyses);
      
      const recommendations: LiquidityRecommendation[] = [];
      let remainingLiquidity = { ...maxLiquidityAmount };

      // Distribute liquidity starting with smallest shards
      for (const pool of sortedPools) {
        if (this.isLiquidityExhausted(remainingLiquidity)) {
          break;
        }

        // Calculate how much liquidity this pool can absorb optimally
        const optimalAmount = this.calculateOptimalLiquidityForPool(
          pool,
          remainingLiquidity
        );

        if (this.isSignificantAmount(optimalAmount)) {
          const expectedReturns = await this.poolAnalysisService.calculateExpectedReturns(
            pool.poolInfo.poolAddress,
            optimalAmount,
            chainId
          );

          recommendations.push({
            poolAddress: pool.poolInfo.poolAddress,
            isSmallestShard: recommendations.length === 0, // First recommendation is always smallest
            expectedApr: expectedReturns.estimatedApr,
            feeGeneration24h: pool.metrics.feesGenerated24h,
            liquidityUtilization: pool.metrics.liquidityUtilization,
            chainId,
            reasoning: this.generateDistributionReasoning(pool, optimalAmount),
            confidence: this.calculateRecommendationConfidence(pool)
          });

          // Subtract allocated liquidity
          remainingLiquidity.tokenA -= optimalAmount.tokenA;
          remainingLiquidity.tokenB -= optimalAmount.tokenB;
        }
      }

      return recommendations;
    } catch (error) {
      console.error(`Error generating optimal deposit recommendations:`, error);
      throw new Error(`Failed to generate deposit recommendations: ${error.message}`);
    }
  }

  /**
   * Identify the smallest shard among available pools
   * Core implementation of SAMM's fillup strategy
   */
  private identifySmallestShard(poolAnalyses: PoolAnalysis[]): PoolAnalysis {
    if (poolAnalyses.length === 0) {
      throw new Error('No pools available for analysis');
    }

    // Sort by total reserves (RA + RB) to find smallest shard
    const sortedPools = poolAnalyses.sort((a, b) => {
      const sizeA = this.calculatePoolSize(a.poolInfo);
      const sizeB = this.calculatePoolSize(b.poolInfo);
      return Number(sizeA - sizeB);
    });

    return sortedPools[0];
  }

  /**
   * Calculate the total size of a pool (RA + RB)
   */
  private calculatePoolSize(poolInfo: PoolInfo): bigint {
    return poolInfo.reserveA + poolInfo.reserveB;
  }

  /**
   * Calculate optimal fillup amount for the smallest shard
   */
  private calculateOptimalFillupAmount(smallestShard: PoolAnalysis): bigint {
    const currentSize = this.calculatePoolSize(smallestShard.poolInfo);
    
    // Recommend 10-20% increase in pool size for optimal fillup
    const fillupPercentage = 0.15; // 15% increase
    const recommendedIncrease = BigInt(Math.floor(Number(currentSize) * fillupPercentage));
    
    return recommendedIncrease;
  }

  /**
   * Calculate target size for the pool after fillup
   */
  private calculateTargetSize(
    smallestShard: PoolAnalysis,
    allPools: PoolAnalysis[]
  ): bigint {
    const currentSize = this.calculatePoolSize(smallestShard.poolInfo);
    
    if (allPools.length === 1) {
      // If only one pool, target 20% growth
      return currentSize + BigInt(Math.floor(Number(currentSize) * 0.2));
    }

    // Target: bring smallest shard closer to the median size
    const sizes = allPools.map(p => this.calculatePoolSize(p.poolInfo)).sort((a, b) => Number(a - b));
    const medianSize = sizes[Math.floor(sizes.length / 2)];
    
    // Target 50% of the way to median
    const targetSize = currentSize + (medianSize - currentSize) / 2n;
    
    return targetSize;
  }

  /**
   * Calculate fillup priority based on size difference and returns
   */
  private calculateFillupPriority(
    smallestShard: PoolAnalysis,
    allPools: PoolAnalysis[]
  ): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (allPools.length === 1) {
      return 'MEDIUM';
    }

    const smallestSize = this.calculatePoolSize(smallestShard.poolInfo);
    const sizes = allPools.map(p => this.calculatePoolSize(p.poolInfo));
    const averageSize = sizes.reduce((sum, size) => sum + size, 0n) / BigInt(sizes.length);
    
    const sizeRatio = Number(smallestSize) / Number(averageSize);
    
    if (sizeRatio < 0.3) return 'HIGH';    // Much smaller than average
    if (sizeRatio < 0.6) return 'MEDIUM';  // Moderately smaller
    return 'LOW';                          // Close to average
  }

  /**
   * Generate reasoning for fillup strategy recommendation
   */
  private generateFillupReasoning(
    smallestShard: PoolAnalysis,
    allPools: PoolAnalysis[]
  ): string {
    const smallestSize = this.calculatePoolSize(smallestShard.poolInfo);
    const totalPools = allPools.length;
    
    if (totalPools === 1) {
      return `Single pool available. Adding liquidity will improve depth and reduce slippage for traders.`;
    }

    const sizes = allPools.map(p => this.calculatePoolSize(p.poolInfo));
    const averageSize = sizes.reduce((sum, size) => sum + size, 0n) / BigInt(sizes.length);
    const sizeRatio = Number(smallestSize) / Number(averageSize);
    
    return `Recommended pool is the smallest shard (${(sizeRatio * 100).toFixed(1)}% of average size). ` +
           `SAMM's fillup strategy directs liquidity to smallest shards to maintain balanced distribution ` +
           `and optimize trading efficiency across ${totalPools} available shards.`;
  }

  /**
   * Generate reasoning for liquidity recommendation
   */
  private generateRecommendationReasoning(
    recommendedPool: PoolAnalysis,
    allPools: PoolAnalysis[]
  ): string {
    const reasoning = this.generateFillupReasoning(recommendedPool, allPools);
    const expectedApr = (recommendedPool.expectedApr * 100).toFixed(2);
    
    return `${reasoning} Expected APR: ${expectedApr}%. ` +
           `Pool utilization: ${(recommendedPool.metrics.liquidityUtilization * 100).toFixed(1)}%.`;
  }

  /**
   * Sort pools by size (smallest first)
   */
  private sortPoolsBySize(poolAnalyses: PoolAnalysis[]): PoolAnalysis[] {
    return poolAnalyses.sort((a, b) => {
      const sizeA = this.calculatePoolSize(a.poolInfo);
      const sizeB = this.calculatePoolSize(b.poolInfo);
      return Number(sizeA - sizeB);
    });
  }

  /**
   * Calculate optimal liquidity amount for a specific pool
   */
  private calculateOptimalLiquidityForPool(
    pool: PoolAnalysis,
    availableLiquidity: LiquidityAmount
  ): LiquidityAmount {
    const poolSize = this.calculatePoolSize(pool.poolInfo);
    const availableSize = availableLiquidity.tokenA + availableLiquidity.tokenB;
    
    // Don't add more than 50% of pool's current size in one go
    const maxAddition = poolSize / 2n;
    const actualAddition = availableSize < maxAddition ? availableSize : maxAddition;
    
    // Maintain pool ratio
    const totalReserves = pool.poolInfo.reserveA + pool.poolInfo.reserveB;
    const tokenARatio = Number(pool.poolInfo.reserveA) / Number(totalReserves);
    
    return {
      tokenA: BigInt(Math.floor(Number(actualAddition) * tokenARatio)),
      tokenB: BigInt(Math.floor(Number(actualAddition) * (1 - tokenARatio)))
    };
  }

  /**
   * Check if liquidity amount is exhausted
   */
  private isLiquidityExhausted(liquidity: LiquidityAmount): boolean {
    return liquidity.tokenA <= 0n && liquidity.tokenB <= 0n;
  }

  /**
   * Check if liquidity amount is significant enough to recommend
   */
  private isSignificantAmount(liquidity: LiquidityAmount): boolean {
    const minAmount = 1000n; // Minimum threshold
    return liquidity.tokenA >= minAmount || liquidity.tokenB >= minAmount;
  }

  /**
   * Generate reasoning for liquidity distribution
   */
  private generateDistributionReasoning(
    pool: PoolAnalysis,
    amount: LiquidityAmount
  ): string {
    const poolSize = this.calculatePoolSize(pool.poolInfo);
    const additionSize = amount.tokenA + amount.tokenB;
    const percentage = (Number(additionSize) / Number(poolSize) * 100).toFixed(1);
    
    return `Adding ${percentage}% to pool reserves. This follows SAMM's fillup strategy ` +
           `of prioritizing smaller shards for optimal liquidity distribution.`;
  }

  /**
   * Calculate confidence score for recommendation
   */
  private calculateRecommendationConfidence(pool: PoolAnalysis): number {
    let confidence = 0.5; // Base confidence
    
    // Higher confidence for pools with good metrics
    if (pool.metrics.transactions24h > 50) confidence += 0.2;
    if (pool.metrics.liquidityUtilization > 0.1 && pool.metrics.liquidityUtilization < 0.8) confidence += 0.2;
    if (pool.expectedApr > 0.05) confidence += 0.1; // 5% APR threshold
    
    // Lower confidence for risky pools
    if (pool.riskScore > 0.5) confidence -= 0.2;
    
    return Math.max(0.1, Math.min(1.0, confidence));
  }
}