import { ethers } from 'ethers';
import { RouterService } from '../router/RouterService';
import { CrossPoolRouterService } from '../cross-pool-router/CrossPoolRouterService';
import { LiquidityRouterService } from '../liquidity-router/LiquidityRouterService';
import { ChainConfig, ChainHealth, ChainServiceInstances } from './types';
import { ChainConfigManager } from './ChainConfigManager';
import { HealthMonitor } from './HealthMonitor';
import { ChainIsolationManager } from './ChainIsolationManager';
import { FailureIsolationService } from './FailureIsolationService';

/**
 * Multi-Chain Backend Service
 * 
 * Provides isolated backend services for multiple EVM chains.
 * Each chain operates independently with no shared state.
 */
export class MultiChainBackend {
  private chainServices: Map<number, ChainServiceInstances> = new Map();
  private configManager: ChainConfigManager;
  private healthMonitor: HealthMonitor;
  private isolationManager: ChainIsolationManager;
  private failureIsolation: FailureIsolationService;
  private supportedChains: Set<number> = new Set();

  constructor() {
    this.configManager = new ChainConfigManager();
    this.healthMonitor = new HealthMonitor();
    this.isolationManager = new ChainIsolationManager();
    this.failureIsolation = new FailureIsolationService();
  }

  /**
   * Initialize support for a new chain
   */
  async addChain(chainId: number, config: ChainConfig): Promise<void> {
    try {
      // Validate chain configuration
      this.validateChainConfig(config);

      // Create isolated provider for this chain
      const provider = new ethers.JsonRpcProvider(config.rpcEndpoint);

      // Test connection
      await this.testChainConnection(provider, chainId);

      // Create chain-specific service instances
      const services = await this.createChainServices(chainId, config, provider);

      // Store services with complete isolation
      this.chainServices.set(chainId, services);
      this.supportedChains.add(chainId);

      // Register with config manager
      this.configManager.addChainConfig(chainId, config);

      // Create isolated context for this chain
      this.isolationManager.createChainContext(chainId, config, services);

      // Start health monitoring for this chain
      this.healthMonitor.startMonitoring(chainId, provider, services);

      console.log(`Successfully added chain ${chainId} (${config.name})`);
    } catch (error) {
      console.error(`Failed to add chain ${chainId}:`, error);
      throw new Error(`Chain initialization failed: ${error.message}`);
    }
  }

  /**
   * Get chain-specific router service with isolation
   */
  getRouterService(chainId: number): RouterService {
    const context = this.isolationManager.getChainContext(chainId);
    return context.services.routerService;
  }

  /**
   * Get chain-specific cross-pool router with isolation
   */
  getCrossPoolRouter(chainId: number): CrossPoolRouterService {
    const context = this.isolationManager.getChainContext(chainId);
    return context.services.crossPoolRouter;
  }

  /**
   * Get chain-specific liquidity router with isolation
   */
  getLiquidityRouter(chainId: number): LiquidityRouterService {
    const context = this.isolationManager.getChainContext(chainId);
    return context.services.liquidityRouter;
  }

  /**
   * Health check for specific chain
   */
  async checkChainHealth(chainId: number): Promise<ChainHealth> {
    if (!this.supportedChains.has(chainId)) {
      throw new Error(`Chain ${chainId} is not supported`);
    }

    return await this.healthMonitor.getChainHealth(chainId);
  }

  /**
   * Get all supported chains
   */
  getSupportedChains(): number[] {
    return Array.from(this.supportedChains);
  }

  /**
   * Get chain isolation status
   */
  getChainIsolationStatus(chainId: number): any {
    return this.isolationManager.getChainMetrics(chainId);
  }

  /**
   * Verify chain isolation integrity
   */
  verifyChainIsolation(): any {
    return this.isolationManager.verifyChainIsolation();
  }

  /**
   * Execute operation with failure isolation
   */
  async executeWithIsolation<T>(
    chainId: number,
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    return this.isolationManager.executeInChainContext(
      chainId,
      async (context) => operation(),
      operationName
    );
  }

  /**
   * Remove chain support (for maintenance)
   */
  async removeChain(chainId: number): Promise<void> {
    if (!this.supportedChains.has(chainId)) {
      throw new Error(`Chain ${chainId} is not supported`);
    }

    // Stop health monitoring
    this.healthMonitor.stopMonitoring(chainId);

    // Clean up services
    const services = this.chainServices.get(chainId);
    if (services) {
      await this.cleanupChainServices(services);
    }

    // Remove from isolation manager
    this.isolationManager.removeChainContext(chainId);

    // Remove from maps
    this.chainServices.delete(chainId);
    this.supportedChains.delete(chainId);
    this.configManager.removeChainConfig(chainId);

    console.log(`Removed chain ${chainId} support`);
  }

  /**
   * Get chain configuration
   */
  getChainConfig(chainId: number): ChainConfig {
    return this.configManager.getChainConfig(chainId);
  }

  /**
   * Update chain configuration
   */
  async updateChainConfig(chainId: number, config: Partial<ChainConfig>): Promise<void> {
    if (!this.supportedChains.has(chainId)) {
      throw new Error(`Chain ${chainId} is not supported`);
    }

    const currentConfig = this.configManager.getChainConfig(chainId);
    const updatedConfig = { ...currentConfig, ...config };

    // Validate updated configuration
    this.validateChainConfig(updatedConfig);

    // Update configuration
    this.configManager.updateChainConfig(chainId, updatedConfig);

    // If RPC endpoint changed, recreate services
    if (config.rpcEndpoint && config.rpcEndpoint !== currentConfig.rpcEndpoint) {
      await this.recreateChainServices(chainId, updatedConfig);
    }
  }

  /**
   * Get service instances for a chain
   */
  private getChainServices(chainId: number): ChainServiceInstances {
    const services = this.chainServices.get(chainId);
    if (!services) {
      throw new Error(`Chain ${chainId} is not supported or not initialized`);
    }
    return services;
  }

  /**
   * Create isolated service instances for a chain
   */
  private async createChainServices(
    chainId: number,
    config: ChainConfig,
    provider: ethers.JsonRpcProvider
  ): Promise<ChainServiceInstances> {
    // Create completely isolated service instances
    const routerService = new RouterService(chainId, config, provider);
    const crossPoolRouter = new CrossPoolRouterService(chainId, config, provider);
    const liquidityRouter = new LiquidityRouterService(chainId, config, provider);

    // Initialize services
    await Promise.all([
      routerService.initialize(),
      crossPoolRouter.initialize(),
      liquidityRouter.initialize()
    ]);

    return {
      routerService,
      crossPoolRouter,
      liquidityRouter,
      provider,
      config
    };
  }

  /**
   * Validate chain configuration
   */
  private validateChainConfig(config: ChainConfig): void {
    if (!config.chainId || config.chainId <= 0) {
      throw new Error('Invalid chain ID');
    }

    if (!config.name || config.name.trim().length === 0) {
      throw new Error('Chain name is required');
    }

    if (!config.rpcEndpoint || !config.rpcEndpoint.startsWith('http')) {
      throw new Error('Valid RPC endpoint is required');
    }

    if (!config.nativeToken || !config.nativeToken.symbol) {
      throw new Error('Native token configuration is required');
    }

    if (!config.contractAddresses) {
      throw new Error('Contract addresses configuration is required');
    }
  }

  /**
   * Test connection to chain
   */
  private async testChainConnection(provider: ethers.JsonRpcProvider, expectedChainId: number): Promise<void> {
    try {
      const network = await provider.getNetwork();
      const actualChainId = Number(network.chainId);

      if (actualChainId !== expectedChainId) {
        throw new Error(`Chain ID mismatch: expected ${expectedChainId}, got ${actualChainId}`);
      }

      // Test basic RPC functionality
      await provider.getBlockNumber();
    } catch (error) {
      throw new Error(`Failed to connect to chain: ${error.message}`);
    }
  }

  /**
   * Recreate services for a chain (used when config changes)
   */
  private async recreateChainServices(chainId: number, config: ChainConfig): Promise<void> {
    // Clean up existing services
    const existingServices = this.chainServices.get(chainId);
    if (existingServices) {
      await this.cleanupChainServices(existingServices);
    }

    // Create new provider and services
    const provider = new ethers.JsonRpcProvider(config.rpcEndpoint);
    await this.testChainConnection(provider, chainId);

    const newServices = await this.createChainServices(chainId, config, provider);
    this.chainServices.set(chainId, newServices);

    // Restart health monitoring
    this.healthMonitor.stopMonitoring(chainId);
    this.healthMonitor.startMonitoring(chainId, provider, newServices);
  }

  /**
   * Clean up chain services
   */
  private async cleanupChainServices(services: ChainServiceInstances): Promise<void> {
    try {
      // Clean up each service
      await Promise.all([
        services.routerService.cleanup?.(),
        services.crossPoolRouter.cleanup?.(),
        services.liquidityRouter.cleanup?.()
      ]);
    } catch (error) {
      console.error('Error during service cleanup:', error);
    }
  }
}