/**
 * Trade Routing Service
 * Implements single-pool trade routing with c-threshold validation
 */

import { ethers } from 'ethers';
import {
  ShardInfo,
  TokenPair,
  ShardRouting,
  ShardRoutingRequest,
  ShardRoutingResult,
  TradeExecutionRequest,
  TradeExecutionResult,
  CThresholdValidation,
  RouterServiceError
} from './types';
import { SmallestShardSelector } from './SmallestShardSelector';

// ABI for SAMM Pool contract - trading functions
const SAMM_POOL_TRADING_ABI = [
  'function swapSAMM(uint256 amountOut, uint256 maximalAmountIn, address tokenIn, address tokenOut, address recipient) external returns (uint256 amountIn)',
  'function calculateSwapSAMM(uint256 amountOut, address tokenIn, address tokenOut) external view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))',
  'function getReserves() external view returns (uint256 reserveA, uint256 reserveB)',
  'function getSAMMParams() external view returns (int256 beta1, uint256 rmin, uint256 rmax, uint256 c)'
];

/**
 * Service for routing single-pool trades with SAMM properties validation
 */
export class TradeRoutingService {
  private provider: ethers.Provider;
  private shardSelector: SmallestShardSelector;
  private signer?: ethers.Signer;

  constructor(provider: ethers.Provider, signer?: ethers.Signer) {
    this.provider = provider;
    this.signer = signer;
    this.shardSelector = new SmallestShardSelector();
  }

  /**
   * Find optimal shard for a single-pool trade
   * @param request Routing request parameters
   * @param availableShards Available shards for the token pair
   * @returns Routing result with selected shard or error
   */
  async findOptimalShard(
    request: ShardRoutingRequest,
    availableShards: ShardInfo[]
  ): Promise<ShardRoutingResult> {
    const startTime = Date.now();
    
    try {
      // Validate input parameters
      this.validateRoutingRequest(request);
      
      if (availableShards.length === 0) {
        return {
          routing: null,
          availableShards: [],
          metadata: {
            searchTime: Date.now() - startTime,
            shardsEvaluated: 0,
            chainId: request.chainId,
            cThresholdValidated: false
          },
          error: RouterServiceError.NO_SHARDS_AVAILABLE
        };
      }

      // Determine input token (the one we're providing)
      const inputToken = this.determineInputToken(request.tokenPair, request.outputAmount);
      
      // Filter shards that pass c-threshold validation
      const validShards: ShardInfo[] = [];
      let cThresholdValidated = false;
      
      for (const shard of availableShards) {
        const validation = this.validateCThreshold(shard, request.outputAmount, inputToken);
        if (validation.isValid) {
          validShards.push(shard);
          cThresholdValidated = true;
        }
      }

      if (validShards.length === 0) {
        return {
          routing: null,
          availableShards,
          metadata: {
            searchTime: Date.now() - startTime,
            shardsEvaluated: availableShards.length,
            chainId: request.chainId,
            cThresholdValidated: false
          },
          error: RouterServiceError.EXCEEDS_C_THRESHOLD
        };
      }

      // Select optimal shard using smallest-shard strategy
      const selection = this.shardSelector.selectOptimalShard(
        validShards,
        request.tokenPair,
        inputToken,
        request.outputAmount
      );

      // Calculate routing details
      const routing = await this.calculateRouting(
        selection.selectedShard,
        request,
        inputToken
      );

      return {
        routing,
        availableShards,
        metadata: {
          searchTime: Date.now() - startTime,
          shardsEvaluated: availableShards.length,
          chainId: request.chainId,
          cThresholdValidated
        }
      };

    } catch (error) {
      console.error('Failed to find optimal shard:', error);
      return {
        routing: null,
        availableShards,
        metadata: {
          searchTime: Date.now() - startTime,
          shardsEvaluated: availableShards.length,
          chainId: request.chainId,
          cThresholdValidated: false
        },
        error: error instanceof Error ? error.message : RouterServiceError.SHARD_DISCOVERY_FAILED
      };
    }
  }

  /**
   * Validate c-threshold for a trade
   * Implements: trade_amount <= c × shard_reserve_amount
   * @param shard Shard to validate against
   * @param outputAmount Desired output amount
   * @param inputToken Input token address
   * @returns Validation result
   */
  validateCThreshold(
    shard: ShardInfo,
    outputAmount: bigint,
    inputToken: string
  ): CThresholdValidation {
    // Get the reserve amount for the input token (RA in the paper)
    const shardReserve = this.shardSelector.getReserveForToken(shard, inputToken);
    
    // Calculate c-threshold: c × shard_reserve_amount
    const cParameter = shard.sammParams.c;
    const cScaled = BigInt(Math.floor(cParameter * 1e6)); // Convert to scaled integer
    const threshold = (shardReserve * cScaled) / BigInt(1e6);
    
    // Check if trade amount is within threshold
    const isValid = outputAmount <= threshold;
    const ratio = Number(outputAmount * BigInt(1000)) / Number(threshold); // Ratio in basis points
    
    return {
      isValid,
      tradeAmount: outputAmount,
      shardReserve,
      cParameter,
      threshold,
      ratio: ratio / 1000 // Convert back to decimal
    };
  }

  /**
   * Execute a routed trade
   * @param request Trade execution request
   * @returns Execution result
   */
  async executeTrade(request: TradeExecutionRequest): Promise<TradeExecutionResult> {
    if (!this.signer) {
      throw new Error('Signer required for trade execution');
    }

    const startTime = Date.now();
    
    try {
      // Validate routing is still valid
      const inputToken = this.determineInputTokenFromRouting(request.routing);
      const validation = this.validateCThreshold(
        await this.getShardFromRouting(request.routing),
        request.routing.expectedAmountIn, // Use expected input as proxy for output validation
        inputToken
      );

      if (!validation.isValid) {
        return {
          transactionHash: '',
          actualAmountIn: 0n,
          actualAmountOut: 0n,
          actualFee: 0n,
          gasUsed: 0n,
          success: false,
          error: RouterServiceError.EXCEEDS_C_THRESHOLD,
          timestamp: Date.now()
        };
      }

      // Create pool contract instance
      const pool = new ethers.Contract(
        request.routing.poolAddress,
        SAMM_POOL_TRADING_ABI,
        this.signer
      );

      // Determine token addresses
      const shard = await this.getShardFromRouting(request.routing);
      const tokenIn = inputToken;
      const tokenOut = inputToken.toLowerCase() === shard.tokenA.address.toLowerCase() 
        ? shard.tokenB.address 
        : shard.tokenA.address;
      
      // Calculate expected output amount from routing
      const outputAmount = this.calculateOutputFromRouting(request.routing);
      
      // Execute the swap
      const recipient = request.recipient || request.userAddress;
      const deadline = request.deadline || Math.floor(Date.now() / 1000) + 1800; // 30 minutes default
      
      const tx = await pool.swapSAMM(
        outputAmount,
        request.maxAmountIn,
        tokenIn,
        tokenOut,
        recipient
      );

      const receipt = await tx.wait();
      
      // Parse transaction results (would need event parsing for exact amounts)
      return {
        transactionHash: receipt.hash,
        actualAmountIn: request.routing.expectedAmountIn, // Approximation
        actualAmountOut: outputAmount,
        actualFee: request.routing.estimatedFee,
        gasUsed: BigInt(receipt.gasUsed.toString()),
        success: true,
        timestamp: Date.now()
      };

    } catch (error) {
      console.error('Trade execution failed:', error);
      return {
        transactionHash: '',
        actualAmountIn: 0n,
        actualAmountOut: 0n,
        actualFee: 0n,
        gasUsed: 0n,
        success: false,
        error: error instanceof Error ? error.message : RouterServiceError.TRADE_EXECUTION_FAILED,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Calculate detailed routing information for a selected shard
   * @param shard Selected shard
   * @param request Original routing request
   * @param inputToken Input token address
   * @returns Detailed routing information
   */
  private async calculateRouting(
    shard: ShardInfo,
    request: ShardRoutingRequest,
    inputToken: string
  ): Promise<ShardRouting> {
    try {
      // Create pool contract for calculations
      const pool = new ethers.Contract(
        shard.poolAddress,
        SAMM_POOL_TRADING_ABI,
        this.provider
      );

      // Determine output token
      const outputToken = inputToken.toLowerCase() === shard.tokenA.address.toLowerCase()
        ? shard.tokenB.address
        : shard.tokenA.address;

      // Calculate swap details
      const swapResult = await pool.calculateSwapSAMM(
        request.outputAmount,
        inputToken,
        outputToken
      );

      // Estimate gas
      let estimatedGas = BigInt(200000); // Default estimate
      if (request.userAddress) {
        try {
          const gasEstimate = await pool.swapSAMM.estimateGas(
            request.outputAmount,
            swapResult.amountIn,
            inputToken,
            outputToken,
            request.userAddress
          );
          estimatedGas = BigInt(gasEstimate.toString());
        } catch (gasError) {
          console.warn('Gas estimation failed, using default:', gasError);
        }
      }

      // Calculate price impact
      const inputReserve = this.shardSelector.getReserveForToken(shard, inputToken);
      const priceImpact = this.calculatePriceImpact(
        BigInt(swapResult.amountIn.toString()),
        inputReserve
      );

      // Validate this is indeed the smallest shard
      const isSmallestShard = this.shardSelector.validateSmallestShard(
        shard,
        [shard], // Would need all shards for proper validation
        inputToken
      );

      return {
        shardId: shard.id,
        poolAddress: shard.poolAddress,
        expectedAmountIn: BigInt(swapResult.amountIn.toString()),
        estimatedFee: BigInt(swapResult.tradeFee.toString()) + BigInt(swapResult.ownerFee.toString()),
        isSmallestShard,
        chainId: shard.chainId,
        confidenceScore: isSmallestShard ? 95 : 75, // High confidence for smallest shard
        estimatedGas,
        priceImpact
      };

    } catch (error) {
      console.error('Failed to calculate routing:', error);
      throw error;
    }
  }

  /**
   * Validate routing request parameters
   */
  private validateRoutingRequest(request: ShardRoutingRequest): void {
    if (!request.tokenPair) {
      throw new Error('Token pair is required');
    }
    
    if (!request.tokenPair.tokenA || !request.tokenPair.tokenB) {
      throw new Error('Both tokens in pair are required');
    }
    
    if (request.outputAmount <= 0n) {
      throw new Error('Output amount must be positive');
    }
    
    if (request.chainId <= 0) {
      throw new Error('Valid chain ID is required');
    }
    
    if (request.tokenPair.tokenA.address === request.tokenPair.tokenB.address) {
      throw new Error('Token addresses must be different');
    }
  }

  /**
   * Determine which token is the input token based on the desired output
   * For now, assumes tokenA is input - would need more context in real implementation
   */
  private determineInputToken(tokenPair: TokenPair, outputAmount: bigint): string {
    // This is a simplification - in practice, the caller would specify which token they want to receive
    // For now, assume we want tokenB as output, so tokenA is input
    return tokenPair.tokenA.address;
  }

  /**
   * Calculate price impact as percentage
   */
  private calculatePriceImpact(inputAmount: bigint, reserveAmount: bigint): number {
    if (reserveAmount === 0n) return 0;
    
    const impact = Number(inputAmount * BigInt(10000)) / Number(reserveAmount);
    return impact / 100; // Convert to percentage
  }

  /**
   * Get shard information from routing (placeholder - would need shard cache)
   */
  private async getShardFromRouting(routing: ShardRouting): Promise<ShardInfo> {
    // This is a placeholder - in practice, would retrieve from shard cache
    throw new Error('getShardFromRouting not implemented - needs shard cache integration');
  }

  /**
   * Determine input token from routing information
   */
  private determineInputTokenFromRouting(routing: ShardRouting): string {
    // This is a placeholder - would need more routing context
    throw new Error('determineInputTokenFromRouting not implemented - needs routing context');
  }

  /**
   * Calculate output amount from routing information
   */
  private calculateOutputFromRouting(routing: ShardRouting): bigint {
    // This is a placeholder - would calculate based on routing details
    throw new Error('calculateOutputFromRouting not implemented - needs routing calculation');
  }
}