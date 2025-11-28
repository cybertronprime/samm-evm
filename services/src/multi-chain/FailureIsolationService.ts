import { ChainError, ChainErrorType } from './types';

/**
 * Failure Isolation Service
 * 
 * Ensures that failures on one chain do not affect other chains.
 * Implements circuit breaker pattern and graceful degradation.
 */
export class FailureIsolationService {
  private chainCircuitBreakers: Map<number, CircuitBreaker> = new Map();
  private chainErrorCounts: Map<number, number> = new Map();
  private chainLastErrors: Map<number, ChainError> = new Map();
  private isolationConfig: IsolationConfig;

  constructor(config?: Partial<IsolationConfig>) {
    this.isolationConfig = {
      errorThreshold: 5,
      timeoutThreshold: 30000, // 30 seconds
      recoveryTimeout: 60000, // 1 minute
      maxRetries: 3,
      retryDelay: 1000,
      ...config
    };
  }

  /**
   * Initialize circuit breaker for a chain
   */
  initializeChainIsolation(chainId: number): void {
    if (this.chainCircuitBreakers.has(chainId)) {
      return; // Already initialized
    }

    const circuitBreaker = new CircuitBreaker(chainId, this.isolationConfig);
    this.chainCircuitBreakers.set(chainId, circuitBreaker);
    this.chainErrorCounts.set(chainId, 0);

    console.log(`Initialized failure isolation for chain ${chainId}`);
  }

  /**
   * Execute operation with failure isolation
   */
  async executeWithIsolation<T>(
    chainId: number,
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const circuitBreaker = this.getCircuitBreaker(chainId);
    
    if (circuitBreaker.isOpen()) {
      throw this.createChainError(
        ChainErrorType.SERVICE_UNAVAILABLE,
        chainId,
        `Circuit breaker is open for chain ${chainId}. Service temporarily unavailable.`
      );
    }

    try {
      const result = await this.executeWithTimeout(operation, this.isolationConfig.timeoutThreshold);
      
      // Reset error count on success
      this.resetErrorCount(chainId);
      circuitBreaker.recordSuccess();
      
      return result;
    } catch (error) {
      const chainError = this.handleChainError(chainId, error, operationName);
      circuitBreaker.recordFailure();
      
      throw chainError;
    }
  }

  /**
   * Check if a chain is isolated (circuit breaker open)
   */
  isChainIsolated(chainId: number): boolean {
    const circuitBreaker = this.chainCircuitBreakers.get(chainId);
    return circuitBreaker ? circuitBreaker.isOpen() : false;
  }

  /**
   * Get chain error statistics
   */
  getChainErrorStats(chainId: number): ChainErrorStats {
    const errorCount = this.chainErrorCounts.get(chainId) || 0;
    const lastError = this.chainLastErrors.get(chainId);
    const circuitBreaker = this.chainCircuitBreakers.get(chainId);

    return {
      chainId,
      errorCount,
      lastError,
      isIsolated: circuitBreaker ? circuitBreaker.isOpen() : false,
      circuitBreakerState: circuitBreaker ? circuitBreaker.getState() : 'UNKNOWN'
    };
  }

  /**
   * Manually reset chain isolation (for recovery)
   */
  resetChainIsolation(chainId: number): void {
    const circuitBreaker = this.chainCircuitBreakers.get(chainId);
    if (circuitBreaker) {
      circuitBreaker.reset();
    }
    
    this.resetErrorCount(chainId);
    this.chainLastErrors.delete(chainId);
    
    console.log(`Reset isolation for chain ${chainId}`);
  }

  /**
   * Get all chain error statistics
   */
  getAllChainErrorStats(): Map<number, ChainErrorStats> {
    const stats = new Map<number, ChainErrorStats>();
    
    for (const chainId of this.chainCircuitBreakers.keys()) {
      stats.set(chainId, this.getChainErrorStats(chainId));
    }
    
    return stats;
  }

  /**
   * Remove chain from isolation tracking
   */
  removeChainIsolation(chainId: number): void {
    this.chainCircuitBreakers.delete(chainId);
    this.chainErrorCounts.delete(chainId);
    this.chainLastErrors.delete(chainId);
    
    console.log(`Removed isolation tracking for chain ${chainId}`);
  }

  /**
   * Get circuit breaker for a chain
   */
  private getCircuitBreaker(chainId: number): CircuitBreaker {
    const circuitBreaker = this.chainCircuitBreakers.get(chainId);
    if (!circuitBreaker) {
      throw new Error(`Chain ${chainId} isolation not initialized`);
    }
    return circuitBreaker;
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      operation()
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Handle chain-specific error
   */
  private handleChainError(chainId: number, error: any, operationName: string): ChainError {
    const errorCount = this.incrementErrorCount(chainId);
    
    let errorType = ChainErrorType.SERVICE_UNAVAILABLE;
    
    // Classify error type
    if (error.message?.includes('timeout')) {
      errorType = ChainErrorType.TIMEOUT;
    } else if (error.message?.includes('connection')) {
      errorType = ChainErrorType.CONNECTION_FAILED;
    } else if (error.message?.includes('RPC')) {
      errorType = ChainErrorType.RPC_ERROR;
    } else if (error.message?.includes('contract')) {
      errorType = ChainErrorType.CONTRACT_ERROR;
    }

    const chainError = this.createChainError(
      errorType,
      chainId,
      `${operationName} failed: ${error.message}`,
      { originalError: error, operationName, errorCount }
    );

    // Store last error
    this.chainLastErrors.set(chainId, chainError);
    
    console.error(`Chain ${chainId} error (count: ${errorCount}):`, chainError);
    
    return chainError;
  }

  /**
   * Create chain-specific error
   */
  private createChainError(
    type: ChainErrorType,
    chainId: number,
    message: string,
    context?: any
  ): ChainError {
    const error = new Error(message) as ChainError;
    error.type = type;
    error.chainId = chainId;
    error.context = context;
    error.timestamp = new Date();
    
    return error;
  }

  /**
   * Increment error count for a chain
   */
  private incrementErrorCount(chainId: number): number {
    const currentCount = this.chainErrorCounts.get(chainId) || 0;
    const newCount = currentCount + 1;
    this.chainErrorCounts.set(chainId, newCount);
    return newCount;
  }

  /**
   * Reset error count for a chain
   */
  private resetErrorCount(chainId: number): void {
    this.chainErrorCounts.set(chainId, 0);
  }
}

/**
 * Circuit Breaker implementation for chain isolation
 */
class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private successCount: number = 0;

  constructor(
    private chainId: number,
    private config: IsolationConfig
  ) {}

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.successCount++;
    
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      // If we're in half-open state and got a success, close the circuit
      this.state = CircuitBreakerState.CLOSED;
      this.failureCount = 0;
      console.log(`Circuit breaker closed for chain ${this.chainId} after successful operation`);
    }
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.config.errorThreshold) {
      this.state = CircuitBreakerState.OPEN;
      console.log(`Circuit breaker opened for chain ${this.chainId} after ${this.failureCount} failures`);
    }
  }

  /**
   * Check if circuit breaker is open
   */
  isOpen(): boolean {
    if (this.state === CircuitBreakerState.OPEN) {
      // Check if recovery timeout has passed
      if (Date.now() - this.lastFailureTime >= this.config.recoveryTimeout) {
        this.state = CircuitBreakerState.HALF_OPEN;
        console.log(`Circuit breaker for chain ${this.chainId} moved to half-open state`);
        return false;
      }
      return true;
    }
    
    return false;
  }

  /**
   * Get current circuit breaker state
   */
  getState(): string {
    return CircuitBreakerState[this.state];
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }
}

/**
 * Circuit breaker states
 */
enum CircuitBreakerState {
  CLOSED = 0,
  OPEN = 1,
  HALF_OPEN = 2
}

/**
 * Isolation configuration
 */
interface IsolationConfig {
  errorThreshold: number;
  timeoutThreshold: number;
  recoveryTimeout: number;
  maxRetries: number;
  retryDelay: number;
}

/**
 * Chain error statistics
 */
interface ChainErrorStats {
  chainId: number;
  errorCount: number;
  lastError?: ChainError;
  isIsolated: boolean;
  circuitBreakerState: string;
}