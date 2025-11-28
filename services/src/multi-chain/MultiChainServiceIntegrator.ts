import { MultiChainBackend } from './MultiChainBackend';
import { RouterService } from '../router/RouterService';
import { CrossPoolRouterService } from '../cross-pool-router/CrossPoolRouterService';
import { LiquidityRouterService } from '../liquidity-router/LiquidityRouterService';
import { ChainConfig, ChainServiceInstances } from './types';
import { LoggingService } from './LoggingService';

/**
 * Multi-Chain Service Integrator
 * 
 * Coordinates integration of Router, Cross-Pool Router, and Liquidity Router
 * services for each chain while maintaining complete isolation
 */
export class MultiChainServiceIntegrator {
  private multiChainBackend: MultiChainBackend;
  private logger: LoggingService;
  private serviceCoordination: Map<number, ServiceCoordinator> = new Map();

  constructor(multiChainBackend: MultiChainBackend) {
    this.multiChainBackend = multiChainBackend;
    this.logger = new LoggingService('MultiChainServiceIntegrator');
  }

  /**
   * Integrate all services for a specific chain
   */
  async integrateChainServices(chainId: number): Promise<void> {
    this.logger.info(`Integrating services for chain ${chainId}`);

    try {
      const config = this.multiChainBackend.getChainConfig(chainId);
      
      // Create service coordinator for this chain
      const coordinator = new ServiceCoordinator(chainId, config, this.logger);
      
      // Get chain-specific services
      const routerService = this.multiChainBackend.getRouterService(chainId);
      const crossPoolRouter = this.multiChainBackend.getCrossPoolRouter(chainId);
      const liquidityRouter = this.multiChainBackend.getLiquidityRouter(chainId);

      // Integrate services with coordination
      await coordinator.integrateServices({
        routerService,
        crossPoolRouter,
        liquidityRouter
      });

      // Store coordinator
      this.serviceCoordination.set(chainId, coordinator);

      this.logger.info(`Successfully integrated services for chain ${chainId}`);
    } catch (error) {
      this.logger.error(`Failed to integrate services for chain ${chainId}:`, error);
      throw error;
    }
  }

  /**
   * Get service coordination status for a chain
   */
  getChainCoordinationStatus(chainId: number): CoordinationStatus {
    const coordinator = this.serviceCoordination.get(chainId);
    
    if (!coordinator) {
      return {
        chainId,
        integrated: false,
        services: [],
        lastUpdate: null
      };
    }

    return coordinator.getStatus();
  }

  /**
   * Get coordination status for all chains
   */
  getAllCoordinationStatus(): Map<number, CoordinationStatus> {
    const statuses = new Map<number, CoordinationStatus>();
    
    for (const [chainId, coordinator] of this.serviceCoordination) {
      statuses.set(chainId, coordinator.getStatus());
    }
    
    return statuses;
  }

  /**
   * Remove service coordination for a chain
   */
  async removeChainIntegration(chainId: number): Promise<void> {
    const coordinator = this.serviceCoordination.get(chainId);
    
    if (coordinator) {
      await coordinator.cleanup();
      this.serviceCoordination.delete(chainId);
      this.logger.info(`Removed service integration for chain ${chainId}`);
    }
  }
}

/**
 * Service Coordinator for a specific chain
 */
class ServiceCoordinator {
  private chainId: number;
  private config: ChainConfig;
  private logger: LoggingService;
  private services: Partial<ChainServiceInstances> = {};
  private integrationStatus: CoordinationStatus;

  constructor(chainId: number, config: ChainConfig, logger: LoggingService) {
    this.chainId = chainId;
    this.config = config;
    this.logger = logger;
    this.integrationStatus = {
      chainId,
      integrated: false,
      services: [],
      lastUpdate: null
    };
  }

  /**
   * Integrate services with coordination
   */
  async integrateServices(services: {
    routerService: RouterService;
    crossPoolRouter: CrossPoolRouterService;
    liquidityRouter: LiquidityRouterService;
  }): Promise<void> {
    this.logger.info(`Coordinating services for chain ${this.chainId}`);

    try {
      // Store service references
      this.services = services;

      // Set up service coordination
      await this.setupServiceCoordination();

      // Update integration status
      this.integrationStatus = {
        chainId: this.chainId,
        integrated: true,
        services: ['router', 'cross-pool-router', 'liquidity-router'],
        lastUpdate: new Date(),
        coordination: {
          routerToLiquidity: 'ACTIVE',
          crossPoolToRouter: 'ACTIVE',
          liquidityToRouter: 'ACTIVE'
        }
      };

      this.logger.info(`Service coordination established for chain ${this.chainId}`);
    } catch (error) {
      this.logger.error(`Service coordination failed for chain ${this.chainId}:`, error);
      throw error;
    }
  }

  /**
   * Setup coordination between services
   */
  private async setupServiceCoordination(): Promise<void> {
    // Router Service ↔ Liquidity Router coordination
    if (this.services.routerService && this.services.liquidityRouter) {
      this.setupRouterLiquidityCoordination();
    }

    // Cross-Pool Router ↔ Router Service coordination
    if (this.services.crossPoolRouter && this.services.routerService) {
      this.setupCrossPoolRouterCoordination();
    }

    // Liquidity Router ↔ Router Service coordination
    if (this.services.liquidityRouter && this.services.routerService) {
      this.setupLiquidityRouterCoordination();
    }
  }

  /**
   * Setup Router ↔ Liquidity Router coordination
   */
  private setupRouterLiquidityCoordination(): void {
    // Router service can query liquidity router for shard recommendations
    // Liquidity router can use router service for shard discovery
    
    this.logger.debug(`Router-Liquidity coordination setup for chain ${this.chainId}`);
  }

  /**
   * Setup Cross-Pool Router ↔ Router Service coordination
   */
  private setupCrossPoolRouterCoordination(): void {
    // Cross-pool router uses router service for single-pool routing
    // Router service provides shard selection for cross-pool paths
    
    this.logger.debug(`Cross-Pool-Router coordination setup for chain ${this.chainId}`);
  }

  /**
   * Setup Liquidity Router ↔ Router Service coordination
   */
  private setupLiquidityRouterCoordination(): void {
    // Liquidity router uses router service for shard discovery
    // Router service can inform liquidity router of shard changes
    
    this.logger.debug(`Liquidity-Router coordination setup for chain ${this.chainId}`);
  }

  /**
   * Get coordination status
   */
  getStatus(): CoordinationStatus {
    return { ...this.integrationStatus };
  }

  /**
   * Cleanup coordination
   */
  async cleanup(): Promise<void> {
    this.logger.info(`Cleaning up service coordination for chain ${this.chainId}`);
    
    // Clean up any coordination resources
    this.services = {};
    this.integrationStatus.integrated = false;
    this.integrationStatus.lastUpdate = new Date();
  }
}

/**
 * Coordination status interface
 */
interface CoordinationStatus {
  chainId: number;
  integrated: boolean;
  services: string[];
  lastUpdate: Date | null;
  coordination?: {
    routerToLiquidity: 'ACTIVE' | 'INACTIVE' | 'ERROR';
    crossPoolToRouter: 'ACTIVE' | 'INACTIVE' | 'ERROR';
    liquidityToRouter: 'ACTIVE' | 'INACTIVE' | 'ERROR';
  };
}