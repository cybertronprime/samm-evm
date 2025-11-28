import { ethers } from 'ethers';
import { RouterService } from '../router/RouterService';
import { CrossPoolRouterService } from '../cross-pool-router/CrossPoolRouterService';
import { LiquidityRouterService } from '../liquidity-router/LiquidityRouterService';

/**
 * Chain configuration interface
 */
export interface ChainConfig {
  chainId: number;
  name: string;
  rpcEndpoint: string;
  blockTime: number;
  gasPrice: bigint;
  contractAddresses: {
    sammPoolFactory: string;
    router: string;
    liquidityRouter: string;
  };
  nativeToken: {
    symbol: string;
    decimals: number;
  };
  gasSettings?: {
    gasPrice?: string;
    gasLimit?: number;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
  deploymentConfig?: {
    minBalance?: string;
    confirmations?: number;
    timeout?: number;
  };
  sammParameters?: {
    beta1: number;
    rmin: number;
    rmax: number;
    c: number;
  };
}

/**
 * Chain health status
 */
export interface ChainHealth {
  chainId: number;
  isHealthy: boolean;
  blockHeight: number;
  lastBlockTime: number;
  rpcLatency: number;
  activeShards: number;
  errors: string[];
  lastChecked: Date;
}

/**
 * Chain service instances (completely isolated per chain)
 */
export interface ChainServiceInstances {
  routerService: RouterService;
  crossPoolRouter: CrossPoolRouterService;
  liquidityRouter: LiquidityRouterService;
  provider: ethers.JsonRpcProvider;
  config: ChainConfig;
}

/**
 * API request context with chain information
 */
export interface ChainRequestContext {
  chainId: number;
  chainName: string;
  requestId: string;
  timestamp: Date;
}

/**
 * Multi-chain API response wrapper
 */
export interface ChainResponse<T> {
  success: boolean;
  chainId: number;
  data?: T;
  error?: string;
  timestamp: Date;
  requestId?: string;
}

/**
 * Health monitoring configuration
 */
export interface HealthMonitorConfig {
  checkInterval: number; // milliseconds
  timeoutThreshold: number; // milliseconds
  errorThreshold: number; // number of consecutive errors before marking unhealthy
  blockHeightStaleThreshold: number; // seconds
}

/**
 * Chain metrics for monitoring
 */
export interface ChainMetrics {
  chainId: number;
  blockHeight: number;
  blockTime: number;
  rpcLatency: number;
  activeConnections: number;
  requestsPerMinute: number;
  errorRate: number;
  lastError?: string;
  uptime: number; // percentage
}

/**
 * Service initialization options
 */
export interface ServiceInitOptions {
  enableHealthCheck: boolean;
  healthCheckInterval: number;
  maxRetries: number;
  retryDelay: number;
  enableMetrics: boolean;
}

/**
 * Chain-specific error types
 */
export enum ChainErrorType {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  RPC_ERROR = 'RPC_ERROR',
  CONTRACT_ERROR = 'CONTRACT_ERROR',
  TIMEOUT = 'TIMEOUT',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  CHAIN_NOT_SUPPORTED = 'CHAIN_NOT_SUPPORTED',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR'
}

/**
 * Chain error with context
 */
export interface ChainError extends Error {
  type: ChainErrorType;
  chainId: number;
  context?: any;
  timestamp: Date;
}

/**
 * Rate limiting configuration per chain
 */
export interface ChainRateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests: boolean;
  skipFailedRequests: boolean;
  keyGenerator?: (chainId: number, req: any) => string;
}

/**
 * Authentication configuration per chain
 */
export interface ChainAuthConfig {
  enabled: boolean;
  apiKeyRequired: boolean;
  allowedOrigins: string[];
  rateLimiting: ChainRateLimitConfig;
}