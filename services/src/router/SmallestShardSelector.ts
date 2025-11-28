/**
 * Smallest Shard Selector Service
 * Implements the smallest-shard selection strategy from SAMM research paper
 */

import {
  ShardInfo,
  TokenPair,
  SmallestShardSelection,
  RouterServiceError
} from './types';

/**
 * Service for identifying and selecting the smallest shards according to SAMM properties
 */
export class SmallestShardSelector {
  
  /**
   * Identify shards with smallest deposited amounts (RA values)
   * @param shards Available shards for the token pair
   * @param tokenPair Token pair being traded
   * @param inputToken The token being provided as input
   * @returns Selection result with smallest shard(s)
   */
  identifySmallestShards(
    shards: ShardInfo[],
    tokenPair: TokenPair,
    inputToken: string
  ): SmallestShardSelection {
    if (shards.length === 0) {
      throw new Error(RouterServiceError.NO_SHARDS_AVAILABLE);
    }

    // Determine which reserve to use based on input token
    const getReserveAmount = (shard: ShardInfo): bigint => {
      const inputTokenLower = inputToken.toLowerCase();
      const tokenALower = shard.tokenA.address.toLowerCase();
      
      // Return the reserve of the input token (RA in the paper)
      return inputTokenLower === tokenALower ? shard.reserveA : shard.reserveB;
    };

    // Find the minimum reserve amount
    let minReserveAmount = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'); // Max uint256
    
    for (const shard of shards) {
      const reserveAmount = getReserveAmount(shard);
      if (reserveAmount < minReserveAmount) {
        minReserveAmount = reserveAmount;
      }
    }

    // Find all shards with the minimum reserve amount
    const smallestShards = shards.filter(shard => {
      const reserveAmount = getReserveAmount(shard);
      return reserveAmount === minReserveAmount;
    });

    // Select one shard (random if multiple have same size)
    const selectedShard = this.selectFromSmallestShards(smallestShards);

    const selection: SmallestShardSelection = {
      selectedShard,
      smallestShards,
      selectionMethod: smallestShards.length === 1 ? 'single_smallest' : 'random_among_smallest',
      minReserveAmount,
      selectedAt: Date.now()
    };

    return selection;
  }

  /**
   * Select one shard from multiple smallest shards
   * Uses random selection when multiple shards have equal smallest amounts
   * @param smallestShards Array of shards with equal smallest amounts
   * @returns Selected shard
   */
  private selectFromSmallestShards(smallestShards: ShardInfo[]): ShardInfo {
    if (smallestShards.length === 0) {
      throw new Error(RouterServiceError.NO_SHARDS_AVAILABLE);
    }

    if (smallestShards.length === 1) {
      return smallestShards[0];
    }

    // Random selection among equally-sized smallest shards
    // This implements the dominant strategy from the research paper
    const randomIndex = Math.floor(Math.random() * smallestShards.length);
    return smallestShards[randomIndex];
  }

  /**
   * Validate that a shard is indeed one of the smallest for the given input
   * @param shard Shard to validate
   * @param allShards All available shards
   * @param inputToken Input token address
   * @returns True if shard is among the smallest
   */
  validateSmallestShard(
    shard: ShardInfo,
    allShards: ShardInfo[],
    inputToken: string
  ): boolean {
    try {
      const selection = this.identifySmallestShards(allShards, {
        tokenA: shard.tokenA,
        tokenB: shard.tokenB,
        chainId: shard.chainId
      }, inputToken);

      return selection.smallestShards.some(s => s.id === shard.id);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get reserve amount for a specific token in a shard
   * @param shard Shard to check
   * @param tokenAddress Token address
   * @returns Reserve amount for the token
   */
  getReserveForToken(shard: ShardInfo, tokenAddress: string): bigint {
    const tokenLower = tokenAddress.toLowerCase();
    const tokenALower = shard.tokenA.address.toLowerCase();
    
    return tokenLower === tokenALower ? shard.reserveA : shard.reserveB;
  }

  /**
   * Compare two shards to determine which has smaller reserves for given token
   * @param shardA First shard
   * @param shardB Second shard
   * @param tokenAddress Token to compare reserves for
   * @returns -1 if shardA is smaller, 1 if shardB is smaller, 0 if equal
   */
  compareShardSizes(
    shardA: ShardInfo,
    shardB: ShardInfo,
    tokenAddress: string
  ): number {
    const reserveA = this.getReserveForToken(shardA, tokenAddress);
    const reserveB = this.getReserveForToken(shardB, tokenAddress);

    if (reserveA < reserveB) return -1;
    if (reserveA > reserveB) return 1;
    return 0;
  }

  /**
   * Sort shards by size (smallest first) for a given input token
   * @param shards Shards to sort
   * @param inputToken Input token address
   * @returns Sorted shards (smallest first)
   */
  sortShardsBySize(shards: ShardInfo[], inputToken: string): ShardInfo[] {
    return [...shards].sort((a, b) => {
      const reserveA = this.getReserveForToken(a, inputToken);
      const reserveB = this.getReserveForToken(b, inputToken);
      
      return reserveA < reserveB ? -1 : reserveA > reserveB ? 1 : 0;
    });
  }

  /**
   * Get statistics about shard size distribution
   * @param shards Available shards
   * @param inputToken Input token address
   * @returns Statistics about shard sizes
   */
  getShardSizeStatistics(shards: ShardInfo[], inputToken: string): {
    totalShards: number;
    minReserve: bigint;
    maxReserve: bigint;
    avgReserve: bigint;
    medianReserve: bigint;
    smallestShardsCount: number;
  } {
    if (shards.length === 0) {
      return {
        totalShards: 0,
        minReserve: 0n,
        maxReserve: 0n,
        avgReserve: 0n,
        medianReserve: 0n,
        smallestShardsCount: 0
      };
    }

    const reserves = shards.map(shard => this.getReserveForToken(shard, inputToken));
    reserves.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

    const minReserve = reserves[0];
    const maxReserve = reserves[reserves.length - 1];
    const totalReserve = reserves.reduce((sum, reserve) => sum + reserve, 0n);
    const avgReserve = totalReserve / BigInt(reserves.length);
    const medianReserve = reserves[Math.floor(reserves.length / 2)];
    
    // Count how many shards have the minimum reserve
    const smallestShardsCount = reserves.filter(reserve => reserve === minReserve).length;

    return {
      totalShards: shards.length,
      minReserve,
      maxReserve,
      avgReserve,
      medianReserve,
      smallestShardsCount
    };
  }

  /**
   * Check if shard selection follows SAMM c-smaller-better property
   * Smaller shards should provide better rates when trade is within c-threshold
   * @param selectedShard The shard that was selected
   * @param allShards All available shards
   * @param inputToken Input token address
   * @param tradeAmount Amount being traded
   * @returns True if selection follows c-smaller-better property
   */
  validateCSmallerBetterProperty(
    selectedShard: ShardInfo,
    allShards: ShardInfo[],
    inputToken: string,
    tradeAmount: bigint
  ): boolean {
    const selectedReserve = this.getReserveForToken(selectedShard, inputToken);
    
    // Check c-threshold: tradeAmount <= c * selectedReserve
    const cThreshold = BigInt(Math.floor(selectedShard.sammParams.c * 1e6)); // Convert to scaled
    const maxTradeAmount = (selectedReserve * cThreshold) / BigInt(1e6);
    
    if (tradeAmount > maxTradeAmount) {
      // Trade exceeds c-threshold, c-smaller-better doesn't apply
      return true;
    }

    // For trades within c-threshold, verify this is indeed the smallest shard
    const selection = this.identifySmallestShards(allShards, {
      tokenA: selectedShard.tokenA,
      tokenB: selectedShard.tokenB,
      chainId: selectedShard.chainId
    }, inputToken);

    return selection.smallestShards.some(shard => shard.id === selectedShard.id);
  }

  /**
   * Get the optimal shard for a trade according to SAMM strategy
   * This is the main method that implements the dominant strategy:
   * "Randomly select one of the smallest shards"
   * @param shards Available shards
   * @param tokenPair Token pair being traded
   * @param inputToken Input token address
   * @param tradeAmount Amount being traded (for validation)
   * @returns Selected shard following SAMM strategy
   */
  selectOptimalShard(
    shards: ShardInfo[],
    tokenPair: TokenPair,
    inputToken: string,
    tradeAmount: bigint
  ): SmallestShardSelection {
    // Filter out inactive shards
    const activeShards = shards.filter(shard => shard.status === 'active');
    
    if (activeShards.length === 0) {
      throw new Error(RouterServiceError.NO_SHARDS_AVAILABLE);
    }

    // Identify smallest shards
    const selection = this.identifySmallestShards(activeShards, tokenPair, inputToken);

    // Validate c-smaller-better property
    const isValidSelection = this.validateCSmallerBetterProperty(
      selection.selectedShard,
      activeShards,
      inputToken,
      tradeAmount
    );

    if (!isValidSelection) {
      console.warn('Selected shard does not follow c-smaller-better property');
    }

    return selection;
  }
}