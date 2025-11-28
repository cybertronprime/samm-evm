/**
 * Cross-Pool Router Service Entry Point
 * Main service that combines all components and provides a unified interface
 */

import { ethers } from 'ethers';
import { PathDiscoveryService } from './PathDiscoveryService';
import { ShardSelectorService } from './ShardSelectorService';
import { AtomicExecutionService } from './AtomicExecutionService';
import { CrossPoolRouterAPI, APIConfig } from './CrossPoolRouterAPI';
import { CrossPoolRouterSDK } from './CrossPoolRouterSDK';
import {
  CrossPoolRouterConfig,
  PathDiscoveryRequest,
  MultiHopSwapRequest,
  Pool,
  Token,
  SwapPath
} from './types';

export class CrossPoolRouterService {
  private config: CrossPoolRouterConfig;
  private provider: ethers.Provider;
  private pathDiscovery: PathDiscoveryService;
  private shardSelector: ShardSelectorService;
  private atomicExecution: AtomicExecutionService;
  private api?: CrossPoolRouterAPI;

  constructor(config: CrossPoolRouterConfig, provider: ethers.Provider) {
    this.config = config;
    this.provider = provider;
    
    // Initialize core services
    this.pathDiscovery = new PathDiscoveryService(config);
    this.shardSelector = new ShardSelectorService(config);
    this.atomicExecution = new AtomicExecutionService(config, provider);
  }

  /**
   * Initialize the service with pool data
   */
  async initialize(pools: Pool[]): Promise<void> {
    console.log(`Initializing Cross-Pool Router for chain ${this.config.chainId}`);
    console.log(`Loading ${pools.length} pools...`);
    
    // Update token graph with pool data
    this.pathDiscovery.updateTokenGraph(pools);
    
    console.log('Cross-Pool Router initialized successfully');
  }

  /**
   * Start the HTTP API server
   */
  async startAPI(apiConfig: APIConfig): Promise<void> {
    this.api = new CrossPoolRouterAPI(apiConfig, this.config, this.provider);
    await this.api.start();
  }

  /**
   * Discover optimal paths for multi-hop swaps
   */
  async discoverPaths(request: PathDiscoveryRequest) {
    return await this.pathDiscovery.discoverPaths(request);
  }

  /**
   * Execute multi-hop swap
   */
  async executeMultiHopSwap(request: MultiHopSwapRequest) {
    return await this.atomicExecution.executeMultiHopSwap(request);
  }

  /**
   * Get available token pairs
   */
  getAvailableTokenPairs() {
    return this.pathDiscovery.getAvailableTokenPairs();
  }

  /**
   * Update pool data
   */
  updatePools(pools: Pool[]): void {
    this.pathDiscovery.updateTokenGraph(pools);
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      pathDiscovery: this.pathDiscovery.getStats(),
      shardSelector: this.shardSelector.getStats(),
      atomicExecution: this.atomicExecution.getStats(),
      config: this.config
    };
  }

  /**
   * Validate a swap path
   */
  validatePath(path: SwapPath) {
    return this.pathDiscovery.validatePath(path);
  }

  /**
   * Get Express app instance (if API is running)
   */
  getApp() {
    return this.api?.getApp();
  }
}

// Factory function for easy service creation
export function createCrossPoolRouter(
  config: CrossPoolRouterConfig,
  provider: ethers.Provider
): CrossPoolRouterService {
  return new CrossPoolRouterService(config, provider);
}

// Export all types and classes
export * from './types';
export { PathDiscoveryService } from './PathDiscoveryService';
export { ShardSelectorService } from './ShardSelectorService';
export { AtomicExecutionService } from './AtomicExecutionService';
export { CrossPoolRouterAPI } from './CrossPoolRouterAPI';
export { CrossPoolRouterSDK } from './CrossPoolRouterSDK';

// Default export
export default CrossPoolRouterService;