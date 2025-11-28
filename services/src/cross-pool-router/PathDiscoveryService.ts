/**
 * Path Discovery Service
 * Implements graph-based routing algorithm for multi-hop swaps
 * Finds optimal paths between any token pairs while maintaining c-properties
 */

import {
  Token,
  TokenPair,
  Pool,
  SwapPath,
  SwapHop,
  PathDiscoveryRequest,
  PathDiscoveryResult,
  TokenGraph,
  TokenGraphNode,
  PathValidationResult,
  CrossPoolRouterConfig,
  CrossPoolRouterError
} from './types';

export class PathDiscoveryService {
  private config: CrossPoolRouterConfig;
  private tokenGraph: TokenGraph;
  private pathCache: Map<string, SwapPath[]>;
  private stats: {
    totalSearches: number;
    totalPathsFound: number;
    avgSearchTime: number;
    cacheHits: number;
  };

  constructor(config: CrossPoolRouterConfig) {
    this.config = config;
    this.tokenGraph = {
      nodes: new Map(),
      pools: new Map(),
      chainId: config.chainId,
      lastUpdated: 0
    };
    this.pathCache = new Map();
    this.stats = {
      totalSearches: 0,
      totalPathsFound: 0,
      avgSearchTime: 0,
      cacheHits: 0
    };
  }

  /**
   * Discover optimal paths between token pairs
   * @param request Path discovery parameters
   * @returns Discovery result with found paths
   */
  async discoverPaths(request: PathDiscoveryRequest): Promise<PathDiscoveryResult> {
    const startTime = Date.now();
    
    try {
      // Validate request
      this.validateDiscoveryRequest(request);
      
      // Check cache if enabled
      if (this.config.enableCaching) {
        const cached = this.getCachedPaths(request);
        if (cached.length > 0) {
          this.stats.cacheHits++;
          return {
            paths: cached,
            bestPath: cached[0] || null,
            metadata: {
              searchTime: Date.now() - startTime,
              pathsEvaluated: cached.length,
              poolsConsidered: 0,
              chainId: request.chainId
            }
          };
        }
      }

      // Direct path check
      const directPaths = await this.findDirectPaths(request);
      
      // Multi-hop path discovery
      const multiHopPaths = await this.findMultiHopPaths(request);
      
      // Combine and sort paths
      const allPaths = [...directPaths, ...multiHopPaths];
      const sortedPaths = this.sortPathsByEfficiency(allPaths);
      
      // Limit results
      const limitedPaths = sortedPaths.slice(0, this.config.maxPaths);
      
      // Cache results if enabled
      if (this.config.enableCaching && limitedPaths.length > 0) {
        this.cachePaths(request, limitedPaths);
      }
      
      // Update stats
      this.stats.totalSearches++;
      this.stats.totalPathsFound += limitedPaths.length;
      const searchTime = Date.now() - startTime;
      this.stats.avgSearchTime = (this.stats.avgSearchTime + searchTime) / 2;

      return {
        paths: limitedPaths,
        bestPath: limitedPaths[0] || null,
        metadata: {
          searchTime,
          pathsEvaluated: allPaths.length,
          poolsConsidered: this.getPoolsConsidered(request),
          chainId: request.chainId
        }
      };

    } catch (error) {
      console.error('Path discovery failed:', error);
      throw error;
    }
  }

  /**
   * Find direct paths (single hop) between tokens
   * @param request Discovery request
   * @returns Array of direct paths
   */
  private async findDirectPaths(request: PathDiscoveryRequest): Promise<SwapPath[]> {
    const { tokenIn, tokenOut, amountOut, chainId } = request;
    const paths: SwapPath[] = [];

    // Get pools for the token pair
    const pairKey = this.getTokenPairKey(tokenIn.address, tokenOut.address);
    const pools = this.tokenGraph.pools.get(pairKey) || [];

    for (const pool of pools) {
      if (pool.status !== 'active' || pool.chainId !== chainId) {
        continue;
      }

      // Check if pool has sufficient liquidity
      if (!this.hasMinimumLiquidity(pool)) {
        continue;
      }

      // Find smallest shard for this pool
      const smallestShard = await this.findSmallestShardForPool(pool, tokenIn);
      if (!smallestShard) {
        continue;
      }

      // Calculate swap metrics
      const swapMetrics = this.calculateSwapMetrics(
        smallestShard,
        tokenIn,
        tokenOut,
        amountOut
      );

      // Validate c-threshold
      if (!this.validateCThreshold(smallestShard, swapMetrics.amountIn, tokenIn)) {
        continue;
      }

      // Create hop
      const hop: SwapHop = {
        pool: smallestShard,
        tokenIn,
        tokenOut,
        expectedAmountIn: swapMetrics.amountIn,
        expectedAmountOut: amountOut,
        estimatedFee: swapMetrics.fee,
        priceImpact: swapMetrics.priceImpact,
        usesSmallestShard: true,
        hopIndex: 0
      };

      // Create path
      const path: SwapPath = {
        tokenIn,
        tokenOut,
        hops: [hop],
        totalAmountIn: swapMetrics.amountIn,
        finalAmountOut: amountOut,
        totalFees: swapMetrics.fee,
        totalPriceImpact: swapMetrics.priceImpact,
        efficiencyScore: this.calculateEfficiencyScore([hop]),
        estimatedGas: this.estimateGasForPath([hop]),
        chainId,
        createdAt: Date.now()
      };

      paths.push(path);
    }

    return paths;
  }

  /**
   * Find multi-hop paths using graph traversal
   * @param request Discovery request
   * @returns Array of multi-hop paths
   */
  private async findMultiHopPaths(request: PathDiscoveryRequest): Promise<SwapPath[]> {
    const { tokenIn, tokenOut, amountOut, maxHops = 3, chainId } = request;
    const paths: SwapPath[] = [];

    // Use breadth-first search to find paths
    const queue: {
      currentToken: Token;
      path: SwapHop[];
      remainingAmount: bigint;
      totalAmountIn: bigint;
      totalFees: bigint;
      totalPriceImpact: number;
    }[] = [];

    // Initialize with direct connections from input token
    const inputNode = this.tokenGraph.nodes.get(tokenIn.address);
    if (!inputNode) {
      return paths;
    }

    // Add initial connections to queue
    for (const [connectedTokenAddress, pools] of inputNode.connections) {
      if (connectedTokenAddress === tokenOut.address) {
        continue; // Skip direct paths (handled separately)
      }

      const connectedToken = this.getTokenByAddress(connectedTokenAddress, chainId);
      if (!connectedToken) {
        continue;
      }

      for (const pool of pools) {
        if (pool.status !== 'active' || !this.hasMinimumLiquidity(pool)) {
          continue;
        }

        const smallestShard = await this.findSmallestShardForPool(pool, tokenIn);
        if (!smallestShard) {
          continue;
        }

        // For multi-hop, we need to work backwards from final amount
        // This is a simplified approach - in practice, you'd need more sophisticated calculation
        const estimatedIntermediateAmount = this.estimateIntermediateAmount(
          amountOut,
          connectedToken,
          tokenOut,
          chainId
        );

        if (estimatedIntermediateAmount === BigInt(0)) {
          continue;
        }

        const swapMetrics = this.calculateSwapMetrics(
          smallestShard,
          tokenIn,
          connectedToken,
          estimatedIntermediateAmount
        );

        if (!this.validateCThreshold(smallestShard, swapMetrics.amountIn, tokenIn)) {
          continue;
        }

        const hop: SwapHop = {
          pool: smallestShard,
          tokenIn,
          tokenOut: connectedToken,
          expectedAmountIn: swapMetrics.amountIn,
          expectedAmountOut: estimatedIntermediateAmount,
          estimatedFee: swapMetrics.fee,
          priceImpact: swapMetrics.priceImpact,
          usesSmallestShard: true,
          hopIndex: 0
        };

        queue.push({
          currentToken: connectedToken,
          path: [hop],
          remainingAmount: estimatedIntermediateAmount,
          totalAmountIn: swapMetrics.amountIn,
          totalFees: swapMetrics.fee,
          totalPriceImpact: swapMetrics.priceImpact
        });
      }
    }

    // Process queue for multi-hop paths
    while (queue.length > 0) {
      const current = queue.shift()!;
      
      if (current.path.length >= maxHops) {
        continue;
      }

      const currentNode = this.tokenGraph.nodes.get(current.currentToken.address);
      if (!currentNode) {
        continue;
      }

      // Check if we can reach the target token
      for (const [connectedTokenAddress, pools] of currentNode.connections) {
        const connectedToken = this.getTokenByAddress(connectedTokenAddress, chainId);
        if (!connectedToken) {
          continue;
        }

        // If this is the target token, complete the path
        if (connectedToken.address === tokenOut.address) {
          for (const pool of pools) {
            if (pool.status !== 'active' || !this.hasMinimumLiquidity(pool)) {
              continue;
            }

            const smallestShard = await this.findSmallestShardForPool(pool, current.currentToken);
            if (!smallestShard) {
              continue;
            }

            const swapMetrics = this.calculateSwapMetrics(
              smallestShard,
              current.currentToken,
              tokenOut,
              amountOut
            );

            if (!this.validateCThreshold(smallestShard, swapMetrics.amountIn, current.currentToken)) {
              continue;
            }

            const finalHop: SwapHop = {
              pool: smallestShard,
              tokenIn: current.currentToken,
              tokenOut,
              expectedAmountIn: swapMetrics.amountIn,
              expectedAmountOut: amountOut,
              estimatedFee: swapMetrics.fee,
              priceImpact: swapMetrics.priceImpact,
              usesSmallestShard: true,
              hopIndex: current.path.length
            };

            const completePath = [...current.path, finalHop];
            const totalAmountIn = current.totalAmountIn + swapMetrics.amountIn;
            const totalFees = current.totalFees + swapMetrics.fee;
            const totalPriceImpact = current.totalPriceImpact + swapMetrics.priceImpact;

            const path: SwapPath = {
              tokenIn,
              tokenOut,
              hops: completePath,
              totalAmountIn,
              finalAmountOut: amountOut,
              totalFees,
              totalPriceImpact,
              efficiencyScore: this.calculateEfficiencyScore(completePath),
              estimatedGas: this.estimateGasForPath(completePath),
              chainId,
              createdAt: Date.now()
            };

            paths.push(path);
          }
        } else {
          // Continue building the path
          for (const pool of pools) {
            if (pool.status !== 'active' || !this.hasMinimumLiquidity(pool)) {
              continue;
            }

            // Avoid cycles
            const alreadyVisited = current.path.some(hop => 
              hop.tokenOut.address === connectedToken.address
            );
            if (alreadyVisited) {
              continue;
            }

            const smallestShard = await this.findSmallestShardForPool(pool, current.currentToken);
            if (!smallestShard) {
              continue;
            }

            const estimatedNextAmount = this.estimateIntermediateAmount(
              amountOut,
              connectedToken,
              tokenOut,
              chainId
            );

            if (estimatedNextAmount === BigInt(0)) {
              continue;
            }

            const swapMetrics = this.calculateSwapMetrics(
              smallestShard,
              current.currentToken,
              connectedToken,
              estimatedNextAmount
            );

            if (!this.validateCThreshold(smallestShard, swapMetrics.amountIn, current.currentToken)) {
              continue;
            }

            const hop: SwapHop = {
              pool: smallestShard,
              tokenIn: current.currentToken,
              tokenOut: connectedToken,
              expectedAmountIn: swapMetrics.amountIn,
              expectedAmountOut: estimatedNextAmount,
              estimatedFee: swapMetrics.fee,
              priceImpact: swapMetrics.priceImpact,
              usesSmallestShard: true,
              hopIndex: current.path.length
            };

            queue.push({
              currentToken: connectedToken,
              path: [...current.path, hop],
              remainingAmount: estimatedNextAmount,
              totalAmountIn: current.totalAmountIn + swapMetrics.amountIn,
              totalFees: current.totalFees + swapMetrics.fee,
              totalPriceImpact: current.totalPriceImpact + swapMetrics.priceImpact
            });
          }
        }
      }
    }

    return paths;
  }

  /**
   * Update token graph with pool data
   * @param pools Array of pools to add to graph
   */
  updateTokenGraph(pools: Pool[]): void {
    // Clear existing graph
    this.tokenGraph.nodes.clear();
    this.tokenGraph.pools.clear();

    // Build nodes and connections
    for (const pool of pools) {
      if (pool.chainId !== this.config.chainId) {
        continue;
      }

      const { tokenA, tokenB } = pool.tokenPair;
      
      // Add tokens to graph
      this.addTokenToGraph(tokenA);
      this.addTokenToGraph(tokenB);
      
      // Add pool to connections
      this.addPoolConnection(tokenA, tokenB, pool);
      
      // Add to pools map
      const pairKey = this.getTokenPairKey(tokenA.address, tokenB.address);
      if (!this.tokenGraph.pools.has(pairKey)) {
        this.tokenGraph.pools.set(pairKey, []);
      }
      this.tokenGraph.pools.get(pairKey)!.push(pool);
    }

    this.tokenGraph.lastUpdated = Date.now();
  }

  /**
   * Get available token pairs on the chain
   * @returns Array of available token pairs
   */
  getAvailableTokenPairs(): TokenPair[] {
    const pairs: TokenPair[] = [];
    
    for (const [pairKey, pools] of this.tokenGraph.pools) {
      if (pools.length === 0) {
        continue;
      }
      
      const pool = pools[0]; // Use first pool to get token pair info
      pairs.push(pool.tokenPair);
    }
    
    return pairs;
  }

  /**
   * Validate path for execution
   * @param path Path to validate
   * @returns Validation result
   */
  validatePath(path: SwapPath): PathValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let successProbability = 1.0;

    // Check path length
    if (path.hops.length === 0) {
      errors.push('Path has no hops');
    }

    if (path.hops.length > this.config.maxHops) {
      errors.push(`Path exceeds maximum hops (${this.config.maxHops})`);
    }

    // Check each hop
    for (const hop of path.hops) {
      // Check pool status
      if (hop.pool.status !== 'active') {
        errors.push(`Pool ${hop.pool.address} is not active`);
      }

      // Check liquidity
      if (!this.hasMinimumLiquidity(hop.pool)) {
        warnings.push(`Pool ${hop.pool.address} has low liquidity`);
        successProbability *= 0.8;
      }

      // Check c-threshold
      if (!this.validateCThreshold(hop.pool, hop.expectedAmountIn, hop.tokenIn)) {
        warnings.push(`Hop ${hop.hopIndex} exceeds c-threshold`);
        successProbability *= 0.9;
      }

      // Check price impact
      if (hop.priceImpact > 5.0) {
        warnings.push(`High price impact (${hop.priceImpact.toFixed(2)}%) in hop ${hop.hopIndex}`);
        successProbability *= 0.85;
      }
    }

    // Check total price impact
    if (path.totalPriceImpact > 10.0) {
      warnings.push(`High total price impact: ${path.totalPriceImpact.toFixed(2)}%`);
      successProbability *= 0.7;
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      successProbability: Math.max(0, successProbability)
    };
  }

  // Private helper methods

  private validateDiscoveryRequest(request: PathDiscoveryRequest): void {
    if (!request.tokenIn || !request.tokenOut) {
      throw new Error(CrossPoolRouterError.INVALID_TOKEN_PAIR);
    }

    if (request.tokenIn.address === request.tokenOut.address) {
      throw new Error(CrossPoolRouterError.INVALID_TOKEN_PAIR);
    }

    if (request.amountOut <= 0) {
      throw new Error('Invalid output amount');
    }

    if (request.chainId !== this.config.chainId) {
      throw new Error('Chain ID mismatch');
    }
  }

  private getCachedPaths(request: PathDiscoveryRequest): SwapPath[] {
    const cacheKey = this.getCacheKey(request);
    const cached = this.pathCache.get(cacheKey);
    
    if (!cached) {
      return [];
    }

    // Check if cache is still valid
    const now = Date.now();
    const isValid = cached.every(path => 
      (now - path.createdAt) < this.config.pathCacheTTL
    );

    if (!isValid) {
      this.pathCache.delete(cacheKey);
      return [];
    }

    return cached;
  }

  private cachePaths(request: PathDiscoveryRequest, paths: SwapPath[]): void {
    const cacheKey = this.getCacheKey(request);
    this.pathCache.set(cacheKey, paths);
  }

  private getCacheKey(request: PathDiscoveryRequest): string {
    return `${request.tokenIn.address}-${request.tokenOut.address}-${request.amountOut.toString()}-${request.chainId}`;
  }

  private sortPathsByEfficiency(paths: SwapPath[]): SwapPath[] {
    return paths.sort((a, b) => {
      // Primary: efficiency score (higher is better)
      if (a.efficiencyScore !== b.efficiencyScore) {
        return b.efficiencyScore - a.efficiencyScore;
      }
      
      // Secondary: total fees (lower is better)
      if (a.totalFees !== b.totalFees) {
        return Number(a.totalFees - b.totalFees);
      }
      
      // Tertiary: number of hops (fewer is better)
      return a.hops.length - b.hops.length;
    });
  }

  private calculateEfficiencyScore(hops: SwapHop[]): number {
    let score = 100;
    
    // Penalize for number of hops
    score -= (hops.length - 1) * 10;
    
    // Penalize for high price impact
    const totalPriceImpact = hops.reduce((sum, hop) => sum + hop.priceImpact, 0);
    score -= totalPriceImpact * 2;
    
    // Bonus for using smallest shards
    const smallestShardBonus = hops.filter(hop => hop.usesSmallestShard).length * 5;
    score += smallestShardBonus;
    
    return Math.max(0, Math.min(100, score));
  }

  private estimateGasForPath(hops: SwapHop[]): bigint {
    // Base gas cost per hop
    const baseGasPerHop = BigInt(150000);
    return BigInt(hops.length) * baseGasPerHop;
  }

  private getPoolsConsidered(request: PathDiscoveryRequest): number {
    let count = 0;
    for (const pools of this.tokenGraph.pools.values()) {
      count += pools.filter(pool => 
        pool.chainId === request.chainId && pool.status === 'active'
      ).length;
    }
    return count;
  }

  private addTokenToGraph(token: Token): void {
    if (!this.tokenGraph.nodes.has(token.address)) {
      this.tokenGraph.nodes.set(token.address, {
        token,
        connections: new Map(),
        liquidityScore: BigInt(0),
        poolCount: 0
      });
    }
  }

  private addPoolConnection(tokenA: Token, tokenB: Token, pool: Pool): void {
    const nodeA = this.tokenGraph.nodes.get(tokenA.address)!;
    const nodeB = this.tokenGraph.nodes.get(tokenB.address)!;
    
    // Add connection A -> B
    if (!nodeA.connections.has(tokenB.address)) {
      nodeA.connections.set(tokenB.address, []);
    }
    nodeA.connections.get(tokenB.address)!.push(pool);
    
    // Add connection B -> A
    if (!nodeB.connections.has(tokenA.address)) {
      nodeB.connections.set(tokenA.address, []);
    }
    nodeB.connections.get(tokenA.address)!.push(pool);
    
    // Update metrics
    const poolLiquidity = pool.reserves.tokenA + pool.reserves.tokenB;
    nodeA.liquidityScore += poolLiquidity;
    nodeB.liquidityScore += poolLiquidity;
    nodeA.poolCount++;
    nodeB.poolCount++;
  }

  private getTokenPairKey(tokenA: string, tokenB: string): string {
    return tokenA < tokenB ? `${tokenA}-${tokenB}` : `${tokenB}-${tokenA}`;
  }

  private getTokenByAddress(address: string, chainId: number): Token | null {
    const node = this.tokenGraph.nodes.get(address);
    return node && node.token.chainId === chainId ? node.token : null;
  }

  private hasMinimumLiquidity(pool: Pool): boolean {
    const totalLiquidity = pool.reserves.tokenA + pool.reserves.tokenB;
    return totalLiquidity >= this.config.minLiquidityThreshold;
  }

  private async findSmallestShardForPool(pool: Pool, inputToken: Token): Promise<Pool | null> {
    // For now, return the pool itself as we're treating each pool as a shard
    // In a full implementation, this would find the smallest shard among multiple shards for the same token pair
    return pool;
  }

  private calculateSwapMetrics(
    pool: Pool,
    tokenIn: Token,
    tokenOut: Token,
    amountOut: bigint
  ): { amountIn: bigint; fee: bigint; priceImpact: number } {
    // Determine input and output reserves
    const isTokenA = pool.tokenPair.tokenA.address === tokenIn.address;
    const inputReserve = isTokenA ? pool.reserves.tokenA : pool.reserves.tokenB;
    const outputReserve = isTokenA ? pool.reserves.tokenB : pool.reserves.tokenA;

    // Calculate input amount using constant product formula
    // (x + dx) * (y - dy) = x * y
    // dx = (x * dy) / (y - dy)
    const numerator = inputReserve * amountOut;
    const denominator = outputReserve - amountOut;
    const amountInBeforeFee = numerator / denominator;

    // Calculate fee (simplified - using basic percentage)
    const feeRate = BigInt(pool.fees.tradeFeeNumerator) * BigInt(1000000) / BigInt(pool.fees.tradeFeeDenominator);
    const fee = (amountInBeforeFee * feeRate) / BigInt(1000000);
    const amountIn = amountInBeforeFee + fee;

    // Calculate price impact
    const currentPrice = Number(outputReserve) / Number(inputReserve);
    const executionPrice = Number(amountOut) / Number(amountIn);
    const priceImpact = Math.abs((executionPrice - currentPrice) / currentPrice) * 100;

    return { amountIn, fee, priceImpact };
  }

  private validateCThreshold(pool: Pool, amountIn: bigint, inputToken: Token): boolean {
    const isTokenA = pool.tokenPair.tokenA.address === inputToken.address;
    const inputReserve = isTokenA ? pool.reserves.tokenA : pool.reserves.tokenB;
    
    if (inputReserve === BigInt(0)) {
      return false;
    }

    const ratio = Number(amountIn) / Number(inputReserve);
    const cThreshold = pool.sammParams.c / 1000000; // Convert from scaled value
    
    return ratio <= cThreshold;
  }

  private estimateIntermediateAmount(
    finalAmount: bigint,
    intermediateToken: Token,
    finalToken: Token,
    chainId: number
  ): bigint {
    // Find pools between intermediate and final tokens
    const pairKey = this.getTokenPairKey(intermediateToken.address, finalToken.address);
    const pools = this.tokenGraph.pools.get(pairKey) || [];
    
    if (pools.length === 0) {
      return BigInt(0);
    }

    // Use the first active pool for estimation
    const pool = pools.find(p => p.status === 'active' && p.chainId === chainId);
    if (!pool) {
      return BigInt(0);
    }

    // Estimate required intermediate amount (simplified calculation)
    const isTokenA = pool.tokenPair.tokenA.address === intermediateToken.address;
    const inputReserve = isTokenA ? pool.reserves.tokenA : pool.reserves.tokenB;
    const outputReserve = isTokenA ? pool.reserves.tokenB : pool.reserves.tokenA;

    // Use constant product formula to estimate
    const numerator = inputReserve * finalAmount;
    const denominator = outputReserve - finalAmount;
    
    if (denominator <= 0) {
      return BigInt(0);
    }

    return numerator / denominator;
  }

  /**
   * Get discovery statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Clear path cache
   */
  clearCache(): void {
    this.pathCache.clear();
  }
}