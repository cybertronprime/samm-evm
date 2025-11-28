import { ChainServiceInstances, ChainConfig } from './types';
import { FailureIsolationService } from './FailureIsolationService';

/**
 * Chain Isolation Manager
 * 
 * Ensures complete isolation between chains with no shared state.
 * Each chain operates in its own isolated context.
 */
export class ChainIsolationManager {
  private chainContexts: Map<number, ChainContext> = new Map();
  private failureIsolation: FailureIsolationService;
  private globalSharedState: Set<string> = new Set(); // Track what should NOT be shared

  constructor() {
    this.failureIsolation = new FailureIsolationService();
    this.initializeIsolationRules();
  }

  /**
   * Create isolated context for a chain
   */
  createChainContext(
    chainId: number,
    config: ChainConfig,
    services: ChainServiceInstances
  ): ChainContext {
    // Ensure no existing context
    if (this.chainContexts.has(chainId)) {
      throw new Error(`Chain ${chainId} context already exists`);
    }

    // Create completely isolated context
    const context: ChainContext = {
      chainId,
      config: { ...config }, // Deep copy to prevent shared references
      services,
      state: new Map(), // Isolated state storage
      cache: new Map(), // Isolated cache
      metrics: {
        requestCount: 0,
        errorCount: 0,
        lastActivity: new Date(),
        uptime: 0
      },
      isolation: {
        isIsolated: true,
        sharedStateKeys: new Set(),
        allowedCrossChainOperations: new Set()
      }
    };

    // Initialize failure isolation
    this.failureIsolation.initializeChainIsolation(chainId);

    // Store context with complete isolation
    this.chainContexts.set(chainId, context);

    console.log(`Created isolated context for chain ${chainId}`);
    return context;
  }

  /**
   * Get isolated context for a chain
   */
  getChainContext(chainId: number): ChainContext {
    const context = this.chainContexts.get(chainId);
    if (!context) {
      throw new Error(`Chain ${chainId} context not found`);
    }

    // Verify isolation integrity
    this.verifyIsolationIntegrity(context);

    return context;
  }

  /**
   * Execute operation in isolated chain context
   */
  async executeInChainContext<T>(
    chainId: number,
    operation: (context: ChainContext) => Promise<T>,
    operationName: string
  ): Promise<T> {
    const context = this.getChainContext(chainId);

    // Update metrics
    context.metrics.requestCount++;
    context.metrics.lastActivity = new Date();

    try {
      // Execute with failure isolation
      const result = await this.failureIsolation.executeWithIsolation(
        chainId,
        () => operation(context),
        operationName
      );

      return result;
    } catch (error) {
      context.metrics.errorCount++;
      throw error;
    }
  }

  /**
   * Set chain-specific state (isolated)
   */
  setChainState(chainId: number, key: string, value: any): void {
    const context = this.getChainContext(chainId);
    
    // Ensure key is not in global shared state
    if (this.globalSharedState.has(key)) {
      throw new Error(`Cannot set shared state key '${key}' in chain-specific context`);
    }

    context.state.set(key, value);
  }

  /**
   * Get chain-specific state (isolated)
   */
  getChainState(chainId: number, key: string): any {
    const context = this.getChainContext(chainId);
    return context.state.get(key);
  }

  /**
   * Clear chain-specific state
   */
  clearChainState(chainId: number): void {
    const context = this.getChainContext(chainId);
    context.state.clear();
    context.cache.clear();
    
    console.log(`Cleared state for chain ${chainId}`);
  }

  /**
   * Set chain-specific cache (isolated)
   */
  setChainCache(chainId: number, key: string, value: any, ttl?: number): void {
    const context = this.getChainContext(chainId);
    
    const cacheEntry = {
      value,
      timestamp: Date.now(),
      ttl: ttl || 300000 // 5 minutes default
    };
    
    context.cache.set(key, cacheEntry);
  }

  /**
   * Get chain-specific cache (isolated)
   */
  getChainCache(chainId: number, key: string): any {
    const context = this.getChainContext(chainId);
    const entry = context.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > entry.ttl) {
      context.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Get chain metrics
   */
  getChainMetrics(chainId: number): ChainMetrics {
    const context = this.getChainContext(chainId);
    const errorStats = this.failureIsolation.getChainErrorStats(chainId);
    
    return {
      ...context.metrics,
      isIsolated: errorStats.isIsolated,
      circuitBreakerState: errorStats.circuitBreakerState,
      isolationIntegrity: this.checkIsolationIntegrity(context)
    };
  }

  /**
   * Verify no cross-chain state contamination
   */
  verifyChainIsolation(): IsolationReport {
    const report: IsolationReport = {
      totalChains: this.chainContexts.size,
      isolatedChains: 0,
      contaminatedChains: [],
      sharedStateViolations: [],
      crossChainReferences: []
    };

    for (const [chainId, context] of this.chainContexts) {
      const integrity = this.checkIsolationIntegrity(context);
      
      if (integrity.isIsolated) {
        report.isolatedChains++;
      } else {
        report.contaminatedChains.push({
          chainId,
          violations: integrity.violations
        });
      }

      // Check for shared state violations
      for (const key of context.state.keys()) {
        if (this.globalSharedState.has(key)) {
          report.sharedStateViolations.push({
            chainId,
            key,
            violation: 'Chain-specific state using global key'
          });
        }
      }
    }

    return report;
  }

  /**
   * Remove chain context (cleanup)
   */
  removeChainContext(chainId: number): void {
    const context = this.chainContexts.get(chainId);
    if (!context) {
      return;
    }

    // Clear all chain-specific data
    context.state.clear();
    context.cache.clear();

    // Remove from isolation tracking
    this.failureIsolation.removeChainIsolation(chainId);

    // Remove context
    this.chainContexts.delete(chainId);

    console.log(`Removed isolated context for chain ${chainId}`);
  }

  /**
   * Get all chain contexts (for monitoring)
   */
  getAllChainContexts(): Map<number, ChainContext> {
    // Return copies to prevent external modification
    const contexts = new Map<number, ChainContext>();
    
    for (const [chainId, context] of this.chainContexts) {
      contexts.set(chainId, {
        ...context,
        state: new Map(context.state),
        cache: new Map(context.cache)
      });
    }
    
    return contexts;
  }

  /**
   * Initialize isolation rules
   */
  private initializeIsolationRules(): void {
    // Define what should never be shared between chains
    this.globalSharedState.add('provider');
    this.globalSharedState.add('signer');
    this.globalSharedState.add('contracts');
    this.globalSharedState.add('chainId');
    this.globalSharedState.add('blockNumber');
    this.globalSharedState.add('gasPrice');
    this.globalSharedState.add('nonce');
    this.globalSharedState.add('balance');
    this.globalSharedState.add('transactions');
    this.globalSharedState.add('pools');
    this.globalSharedState.add('shards');
    this.globalSharedState.add('routes');
    this.globalSharedState.add('liquidity');
  }

  /**
   * Verify isolation integrity for a context
   */
  private verifyIsolationIntegrity(context: ChainContext): void {
    const integrity = this.checkIsolationIntegrity(context);
    
    if (!integrity.isIsolated) {
      console.warn(`Isolation integrity violation for chain ${context.chainId}:`, integrity.violations);
    }
  }

  /**
   * Check isolation integrity
   */
  private checkIsolationIntegrity(context: ChainContext): IsolationIntegrity {
    const violations: string[] = [];

    // Check for shared state contamination
    for (const key of context.state.keys()) {
      if (this.globalSharedState.has(key)) {
        violations.push(`Shared state key '${key}' found in chain context`);
      }
    }

    // Check for cross-chain references in services
    if (this.hasCircularReferences(context.services)) {
      violations.push('Circular references detected in services');
    }

    return {
      isIsolated: violations.length === 0,
      violations,
      lastChecked: new Date()
    };
  }

  /**
   * Check for circular references (simplified)
   */
  private hasCircularReferences(obj: any, visited = new Set()): boolean {
    if (visited.has(obj)) {
      return true;
    }

    if (obj && typeof obj === 'object') {
      visited.add(obj);
      
      for (const key in obj) {
        if (this.hasCircularReferences(obj[key], visited)) {
          return true;
        }
      }
      
      visited.delete(obj);
    }

    return false;
  }
}

/**
 * Chain context with complete isolation
 */
interface ChainContext {
  chainId: number;
  config: ChainConfig;
  services: ChainServiceInstances;
  state: Map<string, any>; // Isolated state
  cache: Map<string, CacheEntry>; // Isolated cache
  metrics: ChainContextMetrics;
  isolation: IsolationSettings;
}

/**
 * Cache entry with TTL
 */
interface CacheEntry {
  value: any;
  timestamp: number;
  ttl: number;
}

/**
 * Chain context metrics
 */
interface ChainContextMetrics {
  requestCount: number;
  errorCount: number;
  lastActivity: Date;
  uptime: number;
}

/**
 * Isolation settings
 */
interface IsolationSettings {
  isIsolated: boolean;
  sharedStateKeys: Set<string>;
  allowedCrossChainOperations: Set<string>;
}

/**
 * Extended chain metrics
 */
interface ChainMetrics extends ChainContextMetrics {
  isIsolated: boolean;
  circuitBreakerState: string;
  isolationIntegrity: IsolationIntegrity;
}

/**
 * Isolation integrity check result
 */
interface IsolationIntegrity {
  isIsolated: boolean;
  violations: string[];
  lastChecked: Date;
}

/**
 * Isolation report
 */
interface IsolationReport {
  totalChains: number;
  isolatedChains: number;
  contaminatedChains: Array<{
    chainId: number;
    violations: string[];
  }>;
  sharedStateViolations: Array<{
    chainId: number;
    key: string;
    violation: string;
  }>;
  crossChainReferences: Array<{
    fromChain: number;
    toChain: number;
    reference: string;
  }>;
}