/**
 * Liquidity Router REST API
 * Provides HTTP endpoints for liquidity routing with pool analysis
 * Implements coordination with router service for consistent shard information
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { LiquidityRouterService } from './LiquidityRouterService';
import {
  TokenPair,
  LiquidityAmount,
  LiquidityRouterConfig,
  ChainConfig
} from './types';

export class LiquidityRouterAPI {
  private app: express.Application;
  private liquidityRouterService: LiquidityRouterService;
  private port: number;

  constructor(
    config: LiquidityRouterConfig,
    port: number = 3002
  ) {
    this.app = express();
    this.port = port;
    this.liquidityRouterService = new LiquidityRouterService(config);
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // Request logging middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });

    // Request validation middleware
    this.app.use('/api/liquidity-router/:chainId/*', this.validateChainId.bind(this));
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', this.handleHealthCheck.bind(this));
    
    // Service info endpoint
    this.app.get('/api/liquidity-router/info', this.handleServiceInfo.bind(this));

    // Chain-specific endpoints
    this.app.get('/api/liquidity-router/:chainId/pools', this.handleGetAvailablePools.bind(this));
    this.app.post('/api/liquidity-router/:chainId/recommend', this.handleGetRecommendation.bind(this));
    this.app.post('/api/liquidity-router/:chainId/fillup-strategy', this.handleGetFillupStrategy.bind(this));
    this.app.post('/api/liquidity-router/:chainId/expected-returns', this.handleCalculateExpectedReturns.bind(this));
    this.app.post('/api/liquidity-router/:chainId/optimal-distribution', this.handleGetOptimalDistribution.bind(this));
    this.app.post('/api/liquidity-router/:chainId/add-liquidity', this.handleAddLiquidity.bind(this));

    // Utility endpoints
    this.app.post('/api/liquidity-router/refresh', this.handleRefreshData.bind(this));
  }

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
   * Validate chain ID parameter
   */
  private validateChainId(req: Request, res: Response, next: NextFunction): void {
    const chainId = parseInt(req.params.chainId);
    
    if (isNaN(chainId)) {
      res.status(400).json({
        error: 'Invalid chain ID',
        message: 'Chain ID must be a valid number'
      });
      return;
    }

    const supportedChains = this.liquidityRouterService.getSupportedChains();
    if (!supportedChains.includes(chainId)) {
      res.status(400).json({
        error: 'Unsupported chain',
        message: `Chain ${chainId} is not supported`,
        supportedChains
      });
      return;
    }

    next();
  }

  /**
   * Health check endpoint
   */
  private async handleHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      const health = await this.liquidityRouterService.healthCheck();
      const statusCode = health.status === 'healthy' ? 200 : 503;
      
      res.status(statusCode).json({
        service: 'liquidity-router',
        ...health
      });
    } catch (error) {
      res.status(503).json({
        service: 'liquidity-router',
        status: 'unhealthy',
        error: error.message
      });
    }
  }

  /**
   * Service information endpoint
   */
  private handleServiceInfo(req: Request, res: Response): void {
    try {
      const stats = this.liquidityRouterService.getServiceStats();
      const supportedChains = this.liquidityRouterService.getSupportedChains();
      
      res.json({
        service: 'SAMM Liquidity Router',
        version: '1.0.0',
        supportedChains,
        stats,
        endpoints: {
          health: '/health',
          pools: '/api/liquidity-router/{chainId}/pools',
          recommend: '/api/liquidity-router/{chainId}/recommend',
          fillupStrategy: '/api/liquidity-router/{chainId}/fillup-strategy',
          expectedReturns: '/api/liquidity-router/{chainId}/expected-returns',
          optimalDistribution: '/api/liquidity-router/{chainId}/optimal-distribution',
          addLiquidity: '/api/liquidity-router/{chainId}/add-liquidity'
        }
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get service info',
        message: error.message
      });
    }
  }

  /**
   * Get available pools for token pair
   */
  private async handleGetAvailablePools(req: Request, res: Response): Promise<void> {
    try {
      const chainId = parseInt(req.params.chainId);
      const { tokenA, tokenB } = req.query;

      if (!tokenA || !tokenB) {
        res.status(400).json({
          error: 'Missing required parameters',
          message: 'tokenA and tokenB addresses are required'
        });
        return;
      }

      const tokenPair: TokenPair = {
        tokenA: { address: tokenA as string, symbol: '', decimals: 18, name: '' },
        tokenB: { address: tokenB as string, symbol: '', decimals: 18, name: '' }
      };

      const pools = await this.liquidityRouterService.getAvailablePoolsForTokenPair(
        tokenPair,
        chainId
      );

      res.json({
        chainId,
        tokenPair: { tokenA, tokenB },
        pools,
        count: pools.length
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get available pools',
        message: error.message
      });
    }
  }

  /**
   * Get liquidity recommendation
   */
  private async handleGetRecommendation(req: Request, res: Response): Promise<void> {
    try {
      const chainId = parseInt(req.params.chainId);
      const { tokenPair, liquidityAmount } = req.body;

      if (!tokenPair || !liquidityAmount) {
        res.status(400).json({
          error: 'Missing required parameters',
          message: 'tokenPair and liquidityAmount are required'
        });
        return;
      }

      const recommendation = await this.liquidityRouterService.findBestPoolForLiquidity(
        tokenPair,
        {
          tokenA: BigInt(liquidityAmount.tokenA),
          tokenB: BigInt(liquidityAmount.tokenB)
        },
        chainId
      );

      res.json({
        chainId,
        recommendation: {
          ...recommendation,
          feeGeneration24h: recommendation.feeGeneration24h.toString()
        }
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get recommendation',
        message: error.message
      });
    }
  }

  /**
   * Get fillup strategy
   */
  private async handleGetFillupStrategy(req: Request, res: Response): Promise<void> {
    try {
      const chainId = parseInt(req.params.chainId);
      const { tokenPair } = req.body;

      if (!tokenPair) {
        res.status(400).json({
          error: 'Missing required parameters',
          message: 'tokenPair is required'
        });
        return;
      }

      const strategy = await this.liquidityRouterService.getFillupStrategy(
        tokenPair,
        chainId
      );

      res.json({
        chainId,
        strategy: {
          ...strategy,
          currentSize: strategy.currentSize.toString(),
          targetSize: strategy.targetSize.toString(),
          recommendedAmount: strategy.recommendedAmount.toString()
        }
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get fillup strategy',
        message: error.message
      });
    }
  }

  /**
   * Calculate expected returns
   */
  private async handleCalculateExpectedReturns(req: Request, res: Response): Promise<void> {
    try {
      const chainId = parseInt(req.params.chainId);
      const { poolAddress, liquidityAmount } = req.body;

      if (!poolAddress || !liquidityAmount) {
        res.status(400).json({
          error: 'Missing required parameters',
          message: 'poolAddress and liquidityAmount are required'
        });
        return;
      }

      const expectedReturns = await this.liquidityRouterService.calculateExpectedReturns(
        poolAddress,
        {
          tokenA: BigInt(liquidityAmount.tokenA),
          tokenB: BigInt(liquidityAmount.tokenB)
        },
        chainId
      );

      res.json({
        chainId,
        poolAddress,
        expectedReturns: {
          ...expectedReturns,
          dailyFees: expectedReturns.dailyFees.toString(),
          weeklyFees: expectedReturns.weeklyFees.toString(),
          monthlyFees: expectedReturns.monthlyFees.toString()
        }
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to calculate expected returns',
        message: error.message
      });
    }
  }

  /**
   * Get optimal liquidity distribution
   */
  private async handleGetOptimalDistribution(req: Request, res: Response): Promise<void> {
    try {
      const chainId = parseInt(req.params.chainId);
      const { tokenPair, maxLiquidityAmount } = req.body;

      if (!tokenPair || !maxLiquidityAmount) {
        res.status(400).json({
          error: 'Missing required parameters',
          message: 'tokenPair and maxLiquidityAmount are required'
        });
        return;
      }

      const distribution = await this.liquidityRouterService.getOptimalLiquidityDistribution(
        tokenPair,
        {
          tokenA: BigInt(maxLiquidityAmount.tokenA),
          tokenB: BigInt(maxLiquidityAmount.tokenB)
        },
        chainId
      );

      res.json({
        chainId,
        distribution: distribution.map(rec => ({
          ...rec,
          feeGeneration24h: rec.feeGeneration24h.toString()
        }))
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get optimal distribution',
        message: error.message
      });
    }
  }

  /**
   * Add liquidity to recommended pool
   */
  private async handleAddLiquidity(req: Request, res: Response): Promise<void> {
    try {
      const chainId = parseInt(req.params.chainId);
      const { recommendation, userAddress } = req.body;

      if (!recommendation || !userAddress) {
        res.status(400).json({
          error: 'Missing required parameters',
          message: 'recommendation and userAddress are required'
        });
        return;
      }

      const txHash = await this.liquidityRouterService.addLiquidityToPool(
        {
          ...recommendation,
          feeGeneration24h: BigInt(recommendation.feeGeneration24h),
          chainId
        },
        userAddress
      );

      res.json({
        chainId,
        transactionHash: txHash,
        status: 'submitted',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to add liquidity',
        message: error.message
      });
    }
  }

  /**
   * Refresh service data
   */
  private async handleRefreshData(req: Request, res: Response): Promise<void> {
    try {
      await this.liquidityRouterService.refreshData();
      
      res.json({
        message: 'Data refreshed successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to refresh data',
        message: error.message
      });
    }
  }

  /**
   * Start the API server
   */
  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        console.log(`Liquidity Router API server running on port ${this.port}`);
        console.log(`Health check: http://localhost:${this.port}/health`);
        console.log(`Service info: http://localhost:${this.port}/api/liquidity-router/info`);
        resolve();
      });
    });
  }

  /**
   * Get the Express app instance
   */
  public getApp(): express.Application {
    return this.app;
  }
}