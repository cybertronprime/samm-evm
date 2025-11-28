import { ethers } from 'ethers';
import { ChainHealth, ChainServiceInstances, HealthMonitorConfig, ChainMetrics } from './types';

/**
 * Health Monitor for Multi-Chain Services
 * 
 * Monitors the health of each chain independently.
 * Failures on one chain do not affect monitoring of other chains.
 */
export class HealthMonitor {
  private healthData: Map<number, ChainHealth> = new Map();
  private monitoringIntervals: Map<number, NodeJS.Timeout> = new Map();
  private metrics: Map<number, ChainMetrics> = new Map();
  private config: HealthMonitorConfig;

  constructor(config?: Partial<HealthMonitorConfig>) {
    this.config = {
      checkInterval: 30000, // 30 seconds
      timeoutThreshold: 10000, // 10 seconds
      errorThreshold: 3, // 3 consecutive errors
      blockHeightStaleThreshold: 300, // 5 minutes
      ...config
    };
  }

  /**
   * Start monitoring a specific chain
   */
  startMonitoring(
    chainId: number, 
    provider: ethers.JsonRpcProvider, 
    services: ChainServiceInstances
  ): void {
    // Stop existing monitoring if any
    this.stopMonitoring(chainId);

    // Initialize health data
    this.healthData.set(chainId, {
      chainId,
      isHealthy: true,
      blockHeight: 0,
      lastBlockTime: 0,
      rpcLatency: 0,
      activeShards: 0,
      errors: [],
      lastChecked: new Date()
    });

    // Initialize metrics
    this.metrics.set(chainId, {
      chainId,
      blockHeight: 0,
      blockTime: 0,
      rpcLatency: 0,
      activeConnections: 1,
      requestsPerMinute: 0,
      errorRate: 0,
      uptime: 100
    });

    // Start periodic health checks
    const interval = setInterval(async () => {
      try {
        await this.performHealthCheck(chainId, provider, services);
      } catch (error) {
        console.error(`Health check failed for chain ${chainId}:`, error);
        this.recordError(chainId, error.message);
      }
    }, this.config.checkInterval);

    this.monitoringIntervals.set(chainId, interval);
    
    console.log(`Started health monitoring for chain ${chainId}`);
  }

  /**
   * Stop monitoring a specific chain
   */
  stopMonitoring(chainId: number): void {
    const interval = this.monitoringIntervals.get(chainId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(chainId);
    }

    // Keep health data for reference but stop active monitoring
    console.log(`Stopped health monitoring for chain ${chainId}`);
  }

  /**
   * Get current health status for a chain
   */
  async getChainHealth(chainId: number): Promise<ChainHealth> {
    const health = this.healthData.get(chainId);
    if (!health) {
      throw new Error(`No health data available for chain ${chainId}`);
    }

    // Return a copy to prevent external modification
    return { ...health };
  }

  /**
   * Get metrics for a chain
   */
  getChainMetrics(chainId: number): ChainMetrics | null {
    const metrics = this.metrics.get(chainId);
    return metrics ? { ...metrics } : null;
  }

  /**
   * Get health status for all monitored chains
   */
  getAllChainHealth(): Map<number, ChainHealth> {
    const allHealth = new Map<number, ChainHealth>();
    
    for (const [chainId, health] of this.healthData) {
      allHealth.set(chainId, { ...health });
    }
    
    return allHealth;
  }

  /**
   * Check if a specific chain is healthy
   */
  isChainHealthy(chainId: number): boolean {
    const health = this.healthData.get(chainId);
    return health ? health.isHealthy : false;
  }

  /**
   * Get list of unhealthy chains
   */
  getUnhealthyChains(): number[] {
    const unhealthy: number[] = [];
    
    for (const [chainId, health] of this.healthData) {
      if (!health.isHealthy) {
        unhealthy.push(chainId);
      }
    }
    
    return unhealthy;
  }

  /**
   * Perform comprehensive health check for a chain
   */
  private async performHealthCheck(
    chainId: number,
    provider: ethers.JsonRpcProvider,
    services: ChainServiceInstances
  ): Promise<void> {
    const startTime = Date.now();
    const health = this.healthData.get(chainId)!;
    const metrics = this.metrics.get(chainId)!;

    try {
      // Test RPC connectivity and get basic chain info
      const [blockNumber, network] = await Promise.all([
        provider.getBlockNumber(),
        provider.getNetwork()
      ]);

      const rpcLatency = Date.now() - startTime;

      // Verify chain ID matches
      if (Number(network.chainId) !== chainId) {
        throw new Error(`Chain ID mismatch: expected ${chainId}, got ${network.chainId}`);
      }

      // Check if block height is progressing
      const blockHeightStale = health.blockHeight > 0 && 
        blockNumber <= health.blockHeight &&
        (Date.now() - health.lastBlockTime) > this.config.blockHeightStaleThreshold * 1000;

      if (blockHeightStale) {
        throw new Error('Block height appears stale - chain may be stuck');
      }

      // Test service health
      const serviceHealthChecks = await Promise.allSettled([
        this.checkRouterServiceHealth(services.routerService),
        this.checkCrossPoolRouterHealth(services.crossPoolRouter),
        this.checkLiquidityRouterHealth(services.liquidityRouter)
      ]);

      const serviceErrors = serviceHealthChecks
        .filter(result => result.status === 'rejected')
        .map(result => (result as PromiseRejectedResult).reason.message);

      // Count active shards (simplified - would need actual shard discovery)
      const activeShards = await this.countActiveShards(services);

      // Update health data
      health.isHealthy = serviceErrors.length === 0;
      health.blockHeight = blockNumber;
      health.lastBlockTime = Date.now();
      health.rpcLatency = rpcLatency;
      health.activeShards = activeShards;
      health.errors = serviceErrors;
      health.lastChecked = new Date();

      // Update metrics
      metrics.blockHeight = blockNumber;
      metrics.rpcLatency = rpcLatency;
      metrics.activeConnections = 1; // Simplified
      metrics.errorRate = serviceErrors.length > 0 ? 100 : 0;
      metrics.uptime = health.isHealthy ? 100 : 0;

      // Clear error count on successful check
      if (health.isHealthy) {
        this.clearErrorCount(chainId);
      }

    } catch (error) {
      this.recordError(chainId, error.message);
      
      // Update health as unhealthy
      health.isHealthy = false;
      health.errors = [error.message];
      health.lastChecked = new Date();
      
      // Update metrics
      metrics.errorRate = 100;
      metrics.uptime = 0;
    }
  }

  /**
   * Check router service health
   */
  private async checkRouterServiceHealth(routerService: RouterService): Promise<void> {
    // This would call a health check method on the router service
    // For now, we'll assume it exists or implement a basic check
    if (typeof routerService.healthCheck === 'function') {
      await routerService.healthCheck();
    }
  }

  /**
   * Check cross-pool router health
   */
  private async checkCrossPoolRouterHealth(crossPoolRouter: CrossPoolRouterService): Promise<void> {
    if (typeof crossPoolRouter.healthCheck === 'function') {
      await crossPoolRouter.healthCheck();
    }
  }

  /**
   * Check liquidity router health
   */
  private async checkLiquidityRouterHealth(liquidityRouter: LiquidityRouterService): Promise<void> {
    if (typeof liquidityRouter.healthCheck === 'function') {
      await liquidityRouter.healthCheck();
    }
  }

  /**
   * Count active shards for a chain
   */
  private async countActiveShards(services: ChainServiceInstances): Promise<number> {
    try {
      // This would use the router service to discover active shards
      // For now, return a placeholder value
      return 0;
    } catch (error) {
      console.error('Failed to count active shards:', error);
      return 0;
    }
  }

  /**
   * Record an error for a chain
   */
  private recordError(chainId: number, errorMessage: string): void {
    const health = this.healthData.get(chainId);
    if (!health) return;

    // Add error to list (keep last 10 errors)
    health.errors.unshift(errorMessage);
    if (health.errors.length > 10) {
      health.errors = health.errors.slice(0, 10);
    }

    // Mark as unhealthy if too many consecutive errors
    const errorCount = this.getErrorCount(chainId) + 1;
    this.setErrorCount(chainId, errorCount);

    if (errorCount >= this.config.errorThreshold) {
      health.isHealthy = false;
      console.warn(`Chain ${chainId} marked as unhealthy after ${errorCount} consecutive errors`);
    }
  }

  /**
   * Clear error count for a chain
   */
  private clearErrorCount(chainId: number): void {
    this.setErrorCount(chainId, 0);
  }

  /**
   * Get error count for a chain
   */
  private getErrorCount(chainId: number): number {
    return (this as any)[`errorCount_${chainId}`] || 0;
  }

  /**
   * Set error count for a chain
   */
  private setErrorCount(chainId: number, count: number): void {
    (this as any)[`errorCount_${chainId}`] = count;
  }

  /**
   * Stop all monitoring
   */
  stopAllMonitoring(): void {
    for (const chainId of this.monitoringIntervals.keys()) {
      this.stopMonitoring(chainId);
    }
    console.log('Stopped all health monitoring');
  }
}