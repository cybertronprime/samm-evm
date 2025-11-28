/**
 * Cross-Pool Router TypeScript SDK
 * Provides easy integration with the Cross-Pool Router API
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import {
  Token,
  TokenPair,
  SwapPath,
  PathDiscoveryRequest,
  PathDiscoveryResult,
  MultiHopSwapRequest,
  MultiHopSwapResult,
  CrossPoolRouterError
} from './types';

export interface SDKConfig {
  baseURL: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  apiKey?: string;
}

export interface QuoteResult {
  path: SwapPath;
  validation: {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    successProbability: number;
  };
  estimatedGas: bigint;
  totalFees: bigint;
  priceImpact: number;
}

export class CrossPoolRouterSDK {
  private client: AxiosInstance;
  private config: SDKConfig;

  constructor(config: SDKConfig) {
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
        console.log(`SDK Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor with retry logic
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config;
        
        if (!config || config.__retryCount >= (this.config.retries || 3)) {
          return Promise.reject(error);
        }

        config.__retryCount = config.__retryCount || 0;
        config.__retryCount++;

        // Retry on network errors or 5xx status codes
        if (
          error.code === 'ECONNABORTED' ||
          error.code === 'ENOTFOUND' ||
          (error.response && error.response.status >= 500)
        ) {
          console.log(`Retrying request (${config.__retryCount}/${this.config.retries})`);
          
          await new Promise(resolve => 
            setTimeout(resolve, (this.config.retryDelay || 1000) * config.__retryCount)
          );
          
          return this.client(config);
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Check API health status
   */
  async healthCheck(): Promise<{
    status: string;
    network: {
      chainId: number;
      name: string;
      blockNumber: number;
    };
    services: Record<string, string>;
  }> {
    try {
      const response = await this.client.get('/health');
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Discover optimal paths for multi-hop swaps
   */
  async discoverPaths(request: {
    tokenIn: Token;
    tokenOut: Token;
    amountOut: string | bigint;
    maxAmountIn?: string | bigint;
    maxHops?: number;
    slippageTolerance?: number;
  }): Promise<PathDiscoveryResult> {
    try {
      const payload: PathDiscoveryRequest = {
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountOut: BigInt(request.amountOut),
        maxAmountIn: request.maxAmountIn ? BigInt(request.maxAmountIn) : undefined,
        maxHops: request.maxHops,
        chainId: request.tokenIn.chainId,
        slippageTolerance: request.slippageTolerance
      };

      const response = await this.client.post('/api/v1/paths/discover', {
        ...payload,
        amountOut: payload.amountOut.toString(),
        maxAmountIn: payload.maxAmountIn?.toString()
      });

      const result = response.data.data;
      
      // Convert string amounts back to bigint
      return {
        paths: result.paths.map(this.convertPathAmounts),
        bestPath: result.bestPath ? this.convertPathAmounts(result.bestPath) : null,
        metadata: result.metadata
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get quote for a swap (dry run without execution)
   */
  async getQuote(request: {
    tokenIn: Token;
    tokenOut: Token;
    amountOut: string | bigint;
    maxHops?: number;
    slippageTolerance?: number;
  }): Promise<QuoteResult> {
    try {
      const response = await this.client.post('/api/v1/swaps/quote', {
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountOut: BigInt(request.amountOut).toString(),
        maxHops: request.maxHops,
        slippageTolerance: request.slippageTolerance
      });

      const result = response.data.data;
      
      return {
        path: this.convertPathAmounts(result.path),
        validation: result.validation,
        estimatedGas: BigInt(result.estimatedGas),
        totalFees: BigInt(result.totalFees),
        priceImpact: result.priceImpact
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Execute multi-hop swap
   */
  async executeSwap(request: {
    path: SwapPath;
    userAddress: string;
    recipient?: string;
    deadline: number;
    maxSlippage?: number;
  }): Promise<MultiHopSwapResult> {
    try {
      const payload = {
        path: this.convertPathAmountsToString(request.path),
        userAddress: request.userAddress,
        recipient: request.recipient,
        deadline: request.deadline,
        maxSlippage: request.maxSlippage
      };

      const response = await this.client.post('/api/v1/swaps/execute', payload);
      const result = response.data.data;

      // Convert string amounts back to bigint
      return {
        ...result,
        actualAmounts: result.actualAmounts.map((amount: any) => ({
          ...amount,
          actualAmountIn: BigInt(amount.actualAmountIn),
          actualAmountOut: BigInt(amount.actualAmountOut),
          actualFee: BigInt(amount.actualFee)
        })),
        finalAmountIn: BigInt(result.finalAmountIn),
        finalAmountOut: BigInt(result.finalAmountOut),
        totalFees: BigInt(result.totalFees),
        gasUsed: BigInt(result.gasUsed)
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get available token pairs
   */
  async getTokenPairs(): Promise<TokenPair[]> {
    try {
      const response = await this.client.get('/api/v1/paths/token-pairs');
      return response.data.data.tokenPairs;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update pool data
   */
  async updatePools(pools: any[]): Promise<void> {
    try {
      await this.client.post('/api/v1/pools/update', { pools });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get pool statistics
   */
  async getPoolStats(): Promise<{
    totalTokenPairs: number;
    discoveryStats: any;
    chainId: number;
  }> {
    try {
      const response = await this.client.get('/api/v1/pools/stats');
      return response.data.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get router statistics
   */
  async getRouterStats(): Promise<{
    pathDiscovery: any;
    shardSelector: any;
    atomicExecution: any;
    config: any;
  }> {
    try {
      const response = await this.client.get('/api/v1/router/stats');
      return response.data.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update router configuration
   */
  async updateConfig(updates: {
    maxHops?: number;
    maxPaths?: number;
    defaultSlippage?: number;
    minLiquidityThreshold?: string;
  }): Promise<void> {
    try {
      const payload = {
        ...updates,
        minLiquidityThreshold: updates.minLiquidityThreshold ? 
          BigInt(updates.minLiquidityThreshold).toString() : undefined
      };

      await this.client.post('/api/v1/router/config', payload);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Estimate gas for a swap path
   */
  async estimateGas(path: SwapPath): Promise<bigint> {
    // Simple estimation based on number of hops
    const baseGas = 150000n;
    return BigInt(path.hops.length) * baseGas;
  }

  /**
   * Validate a swap path
   */
  validatePath(path: SwapPath): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check path structure
    if (!path.hops || path.hops.length === 0) {
      errors.push('Path must have at least one hop');
    }

    // Check hop connectivity
    for (let i = 0; i < path.hops.length - 1; i++) {
      const currentHop = path.hops[i];
      const nextHop = path.hops[i + 1];
      
      if (currentHop.tokenOut.address !== nextHop.tokenIn.address) {
        errors.push(`Hop ${i} output token doesn't match hop ${i + 1} input token`);
      }
    }

    // Check for high price impact
    if (path.totalPriceImpact > 5.0) {
      warnings.push(`High price impact: ${path.totalPriceImpact.toFixed(2)}%`);
    }

    // Check for inactive pools
    const inactivePools = path.hops.filter(hop => hop.pool.status !== 'active');
    if (inactivePools.length > 0) {
      errors.push(`${inactivePools.length} inactive pools in path`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Convert path amounts from string to bigint
   */
  private convertPathAmounts(path: any): SwapPath {
    return {
      ...path,
      totalAmountIn: BigInt(path.totalAmountIn),
      finalAmountOut: BigInt(path.finalAmountOut),
      totalFees: BigInt(path.totalFees),
      estimatedGas: BigInt(path.estimatedGas),
      hops: path.hops.map((hop: any) => ({
        ...hop,
        expectedAmountIn: BigInt(hop.expectedAmountIn),
        expectedAmountOut: BigInt(hop.expectedAmountOut),
        estimatedFee: BigInt(hop.estimatedFee)
      }))
    };
  }

  /**
   * Convert path amounts from bigint to string for API calls
   */
  private convertPathAmountsToString(path: SwapPath): any {
    return {
      ...path,
      totalAmountIn: path.totalAmountIn.toString(),
      finalAmountOut: path.finalAmountOut.toString(),
      totalFees: path.totalFees.toString(),
      estimatedGas: path.estimatedGas.toString(),
      hops: path.hops.map(hop => ({
        ...hop,
        expectedAmountIn: hop.expectedAmountIn.toString(),
        expectedAmountOut: hop.expectedAmountOut.toString(),
        estimatedFee: hop.estimatedFee.toString()
      }))
    };
  }

  /**
   * Handle and format API errors
   */
  private handleError(error: any): Error {
    if (error.response) {
      // API returned an error response
      const { status, data } = error.response;
      const message = data.message || data.error || `HTTP ${status} error`;
      
      const apiError = new Error(message);
      (apiError as any).code = data.error || 'API_ERROR';
      (apiError as any).status = status;
      (apiError as any).details = data;
      
      return apiError;
    } else if (error.request) {
      // Network error
      return new Error('Network error: Unable to reach Cross-Pool Router API');
    } else {
      // Other error
      return error;
    }
  }

  /**
   * Create a new SDK instance with different configuration
   */
  static create(config: SDKConfig): CrossPoolRouterSDK {
    return new CrossPoolRouterSDK(config);
  }
}

// Export convenience functions
export const createSDK = (config: SDKConfig) => new CrossPoolRouterSDK(config);

export default CrossPoolRouterSDK;