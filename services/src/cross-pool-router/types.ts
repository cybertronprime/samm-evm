/**
 * Cross-Pool Router Types and Interfaces
 * Defines data structures for multi-hop swaps and path discovery
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
 * Represents a SAMM pool/shard
 */
export interface Pool {
  /** Pool contract address */
  address: string;
  
  /** Token pair for this pool */
  tokenPair: TokenPair;
  
  /** Current reserves */
  reserves: {
    tokenA: bigint;
    tokenB: bigint;
    totalSupply: bigint;
  };
  
  /** Pool metrics */
  metrics: {
    volume24h: bigint;
    fees24h: bigint;
    transactions24h: number;
    lastUpdated: number;
  };
  
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
  
  /** Pool status */
  status: 'active' | 'inactive' | 'paused';
  
  /** Chain ID where pool exists */
  chainId: number;
}

/**
 * Represents a single hop in a multi-hop swap path
 */
export interface SwapHop {
  /** Pool to use for this hop */
  pool: Pool;
  
  /** Input token for this hop */
  tokenIn: Token;
  
  /** Output token for this hop */
  tokenOut: Token;
  
  /** Expected input amount for this hop */
  expectedAmountIn: bigint;
  
  /** Expected output amount for this hop */
  expectedAmountOut: bigint;
  
  /** Estimated fee for this hop */
  estimatedFee: bigint;
  
  /** Price impact for this hop (percentage) */
  priceImpact: number;
  
  /** Whether this hop uses the smallest shard */
  usesSmallestShard: boolean;
  
  /** Hop index in the path (0-based) */
  hopIndex: number;
}

/**
 * Represents a complete swap path from input to output token
 */
export interface SwapPath {
  /** Input token */
  tokenIn: Token;
  
  /** Output token */
  tokenOut: Token;
  
  /** Array of hops in the path */
  hops: SwapHop[];
  
  /** Total expected input amount */
  totalAmountIn: bigint;
  
  /** Final expected output amount */
  finalAmountOut: bigint;
  
  /** Total fees across all hops */
  totalFees: bigint;
  
  /** Total price impact across all hops */
  totalPriceImpact: number;
  
  /** Path efficiency score (0-100) */
  efficiencyScore: number;
  
  /** Estimated gas cost for the path */
  estimatedGas: bigint;
  
  /** Chain ID where path executes */
  chainId: number;
  
  /** Path creation timestamp */
  createdAt: number;
}

/**
 * Path discovery request parameters
 */
export interface PathDiscoveryRequest {
  /** Input token */
  tokenIn: Token;
  
  /** Output token */
  tokenOut: Token;
  
  /** Desired output amount */
  amountOut: bigint;
  
  /** Maximum input amount willing to pay */
  maxAmountIn?: bigint;
  
  /** Maximum number of hops allowed */
  maxHops?: number;
  
  /** Chain ID to search on */
  chainId: number;
  
  /** Slippage tolerance (percentage, 0-100) */
  slippageTolerance?: number;
  
  /** Preferred intermediate tokens */
  preferredIntermediateTokens?: Token[];
}

/**
 * Path discovery result
 */
export interface PathDiscoveryResult {
  /** Found paths sorted by efficiency */
  paths: SwapPath[];
  
  /** Best path (highest efficiency) */
  bestPath: SwapPath | null;
  
  /** Search metadata */
  metadata: {
    searchTime: number;
    pathsEvaluated: number;
    poolsConsidered: number;
    chainId: number;
  };
}

/**
 * Multi-hop swap execution request
 */
export interface MultiHopSwapRequest {
  /** Path to execute */
  path: SwapPath;
  
  /** User's wallet address */
  userAddress: string;
  
  /** Recipient address (can be different from user) */
  recipient: string;
  
  /** Deadline for the swap (timestamp) */
  deadline: number;
  
  /** Maximum slippage tolerance */
  maxSlippage: number;
}

/**
 * Multi-hop swap execution result
 */
export interface MultiHopSwapResult {
  /** Transaction hash */
  transactionHash: string;
  
  /** Actual amounts for each hop */
  actualAmounts: {
    hopIndex: number;
    actualAmountIn: bigint;
    actualAmountOut: bigint;
    actualFee: bigint;
  }[];
  
  /** Final amounts */
  finalAmountIn: bigint;
  finalAmountOut: bigint;
  totalFees: bigint;
  
  /** Gas used */
  gasUsed: bigint;
  
  /** Execution time */
  executionTime: number;
  
  /** Success status */
  success: boolean;
  
  /** Error message if failed */
  error?: string;
}

/**
 * Token graph node for path discovery
 */
export interface TokenGraphNode {
  /** Token information */
  token: Token;
  
  /** Connected tokens (direct pools available) */
  connections: Map<string, Pool[]>;
  
  /** Liquidity score (sum of all connected pool liquidity) */
  liquidityScore: bigint;
  
  /** Number of pools this token participates in */
  poolCount: number;
}

/**
 * Token graph for efficient path discovery
 */
export interface TokenGraph {
  /** All nodes in the graph */
  nodes: Map<string, TokenGraphNode>;
  
  /** All pools indexed by token pairs */
  pools: Map<string, Pool[]>;
  
  /** Chain ID this graph represents */
  chainId: number;
  
  /** Last update timestamp */
  lastUpdated: number;
}

/**
 * Path validation result
 */
export interface PathValidationResult {
  /** Whether path is valid */
  isValid: boolean;
  
  /** Validation errors */
  errors: string[];
  
  /** Warnings */
  warnings: string[];
  
  /** Estimated success probability (0-1) */
  successProbability: number;
}

/**
 * Cross-pool router configuration
 */
export interface CrossPoolRouterConfig {
  /** Chain ID to operate on */
  chainId: number;
  
  /** RPC endpoint for the chain */
  rpcEndpoint: string;
  
  /** Maximum number of hops allowed */
  maxHops: number;
  
  /** Maximum paths to return */
  maxPaths: number;
  
  /** Minimum liquidity threshold for pools */
  minLiquidityThreshold: bigint;
  
  /** Path cache TTL in milliseconds */
  pathCacheTTL: number;
  
  /** Pool data refresh interval */
  poolRefreshInterval: number;
  
  /** Gas price settings */
  gasSettings: {
    gasPrice: string;
    gasLimit: number;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
  };
  
  /** Default slippage tolerance */
  defaultSlippage: number;
  
  /** Enable path caching */
  enableCaching: boolean;
}

/**
 * Router statistics
 */
export interface CrossPoolRouterStats {
  /** Total paths discovered */
  totalPathsDiscovered: number;
  
  /** Total swaps executed */
  totalSwapsExecuted: number;
  
  /** Success rate */
  successRate: number;
  
  /** Average path discovery time */
  avgDiscoveryTime: number;
  
  /** Average execution time */
  avgExecutionTime: number;
  
  /** Cache hit rate */
  cacheHitRate: number;
  
  /** Total volume routed */
  totalVolumeRouted: bigint;
  
  /** Total fees collected */
  totalFeesCollected: bigint;
  
  /** Last update timestamp */
  lastUpdated: number;
}

/**
 * Error types for cross-pool routing
 */
export enum CrossPoolRouterError {
  NO_PATH_FOUND = 'NO_PATH_FOUND',
  INSUFFICIENT_LIQUIDITY = 'INSUFFICIENT_LIQUIDITY',
  EXCEEDS_MAX_HOPS = 'EXCEEDS_MAX_HOPS',
  INVALID_TOKEN_PAIR = 'INVALID_TOKEN_PAIR',
  SLIPPAGE_TOO_HIGH = 'SLIPPAGE_TOO_HIGH',
  DEADLINE_EXCEEDED = 'DEADLINE_EXCEEDED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  POOL_NOT_ACTIVE = 'POOL_NOT_ACTIVE',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  GAS_ESTIMATION_FAILED = 'GAS_ESTIMATION_FAILED'
}