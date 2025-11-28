/**
 * Router Service REST API
 * Provides HTTP endpoints for single-pool routing and shard discovery
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ethers } from 'ethers';

import { RouterService } from './RouterService';
import {
  RouterServiceConfig,
  ShardRoutingRequest,
  TradeExecutionRequest,
  TokenPair,
  Token,
  RouterServiceError
} from './types';

export interface RouterAPIConfig {
  port: number;
  corsOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  enableLogging: boolean;
  apiPrefix: string;
}

export class RouterAPI {
  private app: express.Application;
  private config: RouterAPIConfig;
  private routerService: RouterService;

  constructor(
    apiConfig: RouterAPIConfig,
    routerService: RouterService
  ) {
    this.config = apiConfig;
    this.routerService = routerService;
    
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
    const prefix = this.config.apiPrefix;
    
    // Health check
    this.app.get('/health', this.handleHealthCheck.bind(this));
    
    // Shard discovery endpoints
    this.app.get(`${prefix}/shards`, this.handleGetAllShards.bind(this));
    this.app.get(`${prefix}/shards/:poolAddress`, this.handleGetShardInfo.bind(this));
    this.app.post(`${prefix}/shards/refresh`, this.handleRefreshShards.bind(this));
    this.app.post(`${prefix}/shards/available`, this.handleGetAvailableShards.bind(this));
    
    // Routing endpoints
    this.app.post(`${prefix}/routing/find-optimal`, this.handleFindOptimalShard.bind(this));
    this.app.post(`${prefix}/routing/quote`, this.handleQuoteRoute.bind(this));
    this.app.post(`${prefix}/routing/validate-threshold`, this.handleValidateCThreshold.bind(this));
    
    // Trade execution endpoints
    this.app.post(`${prefix}/trades/execute`, this.handleExecuteTrade.bind(this));
    
    // Statistics and monitoring
    this.app.get(`${prefix}/stats`, this.handleGetStats.bind(this));
    this.app.get(`${prefix}/metrics`, this.handleGetMetrics.bind(this));
    this.app.post(`${prefix}/stats/reset`, this.handleResetStats.bind(this));
    
    // Configuration
    this.app.post(`${prefix}/config`, this.handleUpdateConfig.bind(this));
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
      console.error('Router API Error:', error);
      
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
      const stats = this.routerService.getStats();
      const metrics = this.routerService.getShardMetrics();
      
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: {
          totalRequests: stats.totalRequests,
          successRate: stats.successRate,
          activeShards: metrics.totalActiveShards,
          healthStatus: metrics.healthStatus
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
   * Get all shards endpoint
   */
  private async handleGetAllShards(req: Request, res: Response): Promise<void> {
    try {
      const metrics = this.routerService.getShardMetrics();
      
      res.json({
        success: true,
        data: {
          totalShards: metrics.totalActiveShards,
          totalLiquidity: metrics.totalLiquidity.toString(),
          averageShardSize: metrics.averageShardSize.toString(),
          tokenPairCount: metrics.tokenPairCount,
          lastUpdated: metrics.lastUpdated
        }
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Get specific shard info endpoint
   */
  private async handleGetShardInfo(req: Request, res: Response): Promise<void> {
    try {
      const { poolAddress } = req.params;
      
      if (!ethers.isAddress(poolAddress)) {
        throw new Error('Invalid pool address');
      }
      
      const shardInfo = await this.routerService.getShardInfo(poolAddress);
      
      if (!shardInfo) {
        res.status(404).json({
          success: false,
          error: 'Shard not found',
          poolAddress
        });
        return;
      }
      
      res.json({
        success: true,
        data: {
          ...shardInfo,
          reserveA: shardInfo.reserveA.toString(),
          reserveB: shardInfo.reserveB.toString(),
          totalSupply: shardInfo.totalSupply.toString()
        }
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Refresh shards endpoint
   */
  private async handleRefreshShards(req: Request, res: Response): Promise<void> {
    try {
      await this.routerService.refreshShards();
      
      res.json({
        success: true,
        message: 'Shards refreshed successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Get available shards for token pair endpoint
   */
  private async handleGetAvailableShards(req: Request, res: Response): Promise<void> {
    try {
      const tokenPair = this.validateTokenPair(req.body);
      const shards = await this.routerService.getAvailableShards(tokenPair);
      
      res.json({
        success: true,
        data: {
          tokenPair,
          shards: shards.map(shard => ({
            ...shard,
            reserveA: shard.reserveA.toString(),
            reserveB: shard.reserveB.toString(),
            totalSupply: shard.totalSupply.toString()
          })),
          count: shards.length
        }
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Find optimal shard endpoint
   */
  private async handleFindOptimalShard(req: Request, res: Response): Promise<void> {
    try {
      const request = this.validateRoutingRequest(req.body);
      const result = await this.routerService.findOptimalShard(request);
      
      res.json({
        success: result.routing !== null,
        data: {
          routing: result.routing ? {
            ...result.routing,
            expectedAmountIn: result.routing.expectedAmountIn.toString(),
            estimatedFee: result.routing.estimatedFee.toString(),
            estimatedGas: result.routing.estimatedGas.toString()
          } : null,
          availableShards: result.availableShards.length,
          metadata: result.metadata,
          error: result.error
        }
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Quote route endpoint (dry run)
   */
  private async handleQuoteRoute(req: Request, res: Response): Promise<void> {
    try {
      const request = this.validateRoutingRequest(req.body);
      const result = await this.routerService.findOptimalShard(request);
      
      if (result.routing) {
        res.json({
          success: true,
          data: {
            expectedAmountIn: result.routing.expectedAmountIn.toString(),
            estimatedFee: result.routing.estimatedFee.toString(),
            estimatedGas: result.routing.estimatedGas.toString(),
            priceImpact: result.routing.priceImpact,
            isSmallestShard: result.routing.isSmallestShard,
            confidenceScore: result.routing.confidenceScore,
            cThresholdValidated: result.metadata.cThresholdValidated
          }
        });
      } else {
        res.json({
          success: false,
          error: result.error || RouterServiceError.NO_SHARDS_AVAILABLE,
          message: 'No optimal shard found for the requested trade'
        });
      }
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Validate c-threshold endpoint
   */
  private async handleValidateCThreshold(req: Request, res: Response): Promise<void> {
    try {
      const { poolAddress, outputAmount, inputToken } = req.body;
      
      if (!ethers.isAddress(poolAddress) || !ethers.isAddress(inputToken)) {
        throw new Error('Invalid addresses provided');
      }
      
      const shardInfo = await this.routerService.getShardInfo(poolAddress);
      if (!shardInfo) {
        throw new Error('Shard not found');
      }
      
      // Use trade routing service to validate c-threshold
      // This is a simplified validation - in practice you'd use the TradeRoutingService
      const cParameter = shardInfo.sammParams.c;
      const inputReserve = inputToken.toLowerCase() === shardInfo.tokenA.address.toLowerCase() 
        ? shardInfo.reserveA 
        : shardInfo.reserveB;
      
      const threshold = (inputReserve * BigInt(Math.floor(cParameter * 1e6))) / BigInt(1e6);
      const isValid = BigInt(outputAmount) <= threshold;
      
      res.json({
        success: true,
        data: {
          isValid,
          outputAmount: outputAmount.toString(),
          threshold: threshold.toString(),
          cParameter,
          ratio: Number(BigInt(outputAmount) * BigInt(1000)) / Number(threshold) / 1000
        }
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Execute trade endpoint
   */
  private async handleExecuteTrade(req: Request, res: Response): Promise<void> {
    try {
      const request = this.validateTradeExecutionRequest(req.body);
      const result = await this.routerService.executeTrade(request);
      
      res.json({
        success: result.success,
        data: {
          ...result,
          actualAmountIn: result.actualAmountIn.toString(),
          actualAmountOut: result.actualAmountOut.toString(),
          actualFee: result.actualFee.toString(),
          gasUsed: result.gasUsed.toString()
        }
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Get statistics endpoint
   */
  private async handleGetStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = this.routerService.getStats();
      
      res.json({
        success: true,
        data: {
          ...stats,
          totalVolumeRouted: stats.totalVolumeRouted.toString()
        }
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Get metrics endpoint
   */
  private async handleGetMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = this.routerService.getShardMetrics();
      
      res.json({
        success: true,
        data: {
          ...metrics,
          totalLiquidity: metrics.totalLiquidity.toString(),
          averageShardSize: metrics.averageShardSize.toString()
        }
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Reset statistics endpoint
   */
  private async handleResetStats(req: Request, res: Response): Promise<void> {
    try {
      this.routerService.resetStats();
      
      res.json({
        success: true,
        message: 'Statistics reset successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  /**
   * Update configuration endpoint
   */
  private async handleUpdateConfig(req: Request, res: Response): Promise<void> {
    try {
      const updates = req.body;
      
      // Basic validation
      if (updates.defaultSlippage && (updates.defaultSlippage < 0 || updates.defaultSlippage > 100)) {
        throw new Error('Default slippage must be between 0 and 100');
      }
      
      this.routerService.updateConfig(updates);
      
      res.json({
        success: true,
        message: 'Configuration updated successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleAPIError(error, res);
    }
  }

  // Validation methods

  /**
   * Validate token pair object
   */
  private validateTokenPair(body: any): TokenPair {
    const { tokenA, tokenB, chainId } = body;
    
    if (!tokenA || !tokenB) {
      throw new Error('tokenA and tokenB are required');
    }
    
    return {
      tokenA: this.validateToken(tokenA),
      tokenB: this.validateToken(tokenB),
      chainId: chainId || this.routerService.getShardMetrics().lastUpdated // Use a default
    };
  }

  /**
   * Validate token object
   */
  private validateToken(token: any): Token {
    if (!token.address || !token.symbol || typeof token.decimals !== 'number') {
      throw new Error('Token must have address, symbol, and decimals');
    }
    
    if (!ethers.isAddress(token.address)) {
      throw new Error('Invalid token address');
    }
    
    return {
      address: token.address.toLowerCase(),
      symbol: token.symbol,
      decimals: token.decimals,
      chainId: token.chainId || 1 // Default to mainnet
    };
  }

  /**
   * Validate routing request
   */
  private validateRoutingRequest(body: any): ShardRoutingRequest {
    const { tokenPair, outputAmount, maxInputAmount, chainId, slippageTolerance, userAddress } = body;
    
    if (!tokenPair || !outputAmount) {
      throw new Error('tokenPair and outputAmount are required');
    }
    
    if (BigInt(outputAmount) <= 0n) {
      throw new Error('outputAmount must be positive');
    }
    
    return {
      tokenPair: this.validateTokenPair({ ...tokenPair, chainId }),
      outputAmount: BigInt(outputAmount),
      maxInputAmount: maxInputAmount ? BigInt(maxInputAmount) : undefined,
      chainId: chainId || 1,
      slippageTolerance: slippageTolerance || 1.0,
      userAddress: userAddress || undefined
    };
  }

  /**
   * Validate trade execution request
   */
  private validateTradeExecutionRequest(body: any): TradeExecutionRequest {
    const { routing, maxAmountIn, userAddress, recipient, deadline } = body;
    
    if (!routing || !maxAmountIn || !userAddress) {
      throw new Error('routing, maxAmountIn, and userAddress are required');
    }
    
    if (!ethers.isAddress(userAddress)) {
      throw new Error('Invalid user address');
    }
    
    if (recipient && !ethers.isAddress(recipient)) {
      throw new Error('Invalid recipient address');
    }
    
    return {
      routing: {
        ...routing,
        expectedAmountIn: BigInt(routing.expectedAmountIn),
        estimatedFee: BigInt(routing.estimatedFee),
        estimatedGas: BigInt(routing.estimatedGas)
      },
      maxAmountIn: BigInt(maxAmountIn),
      userAddress,
      recipient: recipient || userAddress,
      deadline: deadline || Math.floor(Date.now() / 1000) + 1800 // 30 minutes default
    };
  }

  /**
   * Handle API errors
   */
  private handleAPIError(error: any, res: Response): void {
    console.error('Router API Error:', error);
    
    let statusCode = 500;
    let errorCode = 'INTERNAL_ERROR';
    
    if (error.message.includes('required') || error.message.includes('Invalid')) {
      statusCode = 400;
      errorCode = 'INVALID_REQUEST';
    } else if (error.message.includes(RouterServiceError.NO_SHARDS_AVAILABLE)) {
      statusCode = 404;
      errorCode = RouterServiceError.NO_SHARDS_AVAILABLE;
    } else if (error.message.includes(RouterServiceError.EXCEEDS_C_THRESHOLD)) {
      statusCode = 400;
      errorCode = RouterServiceError.EXCEEDS_C_THRESHOLD;
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
        console.log(`Router API listening on port ${this.config.port}`);
        console.log(`API prefix: ${this.config.apiPrefix}`);
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