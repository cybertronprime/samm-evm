/**
 * Shard Discovery and Monitoring Service for EVM
 * Implements real-time monitoring of SAMM pool states across EVM chains
 */

import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import {
  ShardInfo,
  TokenPair,
  Token,
  ShardDiscoveryConfig,
  ShardMonitoringMetrics,
  RouterServiceError,
  RouterServiceEvents
} from './types';

// ABI for SAMM Pool contract - minimal interface for discovery
const SAMM_POOL_ABI = [
  'function getReserves() external view returns (uint256 reserveA, uint256 reserveB)',
  'function totalSupply() external view returns (uint256)',
  'function tokenA() external view returns (address)',
  'function tokenB() external view returns (address)',
  'function getSAMMParams() external view returns (int256 beta1, uint256 rmin, uint256 rmax, uint256 c)',
  'function tradeFeeNumerator() external view returns (uint256)',
  'function tradeFeeDenominator() external view returns (uint256)',
  'function ownerFeeNumerator() external view returns (uint256)',
  'function ownerFeeDenominator() external view returns (uint256)',
  'function getPoolState() external view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))'
];

// ABI for Pool Factory contract
const POOL_FACTORY_ABI = [
  'function getAllPools() external view returns (address[])',
  'function getPoolsForTokenPair(address tokenA, address tokenB) external view returns (address[])',
  'event PoolCreated(address indexed tokenA, address indexed tokenB, address pool, uint256 poolCount)'
];

// ABI for ERC20 tokens
const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)'
];

/**
 * Service for discovering and monitoring SAMM shards on EVM chains
 */
export class ShardDiscoveryService extends EventEmitter {
  private provider: ethers.Provider;
  private config: ShardDiscoveryConfig;
  private poolFactory: ethers.Contract;
  
  // Cache for discovered shards
  private shardCache = new Map<string, ShardInfo>();
  private tokenCache = new Map<string, Token>();
  
  // Monitoring state
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;
  private lastUpdateTime = 0;
  
  // Metrics
  private metrics: ShardMonitoringMetrics = {
    totalActiveShards: 0,
    totalLiquidity: 0n,
    averageShardSize: 0n,
    tokenPairCount: 0,
    lastUpdated: 0,
    healthStatus: 'healthy',
    errorCount: 0,
    avgResponseTime: 0
  };

  constructor(config: ShardDiscoveryConfig) {
    super();
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcEndpoint);
    this.poolFactory = new ethers.Contract(
      config.poolFactoryAddress,
      POOL_FACTORY_ABI,
      this.provider
    );
  }

  /**
   * Start the shard discovery and monitoring service
   */
  async start(): Promise<void> {
    try {
      console.log(`Starting shard discovery service for chain ${this.config.chainId}`);
      
      // Initial discovery
      await this.discoverAllShards();
      
      // Start real-time monitoring if enabled
      if (this.config.enableRealTimeMonitoring) {
        this.startMonitoring();
      }
      
      console.log(`Shard discovery service started. Found ${this.shardCache.size} shards`);
    } catch (error) {
      console.error('Failed to start shard discovery service:', error);
      this.emit('error', { error: RouterServiceError.SHARD_DISCOVERY_FAILED, context: error });
      throw error;
    }
  }

  /**
   * Stop the monitoring service
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.isMonitoring = false;
    console.log('Shard discovery service stopped');
  }

  /**
   * Discover all available SAMM pools on the chain
   */
  async discoverAllShards(): Promise<ShardInfo[]> {
    const startTime = Date.now();
    
    try {
      console.log('Discovering all SAMM pools...');
      
      // Get all pool addresses from factory
      const poolAddresses: string[] = await this.poolFactory.getAllPools();
      console.log(`Found ${poolAddresses.length} pools from factory`);
      
      // Process pools in batches
      const shards: ShardInfo[] = [];
      const batchSize = this.config.batchSize;
      
      for (let i = 0; i < poolAddresses.length; i += batchSize) {
        const batch = poolAddresses.slice(i, i + batchSize);
        const batchShards = await this.processBatch(batch);
        shards.push(...batchShards);
      }
      
      // Update cache
      for (const shard of shards) {
        this.shardCache.set(shard.id, shard);
      }
      
      // Update metrics
      this.updateMetrics();
      
      const discoveryTime = Date.now() - startTime;
      console.log(`Discovery completed in ${discoveryTime}ms. Found ${shards.length} active shards`);
      
      return shards;
    } catch (error) {
      console.error('Failed to discover shards:', error);
      this.metrics.errorCount++;
      this.emit('error', { error: RouterServiceError.SHARD_DISCOVERY_FAILED, context: error });
      throw error;
    }
  }

  /**
   * Get all available shards for a specific token pair
   */
  async getAvailableShards(tokenPair: TokenPair): Promise<ShardInfo[]> {
    try {
      // Check if we have fresh data
      if (this.isCacheStale()) {
        await this.discoverAllShards();
      }
      
      // Filter shards by token pair
      const shards = Array.from(this.shardCache.values()).filter(shard => 
        shard.chainId === tokenPair.chainId &&
        this.isTokenPairMatch(shard, tokenPair) &&
        shard.status === 'active' &&
        shard.reserveA >= this.config.minLiquidityThreshold &&
        shard.reserveB >= this.config.minLiquidityThreshold
      );
      
      // Sort by reserve amount (smallest first for SAMM properties)
      shards.sort((a, b) => {
        const aReserve = a.tokenA.address.toLowerCase() === tokenPair.tokenA.address.toLowerCase() 
          ? a.reserveA : a.reserveB;
        const bReserve = b.tokenA.address.toLowerCase() === tokenPair.tokenA.address.toLowerCase() 
          ? b.reserveA : b.reserveB;
        
        return aReserve < bReserve ? -1 : aReserve > bReserve ? 1 : 0;
      });
      
      return shards;
    } catch (error) {
      console.error('Failed to get available shards:', error);
      this.emit('error', { error: RouterServiceError.SHARD_DISCOVERY_FAILED, context: error });
      return [];
    }
  }

  /**
   * Get specific shard information by pool address
   */
  async getShardInfo(poolAddress: string): Promise<ShardInfo | null> {
    try {
      // Check cache first
      const cachedShard = Array.from(this.shardCache.values())
        .find(shard => shard.poolAddress.toLowerCase() === poolAddress.toLowerCase());
      
      if (cachedShard && !this.isShardDataStale(cachedShard)) {
        return cachedShard;
      }
      
      // Fetch fresh data
      const shard = await this.fetchShardData(poolAddress);
      if (shard) {
        this.shardCache.set(shard.id, shard);
        this.emit('shard-updated', { shard });
      }
      
      return shard;
    } catch (error) {
      console.error(`Failed to get shard info for ${poolAddress}:`, error);
      return null;
    }
  }

  /**
   * Get current monitoring metrics
   */
  getMetrics(): ShardMonitoringMetrics {
    return { ...this.metrics };
  }

  /**
   * Force refresh of all shard data
   */
  async refreshAllShards(): Promise<void> {
    console.log('Force refreshing all shard data...');
    await this.discoverAllShards();
  }

  /**
   * Get all cached shards
   */
  getAllShards(): ShardInfo[] {
    return Array.from(this.shardCache.values());
  }

  // Private methods

  /**
   * Start real-time monitoring
   */
  private startMonitoring(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.updateShardData();
      } catch (error) {
        console.error('Error during monitoring update:', error);
        this.metrics.errorCount++;
      }
    }, this.config.refreshInterval);
    
    console.log(`Started real-time monitoring with ${this.config.refreshInterval}ms interval`);
  }

  /**
   * Update shard data during monitoring
   */
  private async updateShardData(): Promise<void> {
    const staleShards = Array.from(this.shardCache.values())
      .filter(shard => this.isShardDataStale(shard));
    
    if (staleShards.length === 0) return;
    
    console.log(`Updating ${staleShards.length} stale shards`);
    
    // Update in batches
    const batchSize = this.config.batchSize;
    for (let i = 0; i < staleShards.length; i += batchSize) {
      const batch = staleShards.slice(i, i + batchSize);
      await Promise.all(batch.map(async (shard) => {
        try {
          const updated = await this.fetchShardData(shard.poolAddress);
          if (updated) {
            this.shardCache.set(updated.id, updated);
            this.emit('shard-updated', { shard: updated });
          }
        } catch (error) {
          console.error(`Failed to update shard ${shard.id}:`, error);
        }
      }));
    }
    
    this.updateMetrics();
  }

  /**
   * Process a batch of pool addresses
   */
  private async processBatch(poolAddresses: string[]): Promise<ShardInfo[]> {
    const promises = poolAddresses.map(address => this.fetchShardData(address));
    const results = await Promise.allSettled(promises);
    
    const shards: ShardInfo[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        shards.push(result.value);
      } else {
        console.warn(`Failed to fetch data for pool ${poolAddresses[index]}:`, 
          result.status === 'rejected' ? result.reason : 'No data returned');
      }
    });
    
    return shards;
  }

  /**
   * Fetch complete shard data from blockchain
   */
  private async fetchShardData(poolAddress: string): Promise<ShardInfo | null> {
    try {
      const pool = new ethers.Contract(poolAddress, SAMM_POOL_ABI, this.provider);
      
      // Get pool state
      const [reserves, totalSupply, tokenAAddr, tokenBAddr, sammParams, poolState] = await Promise.all([
        pool.getReserves(),
        pool.totalSupply(),
        pool.tokenA(),
        pool.tokenB(),
        pool.getSAMMParams(),
        pool.getPoolState()
      ]);
      
      // Get token information
      const [tokenA, tokenB] = await Promise.all([
        this.getTokenInfo(tokenAAddr),
        this.getTokenInfo(tokenBAddr)
      ]);
      
      if (!tokenA || !tokenB) {
        console.warn(`Failed to get token info for pool ${poolAddress}`);
        return null;
      }
      
      // Check minimum liquidity threshold
      if (reserves.reserveA < this.config.minLiquidityThreshold || 
          reserves.reserveB < this.config.minLiquidityThreshold) {
        return null;
      }
      
      const shardId = `${this.config.chainId}-${poolAddress.toLowerCase()}`;
      const now = Date.now();
      
      const shard: ShardInfo = {
        id: shardId,
        poolAddress: poolAddress.toLowerCase(),
        tokenA,
        tokenB,
        reserveA: BigInt(reserves.reserveA.toString()),
        reserveB: BigInt(reserves.reserveB.toString()),
        totalSupply: BigInt(totalSupply.toString()),
        sammParams: {
          beta1: Number(sammParams.beta1) / 1e6, // Convert from scaled
          rmin: Number(sammParams.rmin) / 1e6,
          rmax: Number(sammParams.rmax) / 1e6,
          c: Number(sammParams.c) / 1e6
        },
        fees: {
          tradeFeeNumerator: Number(poolState.tradeFeeNumerator),
          tradeFeeDenominator: Number(poolState.tradeFeeDenominator),
          ownerFeeNumerator: Number(poolState.ownerFeeNumerator),
          ownerFeeDenominator: Number(poolState.ownerFeeDenominator)
        },
        metrics: {
          volume24h: 0n, // Would need event tracking for accurate volume
          fees24h: 0n,
          transactions24h: 0,
          lastUpdated: now
        },
        status: 'active',
        chainId: this.config.chainId,
        lastSyncTime: now
      };
      
      return shard;
    } catch (error) {
      console.error(`Failed to fetch shard data for ${poolAddress}:`, error);
      return null;
    }
  }

  /**
   * Get token information with caching
   */
  private async getTokenInfo(tokenAddress: string): Promise<Token | null> {
    const cacheKey = `${this.config.chainId}-${tokenAddress.toLowerCase()}`;
    
    // Check cache
    if (this.tokenCache.has(cacheKey)) {
      return this.tokenCache.get(cacheKey)!;
    }
    
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const [symbol, decimals] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals()
      ]);
      
      const token: Token = {
        address: tokenAddress.toLowerCase(),
        symbol,
        decimals: Number(decimals),
        chainId: this.config.chainId
      };
      
      // Cache the token info
      this.tokenCache.set(cacheKey, token);
      
      return token;
    } catch (error) {
      console.error(`Failed to get token info for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Check if token pair matches shard
   */
  private isTokenPairMatch(shard: ShardInfo, tokenPair: TokenPair): boolean {
    const shardTokens = [shard.tokenA.address.toLowerCase(), shard.tokenB.address.toLowerCase()];
    const pairTokens = [tokenPair.tokenA.address.toLowerCase(), tokenPair.tokenB.address.toLowerCase()];
    
    return (shardTokens.includes(pairTokens[0]) && shardTokens.includes(pairTokens[1]));
  }

  /**
   * Check if cache is stale
   */
  private isCacheStale(): boolean {
    return Date.now() - this.lastUpdateTime > this.config.maxCacheAge;
  }

  /**
   * Check if specific shard data is stale
   */
  private isShardDataStale(shard: ShardInfo): boolean {
    return Date.now() - shard.lastSyncTime > this.config.maxCacheAge;
  }

  /**
   * Update monitoring metrics
   */
  private updateMetrics(): void {
    const activeShards = Array.from(this.shardCache.values())
      .filter(shard => shard.status === 'active');
    
    const totalLiquidity = activeShards.reduce((sum, shard) => {
      // Use USD value approximation (would need price oracle for accuracy)
      return sum + shard.reserveA + shard.reserveB;
    }, 0n);
    
    const tokenPairs = new Set(activeShards.map(shard => 
      `${shard.tokenA.address}-${shard.tokenB.address}`
    ));
    
    this.metrics = {
      totalActiveShards: activeShards.length,
      totalLiquidity,
      averageShardSize: activeShards.length > 0 ? totalLiquidity / BigInt(activeShards.length) : 0n,
      tokenPairCount: tokenPairs.size,
      lastUpdated: Date.now(),
      healthStatus: this.metrics.errorCount < 10 ? 'healthy' : 'degraded',
      errorCount: this.metrics.errorCount,
      avgResponseTime: this.metrics.avgResponseTime
    };
    
    this.lastUpdateTime = Date.now();
    this.emit('metrics-updated', { metrics: this.metrics });
  }
}