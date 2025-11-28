/**
 * Router Service - Main Export
 * Single-pool routing service with smallest-shard selection strategy
 */

// Core services
export { RouterService } from './RouterService';
export { RouterAPI, type RouterAPIConfig } from './RouterAPI';
export { RouterSDK, type RouterSDKConfig, type RouterSDKResponse } from './RouterSDK';

// Component services
export { ShardDiscoveryService } from './ShardDiscoveryService';
export { SmallestShardSelector } from './SmallestShardSelector';
export { TradeRoutingService } from './TradeRoutingService';

// Types and interfaces
export * from './types';

// Utility functions and constants
export const ROUTER_SERVICE_VERSION = '1.0.0';

export const DEFAULT_ROUTER_CONFIG = {
  defaultSlippage: 1.0,
  maxGasPrice: '50000000000', // 50 gwei
  gasLimit: 300000,
  enableCaching: true,
  cacheTTL: 30000, // 30 seconds
  retryConfig: {
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2
  },
  monitoring: {
    enableMetrics: true,
    metricsInterval: 10000,
    alertThresholds: {
      errorRate: 10, // 10%
      responseTime: 5000, // 5 seconds
      failedShards: 5
    }
  }
};

export const DEFAULT_API_CONFIG = {
  port: 3001,
  corsOrigins: ['*'],
  rateLimitWindowMs: 15 * 60 * 1000, // 15 minutes
  rateLimitMaxRequests: 100,
  enableLogging: true,
  apiPrefix: '/api/v1'
};

/**
 * Create a complete router service instance with API
 */
export async function createRouterService(
  chainConfig: any,
  provider: any,
  signer?: any,
  apiConfig?: Partial<any>
) {
  const routerConfig = {
    chainConfig,
    ...DEFAULT_ROUTER_CONFIG
  };

  const router = new RouterService(routerConfig, provider, signer);
  
  const finalApiConfig = {
    ...DEFAULT_API_CONFIG,
    ...apiConfig
  };

  const api = new RouterAPI(finalApiConfig, router);

  return {
    router,
    api,
    async start() {
      await router.start();
      await api.start();
      console.log('Router Service and API started successfully');
    },
    stop() {
      router.stop();
      console.log('Router Service stopped');
    }
  };
}

/**
 * Create SDK instance for client applications
 */
export function createRouterSDK(config: RouterSDKConfig) {
  return new RouterSDK(config);
}