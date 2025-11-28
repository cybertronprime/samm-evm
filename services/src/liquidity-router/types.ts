/**
 * Type definitions for the Liquidity Router Service
 * Implements types for pool analysis, selection, and fillup strategy
 */

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
}

export interface TokenPair {
  tokenA: TokenInfo;
  tokenB: TokenInfo;
}

export interface LiquidityAmount {
  tokenA: bigint;
  tokenB: bigint;
}

export interface PoolInfo {
  poolAddress: string;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  reserveA: bigint;
  reserveB: bigint;
  totalSupply: bigint;
  chainId: number;
  isSmallestShard: boolean;
}

export interface PoolMetrics {
  volume24h: bigint;
  transactions24h: number;
  feesGenerated24h: bigint;
  liquidityUtilization: number;
  averageTradeSize: bigint;
  lastUpdated: Date;
}

export interface PoolAnalysis {
  poolInfo: PoolInfo;
  metrics: PoolMetrics;
  expectedApr: number;
  riskScore: number;
  liquidityEfficiency: number;
}

export interface LiquidityRecommendation {
  poolAddress: string;
  isSmallestShard: boolean;
  expectedApr: number;
  feeGeneration24h: bigint;
  liquidityUtilization: number;
  chainId: number;
  reasoning: string;
  confidence: number;
}

export interface FillupStrategy {
  targetPoolAddress: string;
  currentSize: bigint;
  targetSize: bigint;
  recommendedAmount: bigint;
  reasoning: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ExpectedReturns {
  dailyFees: bigint;
  weeklyFees: bigint;
  monthlyFees: bigint;
  estimatedApr: number;
  impermanentLossRisk: number;
  liquidityShare: number;
}

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcEndpoint: string;
  contractAddresses: {
    sammPoolFactory: string;
    router: string;
  };
}

export interface LiquidityRouterConfig {
  chains: ChainConfig[];
  analysisInterval: number; // milliseconds
  metricsRetentionPeriod: number; // milliseconds
  minLiquidityThreshold: bigint;
  maxRiskScore: number;
}