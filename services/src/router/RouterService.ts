/**
 * Main Router Service
 * Integrates shard discovery, smallest-shard selection, and trade routing
 */

import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import {
  RouterServiceConfig,
  ShardRoutingRequest,
  ShardRoutingResult,
  TradeExecutionRequest,
  TradeExecutionResult,
  ShardInfo,
  TokenPair,
  RouterServiceStats,
  RouterServiceError,
  RouterServiceEvents
} from './types';
import { ShardDiscoveryService } from './ShardDiscoveryService';
import { SmallestShardSelector } from './SmallestShardSelector';
import { TradeRoutingService } from './TradeRoutingService';

/**
 * Main Router Service that coordinates all routing operations
 */
export class RouterService extends EventEmitter {
  private config: RouterServiceConfig;
  private shardDiscovery: ShardDiscoveryService;
  private shardSelector: SmallestShardSelector;
  private tradeRouting: TradeRoutingService;
  private provider: ethers.Provider;
  private signer?: ethers.Signer;
  
  // Service state
  private isRunning = false;
  private stats: RouterServiceStats = {
    totalRequests: 0,
    successfulRoutings: 0,
    failedRoutings: 0,
    successRate: 0,
    avgRoutingTime: 0,
    totalTradesExecuted: 0,
    totalVolumeRouted: 0n,
    cacheHitRate: 0,
    lastReset: Date.now()
  };
  
  // Cache for routing results
  private routingCache = new Map<string, { result: ShardRoutingResult; timestamp: number }>();

  constructor(config: RouterServiceConfig, provider: ethers.Provider, signer?: ethers.Signer) {
    super();
    this.config = config;
    this.provider = provider;
    this.signer = signer;
    
    // Initialize services
    this.shardDiscovery = new ShardDiscoveryService(config.chainConfig);
    this.shardSelector = new SmallestShardSelector();
    this.tradeRouting = new TradeRoutingService(provider, signer);
    
    // Setup event forwarding
    this.setupEventForwarding();
  }

  /**
   * Start the router service
   */
  async start(): Promise<void> {
    try {
      console.log(`Starting Router Service for chain ${this.config.chainConfig.chainId}`);
      
      // Start shard discovery service
      await this.shardDiscovery.start();
      
      // Setup periodic cache cleanup
      if (this.config.enableCaching) {
        this.startCacheCleanup();
      }
      
      this.isRunning = true;
      console.log('Router Service started successfully');
      
      this.emit('service-started', { chainId: this.config.chainConfig.chainId });
    } catch (error) {
      console.error('Failed to start Router Service:', error);
      this.emit('error', { error: RouterServiceError.CHAIN_CONNECTION_ERROR, context: error });
      throw error;
    }
  }

  /**
   * Stop the router service
   */
  stop(): void {
    if (!this.isRunning) return;
    
    this.shardDiscovery.stop();
    this.routingCache.clear();
    this.isRunning = false;
    
    console.log('Router Service stopped');
    this.emit('service-stopped', { chainId: this.config.chainConfig.chainId });
  }

  /**
   * Find optimal shard for single-pool trade
   */
  async findOptimalShard(request: ShardRoutingRequest): Promise<ShardRoutingResult> {
    const startTime = Date.now();
    this.stats.totalRequests++;
    
    try {
      // Check cache first
      if (this.config.enableCaching) {
        const cached = this.getCachedResult(request);
        if (cached) {
          this.stats.cacheHitRate = this.calculateCacheHitRate();
          return cached;
        }
      }
      
      // Get available shards for the token pair
      const availableShards = await this.shardDiscovery.getAvailableShards(request.tokenPair);
      
      if (availableShards.length === 0) {
        const result: ShardRoutingResult = {
          routing: null,
          availableShards: [],
          metadata: {
            searchTime: Date.now() - startTime,
            shardsEvaluated: 0,
            chainId: request.chainId,
            cThresholdValidated: false
          },
          error: RouterServiceError.NO_SHARDS_AVAILABLE
        };
        
        this.stats.failedRoutings++;
        this.updateSuccessRate();
        this.emit('routing-completed', { request, result });
        
        return result;
      }
      
      // Use trade routing service to find optimal shard
      const result = await this.tradeRouting.findOptimalShard(request, availableShards);
      
      // Update statistics
      if (result.routing) {
        this.stats.successfulRoutings++;
      } else {
        this.stats.failedRoutings++;
      }
      
      this.updateSuccessRate();
      this.updateAvgRoutingTime(Date.now() - startTime);
      
      // Cache the result
      if (this.config.enableCaching && result.routing) {
        this.cacheResult(request, result);
      }
      
      this.emit('routing-completed', { request, result });
      
      return result;
      
    } catch (error) {
      this.stats.failedRoutings++;
      this.updateSuccessRate();
      
      console.error('Failed to find optimal shard:', error);
      this.emit('error', { error: RouterServiceError.SHARD_DISCOVERY_FAILED, context: error });
      
      return {
        routing: null,
        availableShards: [],
        metadata: {
          searchTime: Date.now() - startTime,
          shardsEvaluated: 0,
          chainId: request.chainId,
          cThresholdValidated: false
        },
        error: error instanceof Error ? error.message : RouterServiceError.SHARD_DISCOVERY_FAILED
      };
    }
  }

  /**
   * Execute a routed trade
   */
  async executeTrade(request: TradeExecutionRequest): Promise<TradeExecutionResult> {
    try {
      if (!this.signer) {
        throw new Error('Signer required for trade execution');
      }
      
      const result = await this.tradeRouting.executeTrade(request);
      
      // Update statistics
      this.stats.totalTradesExecuted++;
      if (result.success) {
        this.stats.totalVolumeRouted += result.actualAmountOut;
      }
      
      this.emit('trade-executed', { request, result });
      
      return result;
      
    } catch (error) {
      console.error('Failed to execute trade:', error);
      this.emit('error', { error: RouterServiceError.TRADE_EXECUTION_FAILED, context: error });
      
      return {
        transactionHash: '',
        actualAmountIn: 0n,
        actualAmountOut: 0n,
        actualFee: 0n,
        gasUsed: 0n,
        success: false,
        error: error instanceof Error ? error.message : RouterServiceError.TRADE_EXECUTION_FAILED,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Get all available shards for a token pair
   */
  async getAvailableShards(tokenPair: TokenPair): Promise<ShardInfo[]> {
    try {
      return await this.shardDiscovery.getAvailableShards(tokenPair);
    } catch (error) {
      console.error('Failed to get available shards:', error);
      this.emit('error', { error: RouterServiceError.SHARD_DISCOVERY_FAILED, context: error });
      return [];
    }
  }

  /**
   * Get specific shard information
   */
  async getShardInfo(poolAddress: string): Promise<ShardInfo | null> {
    try {
      return await this.shardDiscovery.getShardInfo(poolAddress);
    } catch (error) {
      console.error('Failed to get shard info:', error);
      return null;
    }
  }

  /**
   * Force refresh of all shard data
   */
  async refreshShards(): Promise<void> {
    try {
      await this.shardDiscovery.refreshAllShards();
      this.routingCache.clear(); // Clear cache after refresh
    } catch (error) {
      console.error('Failed to refresh shards:', error);
      this.emit('error', { error: RouterServiceError.SHARD_DISCOVERY_FAILED, context: error });
    }
  }

  /**
   * Get router service statistics
   */
  getStats(): RouterServiceStats {
    return { ...this.stats };
  }

  /**
   * Get shard discovery metrics
   */
  getShardMetrics() {
    return this.shardDiscovery.getMetrics();
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      successfulRoutings: 0,
      failedRoutings: 0,
      successRate: 0,
      avgRoutingTime: 0,
      totalTradesExecuted: 0,
      totalVolumeRouted: 0n,
      cacheHitRate: 0,
      lastReset: Date.now()
    };
  }

  /**
   * Update router configuration
   */
  updateConfig(updates: Partial<RouterServiceConfig>): void {
    this.config = { ...this.config, ...updates };
    console.log('Router configuration updated');
  }

  // Private methods

  /**
   * Setup event forwarding from sub-services
   */
  private setupEventForwarding(): void {
    // Forward shard discovery events
    this.shardDiscovery.on('shard-discovered', (data) => {
      this.emit('shard-discovered', data);
    });
    
    this.shardDiscovery.on('shard-updated', (data) => {
      this.emit('shard-updated', data);
    });
    
    this.shardDiscovery.on('metrics-updated', (data) => {
      this.emit('metrics-updated', data);
    });
    
    this.shardDiscovery.on('error', (data) => {
      this.emit('error', data);
    });
  }

  /**
   * Generate cache key for routing request
   */
  private getCacheKey(request: ShardRoutingRequest): string {
    return `${request.tokenPair.tokenA.address}-${request.tokenPair.tokenB.address}-${request.outputAmount}-${request.chainId}`;
  }

  /**
   * Get cached routing result
   */
  private getCachedResult(request: ShardRoutingRequest): ShardRoutingResult | null {
    const key = this.getCacheKey(request);
    const cached = this.routingCache.get(key);
    
    if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
      return cached.result;
    }
    
    // Remove stale cache entry
    if (cached) {
      this.routingCache.delete(key);
    }
    
    return null;
  }

  /**
   * Cache routing result
   */
  private cacheResult(request: ShardRoutingRequest, result: ShardRoutingResult): void {
    const key = this.getCacheKey(request);
    this.routingCache.set(key, {
      result,
      timestamp: Date.now()
    });
  }

  /**
   * Start periodic cache cleanup
   */
  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, cached] of this.routingCache.entries()) {
        if (now - cached.timestamp > this.config.cacheTTL) {
          this.routingCache.delete(key);
        }
      }
    }, this.config.cacheTTL / 2); // Clean up every half TTL period
  }

  /**
   * Update success rate statistic
   */
  private updateSuccessRate(): void {
    const total = this.stats.successfulRoutings + this.stats.failedRoutings;
    this.stats.successRate = total > 0 ? (this.stats.successfulRoutings / total) * 100 : 0;
  }

  /**
   * Update average routing time
   */
  private updateAvgRoutingTime(routingTime: number): void {
    const total = this.stats.successfulRoutings + this.stats.failedRoutings;
    if (total === 1) {
      this.stats.avgRoutingTime = routingTime;
    } else {
      this.stats.avgRoutingTime = (this.stats.avgRoutingTime * (total - 1) + routingTime) / total;
    }
  }

  /**
   * Calculate cache hit rate
   */
  private calculateCacheHitRate(): number {
    // This is a simplified calculation - in production you'd want more sophisticated metrics
    return Math.min(100, (this.routingCache.size / Math.max(1, this.stats.totalRequests)) * 100);
  }
}