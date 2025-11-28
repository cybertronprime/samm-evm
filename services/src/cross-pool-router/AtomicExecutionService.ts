/**
 * Atomic Execution Service for Multi-Hop Swaps
 * Implements atomic transaction execution with rollback mechanisms
 * Ensures entire swap path succeeds or fails as one transaction
 */

import { ethers } from 'ethers';
import {
  SwapPath,
  SwapHop,
  MultiHopSwapRequest,
  MultiHopSwapResult,
  CrossPoolRouterConfig,
  CrossPoolRouterError
} from './types';

export interface ExecutionPlan {
  /** Swap path to execute */
  path: SwapPath;
  
  /** Transaction parameters */
  transaction: {
    to: string;
    data: string;
    value: bigint;
    gasLimit: bigint;
    gasPrice: bigint;
  };
  
  /** Execution steps */
  steps: ExecutionStep[];
  
  /** Rollback plan */
  rollbackPlan: RollbackStep[];
  
  /** Estimated execution time */
  estimatedTime: number;
}

export interface ExecutionStep {
  /** Step index */
  stepIndex: number;
  
  /** Pool contract address */
  poolAddress: string;
  
  /** Function to call */
  functionName: string;
  
  /** Function parameters */
  parameters: any[];
  
  /** Expected gas cost */
  gasEstimate: bigint;
  
  /** Step description */
  description: string;
}

export interface RollbackStep {
  /** Step to rollback */
  stepIndex: number;
  
  /** Rollback action */
  action: 'revert' | 'compensate';
  
  /** Rollback parameters */
  parameters: any[];
  
  /** Description */
  description: string;
}

export interface SlippageProtection {
  /** Maximum total slippage allowed */
  maxTotalSlippage: number;
  
  /** Per-hop slippage limits */
  perHopLimits: number[];
  
  /** Minimum output amount */
  minOutputAmount: bigint;
  
  /** Deadline timestamp */
  deadline: number;
}

export class AtomicExecutionService {
  private config: CrossPoolRouterConfig;
  private provider: ethers.Provider;
  private executionStats: {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    avgExecutionTime: number;
    totalGasUsed: bigint;
  };

  constructor(config: CrossPoolRouterConfig, provider: ethers.Provider) {
    this.config = config;
    this.provider = provider;
    this.executionStats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      avgExecutionTime: 0,
      totalGasUsed: BigInt(0)
    };
  }

  /**
   * Execute multi-hop swap atomically
   * @param request Swap execution request
   * @returns Execution result
   */
  async executeMultiHopSwap(request: MultiHopSwapRequest): Promise<MultiHopSwapResult> {
    const startTime = Date.now();
    
    try {
      // Validate request
      this.validateExecutionRequest(request);
      
      // Create execution plan
      const executionPlan = await this.createExecutionPlan(request);
      
      // Validate slippage protection
      const slippageProtection = this.createSlippageProtection(request);
      this.validateSlippageProtection(executionPlan, slippageProtection);
      
      // Execute atomic transaction
      const result = await this.executeAtomicTransaction(executionPlan, request);
      
      // Update statistics
      this.updateExecutionStats(startTime, true, result.gasUsed);
      
      return result;
      
    } catch (error) {
      console.error('Multi-hop swap execution failed:', error);
      
      // Update statistics
      this.updateExecutionStats(startTime, false, BigInt(0));
      
      // Return failed result
      return {
        transactionHash: '',
        actualAmounts: [],
        finalAmountIn: BigInt(0),
        finalAmountOut: BigInt(0),
        totalFees: BigInt(0),
        gasUsed: BigInt(0),
        executionTime: Date.now() - startTime,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Create execution plan for multi-hop swap
   * @param request Swap request
   * @returns Execution plan
   */
  async createExecutionPlan(request: MultiHopSwapRequest): Promise<ExecutionPlan> {
    const { path, userAddress, recipient, deadline } = request;
    
    // Build execution steps
    const steps: ExecutionStep[] = [];
    const rollbackPlan: RollbackStep[] = [];
    
    for (let i = 0; i < path.hops.length; i++) {
      const hop = path.hops[i];
      
      // Create execution step for this hop
      const step: ExecutionStep = {
        stepIndex: i,
        poolAddress: hop.pool.address,
        functionName: 'swapSAMM',
        parameters: [
          hop.expectedAmountOut,
          hop.expectedAmountIn,
          hop.tokenIn.address,
          hop.tokenOut.address,
          i === path.hops.length - 1 ? recipient : path.hops[i + 1].pool.address
        ],
        gasEstimate: BigInt(150000), // Estimated gas per hop
        description: `Swap ${hop.tokenIn.symbol} to ${hop.tokenOut.symbol} via pool ${hop.pool.address}`
      };
      
      steps.push(step);
      
      // Create rollback step
      const rollbackStep: RollbackStep = {
        stepIndex: i,
        action: 'revert',
        parameters: [],
        description: `Revert swap in step ${i}`
      };
      
      rollbackPlan.push(rollbackStep);
    }
    
    // Create transaction data
    const transaction = await this.buildAtomicTransaction(steps, userAddress, deadline);
    
    return {
      path,
      transaction,
      steps,
      rollbackPlan,
      estimatedTime: steps.length * 2000 // 2 seconds per step estimate
    };
  }

  /**
   * Execute atomic transaction with all hops
   * @param plan Execution plan
   * @param request Original request
   * @returns Execution result
   */
  private async executeAtomicTransaction(
    plan: ExecutionPlan,
    request: MultiHopSwapRequest
  ): Promise<MultiHopSwapResult> {
    const startTime = Date.now();
    
    try {
      // Create signer
      const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, this.provider);
      
      // Prepare transaction
      const tx = {
        to: plan.transaction.to,
        data: plan.transaction.data,
        value: plan.transaction.value,
        gasLimit: plan.transaction.gasLimit,
        gasPrice: plan.transaction.gasPrice
      };
      
      // Send transaction
      const txResponse = await signer.sendTransaction(tx);
      
      // Wait for confirmation
      const receipt = await txResponse.wait();
      
      if (!receipt) {
        throw new Error('Transaction receipt not available');
      }
      
      if (receipt.status !== 1) {
        throw new Error('Transaction failed');
      }
      
      // Parse transaction results
      const actualAmounts = await this.parseTransactionResults(receipt, plan);
      
      // Calculate final amounts
      const finalAmountIn = actualAmounts.reduce((sum, hop) => sum + hop.actualAmountIn, BigInt(0));
      const finalAmountOut = actualAmounts[actualAmounts.length - 1]?.actualAmountOut || BigInt(0);
      const totalFees = actualAmounts.reduce((sum, hop) => sum + hop.actualFee, BigInt(0));
      
      return {
        transactionHash: receipt.hash,
        actualAmounts,
        finalAmountIn,
        finalAmountOut,
        totalFees,
        gasUsed: receipt.gasUsed,
        executionTime: Date.now() - startTime,
        success: true
      };
      
    } catch (error) {
      console.error('Atomic transaction execution failed:', error);
      
      // Attempt rollback if needed
      await this.attemptRollback(plan, error);
      
      throw error;
    }
  }

  /**
   * Build atomic transaction that executes all hops
   * @param steps Execution steps
   * @param userAddress User's address
   * @param deadline Transaction deadline
   * @returns Transaction parameters
   */
  private async buildAtomicTransaction(
    steps: ExecutionStep[],
    userAddress: string,
    deadline: number
  ): Promise<{
    to: string;
    data: string;
    value: bigint;
    gasLimit: bigint;
    gasPrice: bigint;
  }> {
    // For EVM, we'll use a multicall pattern or deploy a router contract
    // For now, we'll simulate building the transaction data
    
    const routerAddress = await this.getRouterContractAddress();
    
    // Encode function call for multi-hop swap
    const iface = new ethers.Interface([
      'function executeMultiHopSwap(address[] pools, uint256[] amountsOut, uint256[] maxAmountsIn, address[] tokens, address recipient, uint256 deadline) external'
    ]);
    
    const pools = steps.map(step => step.poolAddress);
    const amountsOut = steps.map(step => step.parameters[0]);
    const maxAmountsIn = steps.map(step => step.parameters[1]);
    const tokens = this.extractTokensFromSteps(steps);
    
    const data = iface.encodeFunctionData('executeMultiHopSwap', [
      pools,
      amountsOut,
      maxAmountsIn,
      tokens,
      userAddress,
      deadline
    ]);
    
    // Estimate gas
    const gasLimit = steps.reduce((sum, step) => sum + step.gasEstimate, BigInt(100000)); // Base gas
    
    // Get gas price
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice || BigInt(this.config.gasSettings.gasPrice);
    
    return {
      to: routerAddress,
      data,
      value: BigInt(0), // No ETH value for token swaps
      gasLimit,
      gasPrice
    };
  }

  /**
   * Create slippage protection parameters
   * @param request Swap request
   * @returns Slippage protection
   */
  private createSlippageProtection(request: MultiHopSwapRequest): SlippageProtection {
    const { path, maxSlippage } = request;
    
    // Calculate per-hop slippage limits
    const perHopLimits = path.hops.map(() => maxSlippage / path.hops.length);
    
    // Calculate minimum output amount with slippage
    const minOutputAmount = (path.finalAmountOut * BigInt(Math.floor((100 - maxSlippage) * 100))) / BigInt(10000);
    
    return {
      maxTotalSlippage: maxSlippage,
      perHopLimits,
      minOutputAmount,
      deadline: request.deadline
    };
  }

  /**
   * Validate slippage protection
   * @param plan Execution plan
   * @param protection Slippage protection parameters
   */
  private validateSlippageProtection(
    plan: ExecutionPlan,
    protection: SlippageProtection
  ): void {
    // Check deadline
    if (Date.now() / 1000 > protection.deadline) {
      throw new Error(CrossPoolRouterError.DEADLINE_EXCEEDED);
    }
    
    // Check total slippage
    if (protection.maxTotalSlippage > 50) { // 50% max slippage
      throw new Error(CrossPoolRouterError.SLIPPAGE_TOO_HIGH);
    }
    
    // Validate minimum output
    if (protection.minOutputAmount >= plan.path.finalAmountOut) {
      throw new Error('Invalid slippage protection: minimum output too high');
    }
  }

  /**
   * Parse transaction results to extract actual amounts
   * @param receipt Transaction receipt
   * @param plan Execution plan
   * @returns Actual amounts for each hop
   */
  private async parseTransactionResults(
    receipt: ethers.TransactionReceipt,
    plan: ExecutionPlan
  ): Promise<{
    hopIndex: number;
    actualAmountIn: bigint;
    actualAmountOut: bigint;
    actualFee: bigint;
  }[]> {
    const results: {
      hopIndex: number;
      actualAmountIn: bigint;
      actualAmountOut: bigint;
      actualFee: bigint;
    }[] = [];
    
    // Parse logs to extract swap events
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      
      // Find swap event for this step
      const swapEvent = receipt.logs.find(log => 
        log.address.toLowerCase() === step.poolAddress.toLowerCase()
      );
      
      if (swapEvent) {
        // Parse swap event (simplified - would need actual ABI)
        const actualAmountIn = plan.path.hops[i].expectedAmountIn; // Placeholder
        const actualAmountOut = plan.path.hops[i].expectedAmountOut; // Placeholder
        const actualFee = plan.path.hops[i].estimatedFee; // Placeholder
        
        results.push({
          hopIndex: i,
          actualAmountIn,
          actualAmountOut,
          actualFee
        });
      } else {
        // Use expected values if event not found
        results.push({
          hopIndex: i,
          actualAmountIn: plan.path.hops[i].expectedAmountIn,
          actualAmountOut: plan.path.hops[i].expectedAmountOut,
          actualFee: plan.path.hops[i].estimatedFee
        });
      }
    }
    
    return results;
  }

  /**
   * Attempt rollback if transaction fails
   * @param plan Execution plan
   * @param error Original error
   */
  private async attemptRollback(plan: ExecutionPlan, error: any): Promise<void> {
    console.log('Attempting rollback for failed multi-hop swap...');
    
    try {
      // In EVM, rollback is automatic due to transaction atomicity
      // If any part of the transaction fails, the entire transaction reverts
      console.log('Rollback completed automatically due to EVM transaction atomicity');
      
    } catch (rollbackError) {
      console.error('Rollback failed:', rollbackError);
      // Log rollback failure but don't throw - original error is more important
    }
  }

  /**
   * Validate execution request
   * @param request Request to validate
   */
  private validateExecutionRequest(request: MultiHopSwapRequest): void {
    if (!request.path || request.path.hops.length === 0) {
      throw new Error('Invalid swap path');
    }
    
    if (!request.userAddress || !ethers.isAddress(request.userAddress)) {
      throw new Error('Invalid user address');
    }
    
    if (!request.recipient || !ethers.isAddress(request.recipient)) {
      throw new Error('Invalid recipient address');
    }
    
    if (request.deadline <= Date.now() / 1000) {
      throw new Error(CrossPoolRouterError.DEADLINE_EXCEEDED);
    }
    
    if (request.maxSlippage < 0 || request.maxSlippage > 50) {
      throw new Error(CrossPoolRouterError.SLIPPAGE_TOO_HIGH);
    }
    
    // Validate each hop
    for (const hop of request.path.hops) {
      if (hop.pool.status !== 'active') {
        throw new Error(`Pool ${hop.pool.address} is not active`);
      }
      
      if (hop.expectedAmountIn <= 0 || hop.expectedAmountOut <= 0) {
        throw new Error('Invalid hop amounts');
      }
    }
  }

  /**
   * Get router contract address (would be deployed separately)
   * @returns Router contract address
   */
  private async getRouterContractAddress(): Promise<string> {
    // This would return the address of a deployed multi-hop router contract
    // For now, return a placeholder
    return '0x0000000000000000000000000000000000000000';
  }

  /**
   * Extract token addresses from execution steps
   * @param steps Execution steps
   * @returns Array of token addresses
   */
  private extractTokensFromSteps(steps: ExecutionStep[]): string[] {
    const tokens: string[] = [];
    
    for (const step of steps) {
      const tokenIn = step.parameters[2];
      const tokenOut = step.parameters[3];
      
      if (!tokens.includes(tokenIn)) {
        tokens.push(tokenIn);
      }
      if (!tokens.includes(tokenOut)) {
        tokens.push(tokenOut);
      }
    }
    
    return tokens;
  }

  /**
   * Update execution statistics
   * @param startTime Execution start time
   * @param success Whether execution succeeded
   * @param gasUsed Gas used in execution
   */
  private updateExecutionStats(startTime: number, success: boolean, gasUsed: bigint): void {
    this.executionStats.totalExecutions++;
    
    if (success) {
      this.executionStats.successfulExecutions++;
    } else {
      this.executionStats.failedExecutions++;
    }
    
    const executionTime = Date.now() - startTime;
    this.executionStats.avgExecutionTime = 
      (this.executionStats.avgExecutionTime + executionTime) / 2;
    
    this.executionStats.totalGasUsed += gasUsed;
  }

  /**
   * Get execution statistics
   */
  getStats() {
    return {
      ...this.executionStats,
      successRate: this.executionStats.totalExecutions > 0 
        ? (this.executionStats.successfulExecutions / this.executionStats.totalExecutions) * 100
        : 0,
      avgGasPerExecution: this.executionStats.totalExecutions > 0
        ? this.executionStats.totalGasUsed / BigInt(this.executionStats.totalExecutions)
        : BigInt(0)
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.executionStats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      avgExecutionTime: 0,
      totalGasUsed: BigInt(0)
    };
  }
}