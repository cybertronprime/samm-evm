/**
 * Cross-Pool Router REST API
 * Provides HTTP endpoints for multi-hop swap path discovery and execution
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ethers } from 'ethers';

import { PathDiscoveryService } from './PathDiscoveryService';
import { ShardSelectorService } from './ShardSelectorService';
import { AtomicExecutionService } from './AtomicExecutionService';
import {
  CrossPoolRouterConfig,
  PathDiscoveryRequest,
  MultiHopSwapRequest,
  CrossPoolRouterError,
  Token,
  SwapPath
} from './types';

export interface APIConfig {
  port: number;
  corsOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  enableLogging: boolean;
}

export class CrossPoolRouterAPI {
  private app: express.Application;
  private config: APIConfig;
  private routerConfig: CrossPoolRouterConfig;
  private pathDiscovery: PathDiscoveryService;
  private shardSelector: ShardSelectorService;
  private atomicExecution: AtomicExecutionService;
  private provider: ethers.Provider;

  constructor(
    apiConfig: APIConfig,
    routerConfig: CrossPoolRouterConfig,
    provider: ethers.Provider
  ) {
    this.config = apiConfig;
    this.routerConfig = routerConfig;
    this.provider = provider;
    
    // Initialize services
    this.pathDiscovery = new PathDiscoveryService(routerConfig);
    this.shardSelector = new ShardSelectorService(routerConfig);
    this.atomicExecution = new AtomicExecutionService(routerConfig, provider);
    
    // Initialize Express app
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet());
    
    // CORS configuration
    this.app.use(cors({
      origin: this.config.corsOrigins,
      credentials: true
    }));
    
    // Rate limiting
    const limiter = rateLimit({
      windowMs: this.config.rateLimitWindowMs,
      max: this.config.rateLimitMaxRequests,
      message: {
        error: 'Too many requests',
        retryAfter: this.config.rateLimitWindowMs / 1000
      }
    });
    this.app.use(limiter);
    
    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // Request logging
    if (this.config.enableLogging) {
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
        next();
      });
    }
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', this.handleHealthCheck.bind(this));
    
    // Path discovery endpoints
    this.app.post('/api/v1/paths/discover', this.handlePathDiscovery.bind(this));
    this.app.get('/api/v1/paths/token-pairs', this.handleGetTokenPairs.bind(this));
    
    // Swap execution endpoints
    this.app.post('/api/v1/swaps/execute', this.handleExecuteSwap.bind(this));
    this.app.post('/api/v1/swaps/quote', this.handleQuoteSwap.bind(this));
    
    // Pool management endpoints
    this.app.post('/api/v1/pools/update', this.handleUpdatePools.bind(this));
    this.app.get('/api/v1/pools/stats', this.handleGetPoolStats.bind(this));
    
    // Router statistics
    this.app.get('/api/v1/router/stats', this.handleGetRouterStats.bind(this));
    this.app.post('/api/v1/router/config', this.handleUpdateConfig.bind(this));
  }

  /**
   * Setup error handling middleware
   */
  private setupErrorHandling(): void {
    // 404 handler
    this.app.use('*', (req: Request, res: Response) => {
      res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl,
        method: req.method
      });
    });
    
    // Global error handler
    this.app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
      console.error('API Error:', error);
      
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    });
  }

  /**
   * Health check endpoint
   */
  private async handleHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        network: {
          chainId: Number(network.chainId),
          name: network.name,
          blockNumber
        },
        services: {
          pathDiscovery: 'active',
          shardSelector: 'active',
          atomicExecution: 'active'
        }
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Path discovery endpoint
   */
  private async handlePathDiscovery(req: Request, res: Response): Promise<void> {
    try {
      const request = this.validatePathDiscoveryRequest(req.body);
      const result = await this.pathDiscovery.discoverPaths(request);
      
      res.json({
        success: true,
        data: {
          paths: result.paths,
          bestPath: result.bestPath,
          metadata: result.metadata
        }
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Get available token pairs endpoint
   */
  private async handleGetTokenPairs(req: Request, res: Response): Promise<void> {
    try {
      const tokenPairs = this.pathDiscovery.getAvailableTokenPairs();
      
      res.json({
        success: true,
        data: {
          tokenPairs,
          count: tokenPairs.length
        }
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Execute multi-hop swap endpoint
   */
  private async handleExecuteSwap(req: Request, res: Response): Promise<void> {
    try {
      const request = this.validateSwapExecutionRequest(req.body);
      const result = await this.atomicExecution.executeMultiHopSwap(request);
      
      res.json({
        success: result.success,
        data: result
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Quote swap endpoint (dry run)
   */
  private async handleQuoteSwap(req: Request, res: Response): Promise<void> {
    try {
      const request = this.validatePathDiscoveryRequest(req.body);
      const result = await this.pathDiscovery.discoverPaths(request);
      
      if (result.bestPath) {
        // Validate the best path
        const validation = this.pathDiscovery.validatePath(result.bestPath);
        
        res.json({
          success: true,
          data: {
            path: result.bestPath,
            validation,
            estimatedGas: result.bestPath.estimatedGas,
            totalFees: result.bestPath.totalFees,
            priceImpact: result.bestPath.totalPriceImpact
          }
        });
      } else {
        res.json({
          success: false,
          error: CrossPoolRouterError.NO_PATH_FOUND,
          message: 'No valid path found for the requested swap'
        });
      }
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Update pools endpoint
   */
  private async handleUpdatePools(req: Request, res: Response): Promise<void> {
    try {
      const { pools } = req.body;
      
      if (!Array.isArray(pools)) {
        throw new Error('Pools must be an array');
      }
      
      this.pathDiscovery.updateTokenGraph(pools);
      
      res.json({
        success: true,
        message: `Updated ${pools.length} pools`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Get pool statistics endpoint
   */
  private async handleGetPoolStats(req: Request, res: Response): Promise<void> {
    try {
      const tokenPairs = this.pathDiscovery.getAvailableTokenPairs();
      const discoveryStats = this.pathDiscovery.getStats();
      
      res.json({
        success: true,
        data: {
          totalTokenPairs: tokenPairs.length,
          discoveryStats,
          chainId: this.routerConfig.chainId
        }
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Get router statistics endpoint
   */
  private async handleGetRouterStats(req: Request, res: Response): Promise<void> {
    try {
      const pathStats = this.pathDiscovery.getStats();
      const selectorStats = this.shardSelector.getStats();
      const executionStats = this.atomicExecution.getStats();
      
      res.json({
        success: true,
        data: {
          pathDiscovery: pathStats,
          shardSelector: selectorStats,
          atomicExecution: executionStats,
          config: {
            chainId: this.routerConfig.chainId,
            maxHops: this.routerConfig.maxHops,
            maxPaths: this.routerConfig.maxPaths
          }
        }
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Update router configuration endpoint
   */
  private async handleUpdateConfig(req: Request, res: Response): Promise<void> {
    try {
      const updates = req.body;
      
      // Validate configuration updates
      if (updates.maxHops && (updates.maxHops < 1 || updates.maxHops > 5)) {
        throw new Error('maxHops must be between 1 and 5');
      }
      
      if (updates.maxPaths && (updates.maxPaths < 1 || updates.maxPaths > 100)) {
        throw new Error('maxPaths must be between 1 and 100');
      }
      
      // Update configuration
      this.routerConfig = { ...this.routerConfig, ...updates };
      
      res.json({
        success: true,
        message: 'Configuration updated',
        config: this.routerConfig
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Validate path discovery request
   */
  private validatePathDiscoveryRequest(body: any): PathDiscoveryRequest {
    const { tokenIn, tokenOut, amountOut, maxAmountIn, maxHops, chainId, slippageTolerance } = body;
    
    if (!tokenIn || !tokenOut || !amountOut) {
      throw new Error('tokenIn, tokenOut, and amountOut are required');
    }
    
    if (!ethers.isAddress(tokenIn.address) || !ethers.isAddress(tokenOut.address)) {
      throw new Error('Invalid token addresses');
    }
    
    if (tokenIn.address === tokenOut.address) {
      throw new Error('Input and output tokens cannot be the same');
    }
    
    return {
      tokenIn: this.validateToken(tokenIn),
      tokenOut: this.validateToken(tokenOut),
      amountOut: BigInt(amountOut),
      maxAmountIn: maxAmountIn ? BigInt(maxAmountIn) : undefined,
      maxHops: maxHops || this.routerConfig.maxHops,
      chainId: chainId || this.routerConfig.chainId,
      slippageTolerance: slippageTolerance || this.routerConfig.defaultSlippage
    };
  }

  /**
   * Validate swap execution request
   */
  private validateSwapExecutionRequest(body: any): MultiHopSwapRequest {
    const { path, userAddress, recipient, deadline, maxSlippage } = body;
    
    if (!path || !userAddress || !deadline) {
      throw new Error('path, userAddress, and deadline are required');
    }
    
    if (!ethers.isAddress(userAddress)) {
      throw new Error('Invalid user address');
    }
    
    if (recipient && !ethers.isAddress(recipient)) {
      throw new Error('Invalid recipient address');
    }
    
    return {
      path: this.validateSwapPath(path),
      userAddress,
      recipient: recipient || userAddress,
      deadline: Number(deadline),
      maxSlippage: maxSlippage || this.routerConfig.defaultSlippage
    };
  }

  /**
   * Validate token object
   */
  private validateToken(token: any): Token {
    if (!token.address || !token.symbol || typeof token.decimals !== 'number') {
      throw new Error('Token must have address, symbol, and decimals');
    }
    
    return {
      address: token.address,
      symbol: token.symbol,
      decimals: token.decimals,
      chainId: token.chainId || this.routerConfig.chainId
    };
  }

  /**
   * Validate swap path object
   */
  private validateSwapPath(path: any): SwapPath {
    if (!path.hops || !Array.isArray(path.hops) || path.hops.length === 0) {
      throw new Error('Path must have at least one hop');
    }
    
    // Basic validation - in production, you'd want more thorough validation
    return path as SwapPath;
  }

  /**
   * Handle API errors
   */
  private handleAPIError(error: any, res: Response): void {
    console.error('API Error:', error);
    
    let statusCode = 500;
    let errorCode = 'INTERNAL_ERROR';
    
    if (error.message.includes('required') || error.message.includes('Invalid')) {
      statusCode = 400;
      errorCode = 'INVALID_REQUEST';
    } else if (error.message.includes(CrossPoolRouterError.NO_PATH_FOUND)) {
      statusCode = 404;
      errorCode = CrossPoolRouterError.NO_PATH_FOUND;
    } else if (error.message.includes(CrossPoolRouterError.INSUFFICIENT_LIQUIDITY)) {
      statusCode = 400;
      errorCode = CrossPoolRouterError.INSUFFICIENT_LIQUIDITY;
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorCode,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Start the API server
   */
  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.config.port, () => {
        console.log(`Cross-Pool Router API listening on port ${this.config.port}`);
        console.log(`Chain ID: ${this.routerConfig.chainId}`);
        console.log(`Health check: http://localhost:${this.config.port}/health`);
        resolve();
      });
    });
  }

  /**
   * Get Express app instance
   */
  public getApp(): express.Application {
    return this.app;
  }
}