/**
 * Router Service SDK
 * TypeScript SDK for easy integration with frontend applications
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import {
  ShardRoutingRequest,
  ShardRoutingResult,
  TradeExecutionRequest,
  TradeExecutionResult,
  ShardInfo,
  TokenPair,
  RouterServiceStats,
  ShardMonitoringMetrics,
  RouterServiceError
} from './types';

export interface RouterSDKConfig {
  baseURL: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  apiKey?: string;
}

export interface RouterSDKResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * SDK for interacting with the Router Service API
 */
export class RouterSDK {
  private client: AxiosInstance;
  private config: RouterSDKConfig;

  constructor(config: RouterSDKConfig) {
    this.config = {
      timeout: 30000,
      retries: 3,
      retryDelay: 1000,
      ...config
    };

    this.client = axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
      }
    });

    this.setupInterceptors();
  }

  /**
   * Setup axios interceptors for retry logic and error handling
   */
  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        console.log(`Router SDK: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor with retry logic
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config;
        
        if (!config || !config.retry) {
          config.retry = 0;
        }

        if (config.retry < (this.config.retries || 3) && this.shouldRetry(error)) {
          config.retry++;
          console.log(`Router SDK: Retrying request (${config.retry}/${this.config.retries})`);
          
          await this.delay(this.config.retryDelay! * config.retry);
          return this.client(config);
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Check if request should be retried
   */
  private shouldRetry(error: any): boolean {
    return (
      error.code === 'ECONNABORTED' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNRESET' ||
      (error.response && error.response.status >= 500)
    );
  }

  /**
   * Delay helper for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Make API request with error handling
   */
  private async makeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<RouterSDKResponse<T>> {
    try {
      const response = await this.client.request({
        method,
        url: endpoint,
        data,
        ...config
      });

      return {
        success: true,
        data: response.data.data || response.data
      };
    } catch (error: any) {
      console.error(`Router SDK Error: ${method} ${endpoint}`, error);
      
      if (error.response) {
        return {
          success: false,
          error: error.response.data.error || 'API_ERROR',
          message: error.response.data.message || error.message
        };
      } else if (error.request) {
        return {
          success: false,
          error: 'NETWORK_ERROR',
          message: 'Network error - please check your connection'
        };
      } else {
        return {
          success: false,
          error: 'UNKNOWN_ERROR',
          message: error.message
        };
      }
    }
  }

  // Public API methods

  /**
   * Check service health
   */
  async healthCheck(): Promise<RouterSDKResponse<any>> {
    return this.makeRequest('GET', '/health');
  }

  /**
   * Get all available shards
   */
  async getAllShards(): Promise<RouterSDKResponse<any>> {
    return this.makeRequest('GET', '/api/v1/shards');
  }

  /**
   * Get specific shard information
   */
  async getShardInfo(poolAddress: string): Promise<RouterSDKResponse<ShardInfo>> {
    return this.makeRequest('GET', `/api/v1/shards/${poolAddress}`);
  }

  /**
   * Refresh all shard data
   */
  async refreshShards(): Promise<RouterSDKResponse<any>> {
    return this.makeRequest('POST', '/api/v1/shards/refresh');
  }

  /**
   * Get available shards for a token pair
   */
  async getAvailableShards(tokenPair: TokenPair): Promise<RouterSDKResponse<{ shards: ShardInfo[]; count: number }>> {
    return this.makeRequest('POST', '/api/v1/shards/available', tokenPair);
  }

  /**
   * Find optimal shard for a trade
   */
  async findOptimalShard(request: ShardRoutingRequest): Promise<RouterSDKResponse<ShardRoutingResult>> {
    return this.makeRequest('POST', '/api/v1/routing/find-optimal', {
      ...request,
      outputAmount: request.outputAmount.toString(),
      maxInputAmount: request.maxInputAmount?.toString()
    });
  }

  /**
   * Get quote for a trade (dry run)
   */
  async quoteRoute(request: ShardRoutingRequest): Promise<RouterSDKResponse<any>> {
    return this.makeRequest('POST', '/api/v1/routing/quote', {
      ...request,
      outputAmount: request.outputAmount.toString(),
      maxInputAmount: request.maxInputAmount?.toString()
    });
  }

  /**
   * Validate c-threshold for a trade
   */
  async validateCThreshold(
    poolAddress: string,
    outputAmount: bigint,
    inputToken: string
  ): Promise<RouterSDKResponse<any>> {
    return this.makeRequest('POST', '/api/v1/routing/validate-threshold', {
      poolAddress,
      outputAmount: outputAmount.toString(),
      inputToken
    });
  }

  /**
   * Execute a trade
   */
  async executeTrade(request: TradeExecutionRequest): Promise<RouterSDKResponse<TradeExecutionResult>> {
    return this.makeRequest('POST', '/api/v1/trades/execute', {
      ...request,
      routing: {
        ...request.routing,
        expectedAmountIn: request.routing.expectedAmountIn.toString(),
        estimatedFee: request.routing.estimatedFee.toString(),
        estimatedGas: request.routing.estimatedGas.toString()
      },
      maxAmountIn: request.maxAmountIn.toString()
    });
  }

  /**
   * Get router service statistics
   */
  async getStats(): Promise<RouterSDKResponse<RouterServiceStats>> {
    return this.makeRequest('GET', '/api/v1/stats');
  }

  /**
   * Get shard monitoring metrics
   */
  async getMetrics(): Promise<RouterSDKResponse<ShardMonitoringMetrics>> {
    return this.makeRequest('GET', '/api/v1/metrics');
  }

  /**
   * Reset statistics
   */
  async resetStats(): Promise<RouterSDKResponse<any>> {
    return this.makeRequest('POST', '/api/v1/stats/reset');
  }

  /**
   * Update router configuration
   */
  async updateConfig(updates: any): Promise<RouterSDKResponse<any>> {
    return this.makeRequest('POST', '/api/v1/config', updates);
  }

  // Convenience methods

  /**
   * Find and execute optimal trade in one call
   */
  async findAndExecuteTrade(
    tokenPair: TokenPair,
    outputAmount: bigint,
    userAddress: string,
    maxInputAmount?: bigint,
    slippageTolerance?: number
  ): Promise<RouterSDKResponse<TradeExecutionResult>> {
    try {
      // First, find optimal shard
      const routingRequest: ShardRoutingRequest = {
        tokenPair,
        outputAmount,
        maxInputAmount,
        chainId: tokenPair.chainId,
        slippageTolerance,
        userAddress
      };

      const routingResult = await this.findOptimalShard(routingRequest);
      
      if (!routingResult.success || !routingResult.data?.routing) {
        return {
          success: false,
          error: routingResult.error || RouterServiceError.NO_SHARDS_AVAILABLE,
          message: routingResult.message || 'No optimal shard found'
        };
      }

      // Then execute the trade
      const tradeRequest: TradeExecutionRequest = {
        routing: routingResult.data.routing,
        maxAmountIn: maxInputAmount || routingResult.data.routing.expectedAmountIn,
        userAddress,
        recipient: userAddress
      };

      return await this.executeTrade(tradeRequest);
    } catch (error: any) {
      return {
        success: false,
        error: 'EXECUTION_ERROR',
        message: error.message
      };
    }
  }

  /**
   * Get comprehensive router status
   */
  async getRouterStatus(): Promise<RouterSDKResponse<{
    health: any;
    stats: RouterServiceStats;
    metrics: ShardMonitoringMetrics;
  }>> {
    try {
      const [healthResult, statsResult, metricsResult] = await Promise.all([
        this.healthCheck(),
        this.getStats(),
        this.getMetrics()
      ]);

      if (!healthResult.success || !statsResult.success || !metricsResult.success) {
        return {
          success: false,
          error: 'STATUS_CHECK_FAILED',
          message: 'Failed to retrieve complete router status'
        };
      }

      return {
        success: true,
        data: {
          health: healthResult.data,
          stats: statsResult.data!,
          metrics: metricsResult.data!
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: 'STATUS_ERROR',
        message: error.message
      };
    }
  }

  /**
   * Monitor router performance
   */
  async monitorPerformance(intervalMs: number = 30000): Promise<void> {
    console.log('Starting router performance monitoring...');
    
    setInterval(async () => {
      try {
        const status = await this.getRouterStatus();
        
        if (status.success && status.data) {
          const { stats, metrics } = status.data;
          
          console.log('Router Performance:', {
            successRate: `${stats.successRate.toFixed(2)}%`,
            avgRoutingTime: `${stats.avgRoutingTime.toFixed(2)}ms`,
            activeShards: metrics.totalActiveShards,
            healthStatus: metrics.healthStatus,
            totalRequests: stats.totalRequests
          });
        } else {
          console.warn('Failed to get router status:', status.error);
        }
      } catch (error) {
        console.error('Performance monitoring error:', error);
      }
    }, intervalMs);
  }
}