/**
 * Router Service Types and Interfaces
 * Defines data structures for single-pool routing and shard selection
 */

/**
 * Represents a token in the system
 */
export interface Token {
  /** Token contract address */
  address: string;
  
  /** Token symbol (e.g., "USDC", "ETH") */
  symbol: string;
  
  /** Token decimals */
  decimals: number;
  
  /** Chain ID where token exists */
  chainId: number;
}

/**
 * Represents a token pair for a pool
 */
export interface TokenPair {
  /** First token in the pair */
  tokenA: Token;
  
  /** Second token in the pair */
  tokenB: Token;
  
  /** Chain ID where this pair exists */
  chainId: number;
}

/**
 * Represents detailed information about a SAMM shard
 */
export interface ShardInfo {
  /** Unique shard identifier */
  id: string;
  
  /** Pool contract address */
  poolAddress: string;
  
  /** Token A information */
  tokenA: Token;
  
  /** Token B information */
  tokenB: Token;
  
  /** Current reserve of token A (RA) */
  reserveA: bigint;
  
  /** Current reserve of token B (RB) */
  reserveB: bigint;
  
  /** Total supply of LP tokens */
  totalSupply: bigint;
  
  /** SAMM parameters */
  sammParams: {
    beta1: number;
    rmin: number;
    rmax: number;
    c: number;
  };
  
  /** Fee configuration */
  fees: {
    tradeFeeNumerator: number;
    tradeFeeDenominator: number;
    ownerFeeNumerator: number;
    ownerFeeDenominator: number;
  };
  
  /** Shard metrics */
  metrics: {
    volume24h: bigint;
    fees24h: bigint;
    transactions24h: number;
    lastUpdated: number;
  };
  
  /** Shard status */
  status: 'active' | 'inactive' | 'paused';
  
  /** Chain ID where shard exists */
  chainId: number;
  
  /** Last time this shard data was updated */
  lastSyncTime: number;
}

/**
 * Represents routing decision for a single-pool trade
 */
export interface ShardRouting {
  /** Selected shard ID */
  shardId: string;
  
  /** Pool contract address */
  poolAddress: string;
  
  /** Expected input amount needed */
  expectedAmountIn: bigint;
  
  /** Estimated trading fee */
  estimatedFee: bigint;
  
  /** Whether this is the smallest shard */
  isSmallestShard: boolean;
  
  /** Chain ID where routing occurs */
  chainId: number;
  
  /** Routing confidence score (0-100) */
  confidenceScore: number;
  
  /** Estimated gas cost */
  estimatedGas: bigint;
  
  /** Price impact percentage */
  priceImpact: number;
}

/**
 * Request parameters for finding optimal shard
 */
export interface ShardRoutingRequest {
  /** Token pair to trade */
  tokenPair: TokenPair;
  
  /** Desired output amount */
  outputAmount: bigint;
  
  /** Maximum input amount willing to pay */
  maxInputAmount?: bigint;
  
  /** Chain ID to search on */
  chainId: number;
  
  /** Slippage tolerance (percentage, 0-100) */
  slippageTolerance?: number;
  
  /** User's wallet address for gas estimation */
  userAddress?: string;
}

/**
 * Result of shard routing request
 */
export interface ShardRoutingResult {
  /** Selected routing */
  routing: ShardRouting | null;
  
  /** All available shards considered */
  availableShards: ShardInfo[];
  
  /** Routing metadata */
  metadata: {
    searchTime: number;
    shardsEvaluated: number;
    chainId: number;
    cThresholdValidated: boolean;
  };
  
  /** Error message if routing failed */
  error?: string;
}

/**
 * Trade execution request
 */
export interface TradeExecutionRequest {
  /** Routing to execute */
  routing: ShardRouting;
  
  /** Maximum input amount (slippage protection) */
  maxAmountIn: bigint;
  
  /** User's wallet address */
  userAddress: string;
  
  /** Recipient address (can be different from user) */
  recipient?: string;
  
  /** Transaction deadline */
  deadline?: number;
}

/**
 * Trade execution result
 */
export interface TradeExecutionResult {
  /** Transaction hash */
  transactionHash: string;
  
  /** Actual input amount used */
  actualAmountIn: bigint;
  
  /** Actual output amount received */
  actualAmountOut: bigint;
  
  /** Actual fee paid */
  actualFee: bigint;
  
  /** Gas used */
  gasUsed: bigint;
  
  /** Execution success */
  success: boolean;
  
  /** Error message if failed */
  error?: string;
  
  /** Execution timestamp */
  timestamp: number;
}

/**
 * Shard discovery configuration
 */
export interface ShardDiscoveryConfig {
  /** Chain ID to monitor */
  chainId: number;
  
  /** RPC endpoint for the chain */
  rpcEndpoint: string;
  
  /** Pool factory contract address */
  poolFactoryAddress: string;
  
  /** Refresh interval for shard data (milliseconds) */
  refreshInterval: number;
  
  /** Minimum liquidity threshold for active shards */
  minLiquidityThreshold: bigint;
  
  /** Maximum age of cached data (milliseconds) */
  maxCacheAge: number;
  
  /** Enable real-time monitoring */
  enableRealTimeMonitoring: boolean;
  
  /** Batch size for querying multiple shards */
  batchSize: number;
}

/**
 * Shard monitoring metrics
 */
export interface ShardMonitoringMetrics {
  /** Total number of active shards */
  totalActiveShards: number;
  
  /** Total liquidity across all shards */
  totalLiquidity: bigint;
  
  /** Average shard size */
  averageShardSize: bigint;
  
  /** Number of token pairs */
  tokenPairCount: number;
  
  /** Last update timestamp */
  lastUpdated: number;
  
  /** Monitoring health status */
  healthStatus: 'healthy' | 'degraded' | 'unhealthy';
  
  /** Error count in last hour */
  errorCount: number;
  
  /** Average response time */
  avgResponseTime: number;
}

/**
 * C-threshold validation result
 */
export interface CThresholdValidation {
  /** Whether trade passes c-threshold */
  isValid: boolean;
  
  /** Trade amount */
  tradeAmount: bigint;
  
  /** Shard reserve amount */
  shardReserve: bigint;
  
  /** C parameter value */
  cParameter: number;
  
  /** Calculated threshold */
  threshold: bigint;
  
  /** Validation ratio (tradeAmount / threshold) */
  ratio: number;
}

/**
 * Smallest shard selection result
 */
export interface SmallestShardSelection {
  /** Selected shard */
  selectedShard: ShardInfo;
  
  /** All smallest shards (in case of ties) */
  smallestShards: ShardInfo[];
  
  /** Selection method used */
  selectionMethod: 'single_smallest' | 'random_among_smallest';
  
  /** Minimum reserve amount found */
  minReserveAmount: bigint;
  
  /** Selection timestamp */
  selectedAt: number;
}

/**
 * Router service configuration
 */
export interface RouterServiceConfig {
  /** Chain configuration */
  chainConfig: ShardDiscoveryConfig;
  
  /** Default slippage tolerance */
  defaultSlippage: number;
  
  /** Maximum gas price */
  maxGasPrice: string;
  
  /** Gas limit for trades */
  gasLimit: number;
  
  /** Enable caching */
  enableCaching: boolean;
  
  /** Cache TTL in milliseconds */
  cacheTTL: number;
  
  /** Retry configuration */
  retryConfig: {
    maxRetries: number;
    retryDelay: number;
    backoffMultiplier: number;
  };
  
  /** Monitoring configuration */
  monitoring: {
    enableMetrics: boolean;
    metricsInterval: number;
    alertThresholds: {
      errorRate: number;
      responseTime: number;
      failedShards: number;
    };
  };
}

/**
 * Router service statistics
 */
export interface RouterServiceStats {
  /** Total routing requests processed */
  totalRequests: number;
  
  /** Successful routings */
  successfulRoutings: number;
  
  /** Failed routings */
  failedRoutings: number;
  
  /** Success rate percentage */
  successRate: number;
  
  /** Average routing time */
  avgRoutingTime: number;
  
  /** Total trades executed */
  totalTradesExecuted: number;
  
  /** Total volume routed */
  totalVolumeRouted: bigint;
  
  /** Cache hit rate */
  cacheHitRate: number;
  
  /** Last reset timestamp */
  lastReset: number;
}

/**
 * Error types for router service
 */
export enum RouterServiceError {
  NO_SHARDS_AVAILABLE = 'NO_SHARDS_AVAILABLE',
  EXCEEDS_C_THRESHOLD = 'EXCEEDS_C_THRESHOLD',
  INSUFFICIENT_LIQUIDITY = 'INSUFFICIENT_LIQUIDITY',
  INVALID_TOKEN_PAIR = 'INVALID_TOKEN_PAIR',
  CHAIN_CONNECTION_ERROR = 'CHAIN_CONNECTION_ERROR',
  SHARD_DISCOVERY_FAILED = 'SHARD_DISCOVERY_FAILED',
  TRADE_EXECUTION_FAILED = 'TRADE_EXECUTION_FAILED',
  GAS_ESTIMATION_FAILED = 'GAS_ESTIMATION_FAILED',
  SLIPPAGE_TOO_HIGH = 'SLIPPAGE_TOO_HIGH',
  DEADLINE_EXCEEDED = 'DEADLINE_EXCEEDED'
}

/**
 * Event types for router service
 */
export interface RouterServiceEvents {
  'shard-discovered': { shard: ShardInfo };
  'shard-updated': { shard: ShardInfo };
  'shard-removed': { shardId: string };
  'routing-completed': { request: ShardRoutingRequest; result: ShardRoutingResult };
  'trade-executed': { request: TradeExecutionRequest; result: TradeExecutionResult };
  'error': { error: RouterServiceError; context: any };
  'metrics-updated': { metrics: ShardMonitoringMetrics };
}