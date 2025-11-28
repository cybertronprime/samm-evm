/**
 * Pool Analysis Service
 * Analyzes all available pools for token pairs on specific chains
 * Implements expected return calculations and performance tracking
 */

import { ethers } from 'ethers';
import {
  TokenPair,
  PoolInfo,
  PoolMetrics,
  PoolAnalysis,
  ChainConfig,
  LiquidityAmount,
  ExpectedReturns
} from './types';

export class PoolAnalysisService {
  private providers: Map<number, ethers.Provider> = new Map();
  private poolMetricsCache: Map<string, PoolMetrics> = new Map();
  private analysisCache: Map<string, PoolAnalysis> = new Map();
  private cacheExpiry: number = 5 * 60 * 1000; // 5 minutes

  constructor(private chainConfigs: ChainConfig[]) {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    for (const config of this.chainConfigs) {
      const provider = new ethers.JsonRpcProvider(config.rpcEndpoint);
      this.providers.set(config.chainId, provider);
    }
  }

  /**
   * Analyze all available pools for a token pair on specific chain
   */
  async analyzePoolsForTokenPair(
    tokenPair: TokenPair,
    chainId: number
  ): Promise<PoolAnalysis[]> {
    const cacheKey = `${chainId}-${tokenPair.tokenA.address}-${tokenPair.tokenB.address}`;
    
    // Check cache first
    const cached = this.analysisCache.get(cacheKey);
    if (cached && this.isCacheValid(cached.poolInfo.poolAddress)) {
      return [cached];
    }

    try {
      const pools = await this.discoverPoolsForTokenPair(tokenPair, chainId);
      const analyses: PoolAnalysis[] = [];

      for (const pool of pools) {
        const metrics = await this.collectPoolMetrics(pool);
        const analysis = await this.performPoolAnalysis(pool, metrics);
        analyses.push(analysis);
        
        // Cache the analysis
        this.analysisCache.set(cacheKey, analysis);
      }

      return analyses.sort((a, b) => b.expectedApr - a.expectedApr);
    } catch (error) {
      console.error(`Error analyzing pools for token pair on chain ${chainId}:`, error);
      throw new Error(`Failed to analyze pools: ${error.message}`);
    }
  }

  /**
   * Calculate expected returns for a specific pool and liquidity amount
   */
  async calculateExpectedReturns(
    poolAddress: string,
    liquidityAmount: LiquidityAmount,
    chainId: number
  ): Promise<ExpectedReturns> {
    try {
      const poolInfo = await this.getPoolInfo(poolAddress, chainId);
      const metrics = await this.collectPoolMetrics(poolInfo);

      // Calculate liquidity share
      const totalLiquidityValue = this.calculatePoolValue(poolInfo);
      const addedLiquidityValue = this.calculateLiquidityValue(liquidityAmount, poolInfo);
      const liquidityShare = Number(addedLiquidityValue) / (Number(totalLiquidityValue) + Number(addedLiquidityValue));

      // Calculate expected fees based on historical data
      const dailyFees = BigInt(Math.floor(Number(metrics.feesGenerated24h) * liquidityShare));
      const weeklyFees = dailyFees * 7n;
      const monthlyFees = dailyFees * 30n;

      // Calculate APR
      const yearlyFees = dailyFees * 365n;
      const estimatedApr = Number(yearlyFees) / Number(addedLiquidityValue);

      // Estimate impermanent loss risk based on price volatility
      const impermanentLossRisk = this.calculateImpermanentLossRisk(metrics);

      return {
        dailyFees,
        weeklyFees,
        monthlyFees,
        estimatedApr,
        impermanentLossRisk,
        liquidityShare
      };
    } catch (error) {
      console.error(`Error calculating expected returns for pool ${poolAddress}:`, error);
      throw new Error(`Failed to calculate expected returns: ${error.message}`);
    }
  }

  /**
   * Discover all pools for a token pair on a specific chain
   */
  private async discoverPoolsForTokenPair(
    tokenPair: TokenPair,
    chainId: number
  ): Promise<PoolInfo[]> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`No provider configured for chain ${chainId}`);
    }

    const chainConfig = this.chainConfigs.find(c => c.chainId === chainId);
    if (!chainConfig) {
      throw new Error(`No configuration found for chain ${chainId}`);
    }

    // Query the SAMM Pool Factory for pools
    const factoryAbi = [
      "function getPoolsForTokenPair(address tokenA, address tokenB) external view returns (address[] memory)",
      "function getPoolInfo(address pool) external view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply))"
    ];

    const factory = new ethers.Contract(
      chainConfig.contractAddresses.sammPoolFactory,
      factoryAbi,
      provider
    );

    try {
      const poolAddresses = await factory.getPoolsForTokenPair(
        tokenPair.tokenA.address,
        tokenPair.tokenB.address
      );

      const pools: PoolInfo[] = [];
      for (const poolAddress of poolAddresses) {
        const poolInfo = await this.getPoolInfo(poolAddress, chainId);
        pools.push(poolInfo);
      }

      return pools;
    } catch (error) {
      console.error(`Error discovering pools for token pair:`, error);
      return [];
    }
  }

  /**
   * Get detailed information about a specific pool
   */
  private async getPoolInfo(poolAddress: string, chainId: number): Promise<PoolInfo> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`No provider configured for chain ${chainId}`);
    }

    const poolAbi = [
      "function getReserves() external view returns (uint256 reserveA, uint256 reserveB)",
      "function totalSupply() external view returns (uint256)",
      "function tokenA() external view returns (address)",
      "function tokenB() external view returns (address)"
    ];

    const pool = new ethers.Contract(poolAddress, poolAbi, provider);

    try {
      const [reserves, totalSupply, tokenAAddress, tokenBAddress] = await Promise.all([
        pool.getReserves(),
        pool.totalSupply(),
        pool.tokenA(),
        pool.tokenB()
      ]);

      // Get token information
      const tokenA = await this.getTokenInfo(tokenAAddress, chainId);
      const tokenB = await this.getTokenInfo(tokenBAddress, chainId);

      return {
        poolAddress,
        tokenA,
        tokenB,
        reserveA: reserves.reserveA,
        reserveB: reserves.reserveB,
        totalSupply,
        chainId,
        isSmallestShard: false // Will be determined by comparison
      };
    } catch (error) {
      console.error(`Error getting pool info for ${poolAddress}:`, error);
      throw new Error(`Failed to get pool info: ${error.message}`);
    }
  }

  /**
   * Get token information from contract
   */
  private async getTokenInfo(tokenAddress: string, chainId: number) {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`No provider configured for chain ${chainId}`);
    }

    const tokenAbi = [
      "function symbol() external view returns (string)",
      "function name() external view returns (string)",
      "function decimals() external view returns (uint8)"
    ];

    const token = new ethers.Contract(tokenAddress, tokenAbi, provider);

    try {
      const [symbol, name, decimals] = await Promise.all([
        token.symbol(),
        token.name(),
        token.decimals()
      ]);

      return {
        address: tokenAddress,
        symbol,
        name,
        decimals: Number(decimals)
      };
    } catch (error) {
      console.error(`Error getting token info for ${tokenAddress}:`, error);
      throw new Error(`Failed to get token info: ${error.message}`);
    }
  }

  /**
   * Collect performance metrics for a pool
   */
  private async collectPoolMetrics(poolInfo: PoolInfo): Promise<PoolMetrics> {
    const cacheKey = `metrics-${poolInfo.poolAddress}`;
    const cached = this.poolMetricsCache.get(cacheKey);
    
    if (cached && this.isCacheValid(cacheKey)) {
      return cached;
    }

    try {
      // In a real implementation, this would query historical data
      // For now, we'll simulate metrics based on pool size
      const poolValue = this.calculatePoolValue(poolInfo);
      
      // Simulate metrics based on pool size (larger pools typically have more activity)
      const baseVolume = Number(poolValue) * 0.1; // 10% daily turnover
      const volume24h = BigInt(Math.floor(baseVolume));
      const transactions24h = Math.floor(Number(poolValue) / 1000); // Estimate based on pool size
      const feesGenerated24h = volume24h * 3n / 1000n; // 0.3% fee
      
      const metrics: PoolMetrics = {
        volume24h,
        transactions24h,
        feesGenerated24h,
        liquidityUtilization: Math.min(0.8, Number(volume24h) / Number(poolValue)),
        averageTradeSize: transactions24h > 0 ? volume24h / BigInt(transactions24h) : 0n,
        lastUpdated: new Date()
      };

      this.poolMetricsCache.set(cacheKey, metrics);
      return metrics;
    } catch (error) {
      console.error(`Error collecting pool metrics:`, error);
      throw new Error(`Failed to collect pool metrics: ${error.message}`);
    }
  }

  /**
   * Perform comprehensive analysis of a pool
   */
  private async performPoolAnalysis(
    poolInfo: PoolInfo,
    metrics: PoolMetrics
  ): Promise<PoolAnalysis> {
    const poolValue = this.calculatePoolValue(poolInfo);
    
    // Calculate expected APR based on fees
    const yearlyFees = metrics.feesGenerated24h * 365n;
    const expectedApr = Number(yearlyFees) / Number(poolValue);

    // Calculate risk score (lower is better)
    const riskScore = this.calculateRiskScore(poolInfo, metrics);

    // Calculate liquidity efficiency
    const liquidityEfficiency = metrics.liquidityUtilization;

    return {
      poolInfo,
      metrics,
      expectedApr,
      riskScore,
      liquidityEfficiency
    };
  }

  /**
   * Calculate the total value of a pool
   */
  private calculatePoolValue(poolInfo: PoolInfo): bigint {
    // Simplified calculation assuming 1:1 price ratio
    // In reality, this would use price oracles
    const tokenAValue = poolInfo.reserveA;
    const tokenBValue = poolInfo.reserveB;
    return tokenAValue + tokenBValue;
  }

  /**
   * Calculate the value of a liquidity amount
   */
  private calculateLiquidityValue(
    liquidityAmount: LiquidityAmount,
    poolInfo: PoolInfo
  ): bigint {
    // Simplified calculation
    return liquidityAmount.tokenA + liquidityAmount.tokenB;
  }

  /**
   * Calculate risk score for a pool
   */
  private calculateRiskScore(poolInfo: PoolInfo, metrics: PoolMetrics): number {
    let riskScore = 0;

    // Size risk (smaller pools are riskier)
    const poolValue = Number(this.calculatePoolValue(poolInfo));
    if (poolValue < 10000) riskScore += 0.3;
    else if (poolValue < 100000) riskScore += 0.2;
    else if (poolValue < 1000000) riskScore += 0.1;

    // Utilization risk (very high or very low utilization is risky)
    if (metrics.liquidityUtilization > 0.9 || metrics.liquidityUtilization < 0.1) {
      riskScore += 0.2;
    }

    // Volume consistency risk
    if (metrics.transactions24h < 10) riskScore += 0.2;

    return Math.min(1.0, riskScore);
  }

  /**
   * Calculate impermanent loss risk
   */
  private calculateImpermanentLossRisk(metrics: PoolMetrics): number {
    // Simplified calculation based on trading activity
    // Higher activity suggests more price volatility
    const activityScore = Math.min(1.0, metrics.liquidityUtilization);
    return activityScore * 0.1; // Max 10% impermanent loss risk
  }

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid(key: string): boolean {
    const entry = this.poolMetricsCache.get(key);
    if (!entry) return false;
    
    const now = Date.now();
    const entryTime = entry.lastUpdated.getTime();
    return (now - entryTime) < this.cacheExpiry;
  }

  /**
   * Clear expired cache entries
   */
  public clearExpiredCache(): void {
    const now = Date.now();
    
    for (const [key, metrics] of this.poolMetricsCache.entries()) {
      if ((now - metrics.lastUpdated.getTime()) > this.cacheExpiry) {
        this.poolMetricsCache.delete(key);
      }
    }

    for (const [key, analysis] of this.analysisCache.entries()) {
      if ((now - analysis.poolInfo.poolAddress.length) > this.cacheExpiry) {
        this.analysisCache.delete(key);
      }
    }
  }
}