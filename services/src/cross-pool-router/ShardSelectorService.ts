/**
 * Shard Selector Service for Cross-Pool Router
 * Implements single shard selection per pool to maintain c-properties
 * Ensures no splitting within individual pools during multi-hop swaps
 */

import {
  Pool,
  Token,
  SwapHop,
  CrossPoolRouterConfig
} from './types';

export interface ShardSelectionResult {
  /** Selected shard */
  selectedShard: Pool;
  
  /** Selection reason */
  reason: string;
  
  /** Whether this is the smallest shard */
  isSmallestShard: boolean;
  
  /** Alternative shards considered */
  alternatives: Pool[];
  
  /** Selection confidence (0-1) */
  confidence: number;
}

export interface ShardSelectionCriteria {
  /** Input token for the swap */
  inputToken: Token;
  
  /** Output token for the swap */
  outputToken: Token;
  
  /** Amount to swap */
  swapAmount: bigint;
  
  /** Prefer smallest shards */
  preferSmallest: boolean;
  
  /** Minimum liquidity requirement */
  minLiquidity?: bigint;
  
  /** Maximum price impact tolerance */
  maxPriceImpact?: number;
}

export class ShardSelectorService {
  private config: CrossPoolRouterConfig;
  private selectionStats: {
    totalSelections: number;
    smallestShardSelections: number;
    randomSelections: number;
    avgSelectionTime: number;
  };

  constructor(config: CrossPoolRouterConfig) {
    this.config = config;
    this.selectionStats = {
      totalSelections: 0,
      smallestShardSelections: 0,
      randomSelections: 0,
      avgSelectionTime: 0
    };
  }

  /**
   * Select single optimal shard for a pool in multi-hop swap
   * Implements smallest-shard strategy while maintaining c-properties
   * @param availableShards Array of shards for the same token pair
   * @param criteria Selection criteria
   * @returns Shard selection result
   */
  selectSingleShard(
    availableShards: Pool[],
    criteria: ShardSelectionCriteria
  ): ShardSelectionResult | null {
    const startTime = Date.now();

    try {
      // Validate inputs
      if (availableShards.length === 0) {
        return null;
      }

      // Filter active shards only
      const activeShards = availableShards.filter(shard => 
        shard.status === 'active' && 
        shard.chainId === this.config.chainId
      );

      if (activeShards.length === 0) {
        return null;
      }

      // Filter shards that meet minimum requirements
      const eligibleShards = this.filterEligibleShards(activeShards, criteria);
      
      if (eligibleShards.length === 0) {
        return null;
      }

      // Find smallest shards by deposited amounts (RA values)
      const smallestShards = this.findSmallestShards(eligibleShards, criteria.inputToken);
      
      // Select from smallest shards (random if multiple)
      const selectedShard = this.selectFromSmallestShards(smallestShards);
      
      // Build selection result
      const result: ShardSelectionResult = {
        selectedShard,
        reason: this.buildSelectionReason(smallestShards.length, eligibleShards.length),
        isSmallestShard: true,
        alternatives: smallestShards.filter(s => s.address !== selectedShard.address),
        confidence: this.calculateSelectionConfidence(selectedShard, eligibleShards, criteria)
      };

      // Update statistics
      this.updateSelectionStats(startTime, smallestShards.length > 1);

      return result;

    } catch (error) {
      console.error('Shard selection failed:', error);
      return null;
    }
  }

  /**
   * Validate that a shard can handle the swap without violating c-properties
   * @param shard Shard to validate
   * @param swapAmount Amount to swap
   * @param inputToken Input token
   * @returns Validation result
   */
  validateShardForSwap(
    shard: Pool,
    swapAmount: bigint,
    inputToken: Token
  ): { valid: boolean; reason: string; cThresholdRatio: number } {
    // Get input reserve amount (RA)
    const isTokenA = shard.tokenPair.tokenA.address === inputToken.address;
    const inputReserve = isTokenA ? shard.reserves.tokenA : shard.reserves.tokenB;
    const outputReserve = isTokenA ? shard.reserves.tokenB : shard.reserves.tokenA;

    // Check basic liquidity
    if (inputReserve === BigInt(0) || outputReserve === BigInt(0)) {
      return {
        valid: false,
        reason: 'Shard has no liquidity',
        cThresholdRatio: 0
      };
    }

    // Calculate OA/RA ratio for c-threshold validation
    const ratio = Number(swapAmount) / Number(inputReserve);
    const cThreshold = shard.sammParams.c / 1000000; // Convert from scaled value
    const cThresholdRatio = ratio / cThreshold;

    // Validate c-threshold (OA/RA ≤ c)
    if (ratio > cThreshold) {
      return {
        valid: false,
        reason: `Swap exceeds c-threshold (ratio: ${ratio.toFixed(6)}, threshold: ${cThreshold.toFixed(6)})`,
        cThresholdRatio
      };
    }

    // Check if swap would drain too much liquidity
    const maxOutput = (outputReserve * BigInt(95)) / BigInt(100); // Max 95% of reserve
    if (swapAmount > maxOutput) {
      return {
        valid: false,
        reason: 'Swap would drain too much liquidity from shard',
        cThresholdRatio
      };
    }

    return {
      valid: true,
      reason: 'Shard can handle swap within c-threshold',
      cThresholdRatio
    };
  }

  /**
   * Ensure no splitting occurs within a single pool
   * Validates that the entire swap amount goes to one shard only
   * @param selectedShard The chosen shard
   * @param totalAmount Total amount to swap
   * @param inputToken Input token
   * @returns Validation result
   */
  validateNoSplitting(
    selectedShard: Pool,
    totalAmount: bigint,
    inputToken: Token
  ): { valid: boolean; reason: string } {
    // This is a design validation - in our implementation, we always route
    // the entire amount to a single selected shard, so splitting cannot occur
    
    const validation = this.validateShardForSwap(selectedShard, totalAmount, inputToken);
    
    if (!validation.valid) {
      return {
        valid: false,
        reason: `Cannot route entire amount to single shard: ${validation.reason}`
      };
    }

    return {
      valid: true,
      reason: 'Entire swap amount routed to single shard (no splitting)'
    };
  }

  /**
   * Get shards sorted by size (smallest first) for a given input token
   * @param shards Array of shards to sort
   * @param inputToken Input token to determine reserve size
   * @returns Sorted array of shards
   */
  getSortedShardsBySize(shards: Pool[], inputToken: Token): Pool[] {
    return [...shards].sort((a, b) => {
      const aReserve = this.getInputReserve(a, inputToken);
      const bReserve = this.getInputReserve(b, inputToken);
      return Number(aReserve - bReserve);
    });
  }

  /**
   * Calculate optimal shard distribution for liquidity providers
   * Helps maintain balanced shard sizes according to fillup strategy
   * @param shards Available shards for token pair
   * @param inputToken Token being added
   * @returns Recommended shard for liquidity addition
   */
  recommendShardForLiquidity(
    shards: Pool[],
    inputToken: Token
  ): Pool | null {
    if (shards.length === 0) {
      return null;
    }

    // Filter active shards
    const activeShards = shards.filter(shard => 
      shard.status === 'active' && 
      shard.chainId === this.config.chainId
    );

    if (activeShards.length === 0) {
      return null;
    }

    // Find smallest shard for fillup strategy
    const sortedShards = this.getSortedShardsBySize(activeShards, inputToken);
    return sortedShards[0];
  }

  // Private helper methods

  /**
   * Filter shards that meet eligibility criteria
   */
  private filterEligibleShards(
    shards: Pool[],
    criteria: ShardSelectionCriteria
  ): Pool[] {
    return shards.filter(shard => {
      // Check minimum liquidity if specified
      if (criteria.minLiquidity) {
        const totalLiquidity = shard.reserves.tokenA + shard.reserves.tokenB;
        if (totalLiquidity < criteria.minLiquidity) {
          return false;
        }
      }

      // Validate c-threshold
      const validation = this.validateShardForSwap(
        shard,
        criteria.swapAmount,
        criteria.inputToken
      );
      
      if (!validation.valid) {
        return false;
      }

      // Check price impact if specified
      if (criteria.maxPriceImpact !== undefined) {
        const priceImpact = this.calculatePriceImpact(
          shard,
          criteria.swapAmount,
          criteria.inputToken
        );
        
        if (priceImpact > criteria.maxPriceImpact) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Find shards with smallest deposited amounts (RA values)
   */
  private findSmallestShards(shards: Pool[], inputToken: Token): Pool[] {
    if (shards.length === 0) {
      return [];
    }

    // Find minimum reserve amount
    let minReserve = this.getInputReserve(shards[0], inputToken);
    for (const shard of shards) {
      const reserve = this.getInputReserve(shard, inputToken);
      if (reserve < minReserve) {
        minReserve = reserve;
      }
    }

    // Return all shards with minimum reserve amount
    return shards.filter(shard => 
      this.getInputReserve(shard, inputToken) === minReserve
    );
  }

  /**
   * Select randomly from smallest shards (when multiple have same size)
   */
  private selectFromSmallestShards(smallestShards: Pool[]): Pool {
    if (smallestShards.length === 1) {
      return smallestShards[0];
    }

    // Random selection among equally-sized smallest shards
    const randomIndex = Math.floor(Math.random() * smallestShards.length);
    return smallestShards[randomIndex];
  }

  /**
   * Get input reserve amount for a shard
   */
  private getInputReserve(shard: Pool, inputToken: Token): bigint {
    const isTokenA = shard.tokenPair.tokenA.address === inputToken.address;
    return isTokenA ? shard.reserves.tokenA : shard.reserves.tokenB;
  }

  /**
   * Calculate price impact for a swap
   */
  private calculatePriceImpact(
    shard: Pool,
    swapAmount: bigint,
    inputToken: Token
  ): number {
    const isTokenA = shard.tokenPair.tokenA.address === inputToken.address;
    const inputReserve = isTokenA ? shard.reserves.tokenA : shard.reserves.tokenB;
    const outputReserve = isTokenA ? shard.reserves.tokenB : shard.reserves.tokenA;

    if (inputReserve === BigInt(0) || outputReserve === BigInt(0)) {
      return 100; // Maximum impact if no liquidity
    }

    // Calculate output using constant product formula
    const numerator = outputReserve * swapAmount;
    const denominator = inputReserve + swapAmount;
    const outputAmount = numerator / denominator;

    // Calculate price impact
    const currentPrice = Number(outputReserve) / Number(inputReserve);
    const executionPrice = Number(outputAmount) / Number(swapAmount);
    
    return Math.abs((executionPrice - currentPrice) / currentPrice) * 100;
  }

  /**
   * Build human-readable selection reason
   */
  private buildSelectionReason(
    numSmallestShards: number,
    totalEligibleShards: number
  ): string {
    let reason = 'Selected using smallest-shard strategy';
    
    if (numSmallestShards > 1) {
      reason += ` (randomly selected from ${numSmallestShards} equal-sized smallest shards)`;
    }
    
    reason += `. Maintains c-non-splitting property by routing entire amount to single shard`;
    
    if (totalEligibleShards > numSmallestShards) {
      reason += `. ${totalEligibleShards - numSmallestShards} larger shards were available but not selected`;
    }
    
    return reason;
  }

  /**
   * Calculate confidence in the selection
   */
  private calculateSelectionConfidence(
    selectedShard: Pool,
    allShards: Pool[],
    criteria: ShardSelectionCriteria
  ): number {
    let confidence = 1.0;
    
    // Reduce confidence if many alternatives exist
    if (allShards.length > 5) {
      confidence *= 0.9;
    }
    
    // Reduce confidence for high price impact
    const priceImpact = this.calculatePriceImpact(
      selectedShard,
      criteria.swapAmount,
      criteria.inputToken
    );
    
    if (priceImpact > 2.0) {
      confidence *= 0.8;
    }
    
    // Reduce confidence if close to c-threshold
    const validation = this.validateShardForSwap(
      selectedShard,
      criteria.swapAmount,
      criteria.inputToken
    );
    
    if (validation.cThresholdRatio > 0.8) {
      confidence *= 0.85;
    }
    
    return Math.max(0.1, confidence);
  }

  /**
   * Update selection statistics
   */
  private updateSelectionStats(startTime: number, wasRandomSelection: boolean): void {
    this.selectionStats.totalSelections++;
    this.selectionStats.smallestShardSelections++;
    
    if (wasRandomSelection) {
      this.selectionStats.randomSelections++;
    }
    
    const selectionTime = Date.now() - startTime;
    this.selectionStats.avgSelectionTime = 
      (this.selectionStats.avgSelectionTime + selectionTime) / 2;
  }

  /**
   * Get selection statistics
   */
  getStats() {
    return {
      ...this.selectionStats,
      smallestShardRate: this.selectionStats.totalSelections > 0 
        ? (this.selectionStats.smallestShardSelections / this.selectionStats.totalSelections) * 100
        : 0,
      randomSelectionRate: this.selectionStats.totalSelections > 0
        ? (this.selectionStats.randomSelections / this.selectionStats.totalSelections) * 100
        : 0
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.selectionStats = {
      totalSelections: 0,
      smallestShardSelections: 0,
      randomSelections: 0,
      avgSelectionTime: 0
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<CrossPoolRouterConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}