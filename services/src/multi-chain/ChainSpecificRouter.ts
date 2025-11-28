import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { MultiChainBackend } from './MultiChainBackend';
import { ChainResponse, ChainAuthConfig, ChainRateLimitConfig } from './types';

/**
 * Chain-Specific Router
 * 
 * Creates isolated API endpoints for each chain.
 * Each chain has its own routes, rate limiting, and authentication.
 */
export class ChainSpecificRouter {
  private multiChainBackend: MultiChainBackend;
  private chainRouters: Map<number, express.Router> = new Map();
  private chainRateLimiters: Map<number, any> = new Map();
  private chainAuthConfigs: Map<number, ChainAuthConfig> = new Map();

  constructor(multiChainBackend: MultiChainBackend) {
    this.multiChainBackend = multiChainBackend;
  }

  /**
   * Create router for a specific chain
   */
  createChainRouter(chainId: number): express.Router {
    if (this.chainRouters.has(chainId)) {
      return this.chainRouters.get(chainId)!;
    }

    const router = express.Router();
    const config = this.multiChainBackend.getChainConfig(chainId);

    // Setup chain-specific middleware
    this.setupChainMiddleware(router, chainId);

    // Setup chain-specific routes
    this.setupChainRoutes(router, chainId);

    // Store router
    this.chainRouters.set(chainId, router);

    console.log(`Created router for chain ${chainId} (${config.name})`);
    return router;
  }

  /**
   * Get router for a specific chain
   */
  getChainRouter(chainId: number): express.Router {
    const router = this.chainRouters.get(chainId);
    if (!router) {
      throw new Error(`Router for chain ${chainId} not found`);
    }
    return router;
  }

  /**
   * Setup chain-specific middleware
   */
  private setupChainMiddleware(router: express.Router, chainId: number): void {
    // Chain-specific rate limiting
    const rateLimiter = this.getChainRateLimiter(chainId);
    router.use(rateLimiter);

    // Chain-specific authentication
    router.use(this.createChainAuthMiddleware(chainId));

    // Chain health check middleware
    router.use(async (req: Request, res: Response, next: NextFunction) => {
      try {
        const health = await this.multiChainBackend.checkChainHealth(chainId);
        if (!health.isHealthy) {
          return this.sendChainErrorResponse(res, 503, `Chain ${chainId} is unhealthy`, chainId);
        }
        next();
      } catch (error) {
        return this.sendChainErrorResponse(res, 500, `Health check failed: ${error.message}`, chainId);
      }
    });

    // Add chain context to request
    router.use((req: Request, res: Response, next: NextFunction) => {
      req.chainId = chainId;
      req.chainConfig = this.multiChainBackend.getChainConfig(chainId);
      next();
    });
  }

  /**
   * Setup chain-specific routes
   */
  private setupChainRoutes(router: express.Router, chainId: number): void {
    // Chain info endpoint
    router.get('/info', this.handleChainInfo.bind(this, chainId));

    // Router service endpoints
    router.get('/router/shards', this.handleRouterShards.bind(this, chainId));
    router.post('/router/route', this.handleRouterRoute.bind(this, chainId));
    router.post('/router/execute', this.handleRouterExecute.bind(this, chainId));
    router.get('/router/health', this.handleRouterHealth.bind(this, chainId));

    // Cross-pool router endpoints
    router.get('/cross-pool/paths', this.handleCrossPoolPaths.bind(this, chainId));
    router.post('/cross-pool/execute', this.handleCrossPoolExecute.bind(this, chainId));
    router.get('/cross-pool/health', this.handleCrossPoolHealth.bind(this, chainId));

    // Liquidity router endpoints
    router.get('/liquidity/pools', this.handleLiquidityPools.bind(this, chainId));
    router.get('/liquidity/recommendations', this.handleLiquidityRecommendations.bind(this, chainId));
    router.post('/liquidity/analyze', this.handleLiquidityAnalyze.bind(this, chainId));
    router.get('/liquidity/health', this.handleLiquidityHealth.bind(this, chainId));

    // Chain-specific monitoring endpoints
    router.get('/metrics', this.handleChainMetrics.bind(this, chainId));
    router.get('/isolation', this.handleChainIsolation.bind(this, chainId));
  }

  /**
   * Handle chain info requests
   */
  private async handleChainInfo(chainId: number, req: Request, res: Response): Promise<void> {
    try {
      const config = this.multiChainBackend.getChainConfig(chainId);
      const health = await this.multiChainBackend.checkChainHealth(chainId);
      
      const info = {
        chainId: config.chainId,
        name: config.name,
        nativeToken: config.nativeToken,
        blockTime: config.blockTime,
        health: {
          isHealthy: health.isHealthy,
          blockHeight: health.blockHeight,
          lastBlockTime: health.lastBlockTime,
          activeShards: health.activeShards
        },
        endpoints: {
          router: `/api/${this.getChainEndpointName(config.name)}/router`,
          crossPool: `/api/${this.getChainEndpointName(config.name)}/cross-pool`,
          liquidity: `/api/${this.getChainEndpointName(config.name)}/liquidity`
        }
      };

      this.sendChainSuccessResponse(res, info, chainId);
    } catch (error) {
      this.sendChainErrorResponse(res, 500, error.message, chainId);
    }
  }

  /**
   * Handle router shards requests
   */
  private async handleRouterShards(chainId: number, req: Request, res: Response): Promise<void> {
    try {
      const routerService = this.multiChainBackend.getRouterService(chainId);
      const result = await routerService.getAvailableShards(req.query);
      this.sendChainSuccessResponse(res, result, chainId);
    } catch (error) {
      this.sendChainErrorResponse(res, 500, error.message, chainId);
    }
  }

  /**
   * Handle router route requests
   */
  private async handleRouterRoute(chainId: number, req: Request, res: Response): Promise<void> {
    try {
      const routerService = this.multiChainBackend.getRouterService(chainId);
      const result = await routerService.findOptimalRoute(req.body);
      this.sendChainSuccessResponse(res, result, chainId);
    } catch (error) {
      this.sendChainErrorResponse(res, 500, error.message, chainId);
    }
  }

  /**
   * Handle router execute requests
   */
  private async handleRouterExecute(chainId: number, req: Request, res: Response): Promise<void> {
    try {
      const routerService = this.multiChainBackend.getRouterService(chainId);
      const result = await routerService.executeRoute(req.body);
      this.sendChainSuccessResponse(res, result, chainId);
    } catch (error) {
      this.sendChainErrorResponse(res, 500, error.message, chainId);
    }
  }

  /**
   * Handle router health requests
   */
  private async handleRouterHealth(chainId: number, req: Request, res: Response): Promise<void> {
    try {
      const routerService = this.multiChainBackend.getRouterService(chainId);
      const result = await routerService.healthCheck();
      this.sendChainSuccessResponse(res, result, chainId);
    } catch (error) {
      this.sendChainErrorResponse(res, 500, error.message, chainId);
    }
  }

  /**
   * Handle cross-pool paths requests
   */
  private async handleCrossPoolPaths(chainId: number, req: Request, res: Response): Promise<void> {
    try {
      const crossPoolRouter = this.multiChainBackend.getCrossPoolRouter(chainId);
      const result = await crossPoolRouter.findPaths(req.query);
      this.sendChainSuccessResponse(res, result, chainId);
    } catch (error) {
      this.sendChainErrorResponse(res, 500, error.message, chainId);
    }
  }

  /**
   * Handle cross-pool execute requests
   */
  private async handleCrossPoolExecute(chainId: number, req: Request, res: Response): Promise<void> {
    try {
      const crossPoolRouter = this.multiChainBackend.getCrossPoolRouter(chainId);
      const result = await crossPoolRouter.executeMultiHop(req.body);
      this.sendChainSuccessResponse(res, result, chainId);
    } catch (error) {
      this.sendChainErrorResponse(res, 500, error.message, chainId);
    }
  }

  /**
   * Handle cross-pool health requests
   */
  private async handleCrossPoolHealth(chainId: number, req: Request, res: Response): Promise<void> {
    try {
      const crossPoolRouter = this.multiChainBackend.getCrossPoolRouter(chainId);
      const result = await crossPoolRouter.healthCheck();
      this.sendChainSuccessResponse(res, result, chainId);
    } catch (error) {
      this.sendChainErrorResponse(res, 500, error.message, chainId);
    }
  }

  /**
   * Handle liquidity pools requests
   */
  private async handleLiquidityPools(chainId: number, req: Request, res: Response): Promise<void> {
    try {
      const liquidityRouter = this.multiChainBackend.getLiquidityRouter(chainId);
      const result = await liquidityRouter.getAvailablePools(req.query);
      this.sendChainSuccessResponse(res, result, chainId);
    } catch (error) {
      this.sendChainErrorResponse(res, 500, error.message, chainId);
    }
  }

  /**
   * Handle liquidity recommendations requests
   */
  private async handleLiquidityRecommendations(chainId: number, req: Request, res: Response): Promise<void> {
    try {
      const liquidityRouter = this.multiChainBackend.getLiquidityRouter(chainId);
      const result = await liquidityRouter.getRecommendations(req.query);
      this.sendChainSuccessResponse(res, result, chainId);
    } catch (error) {
      this.sendChainErrorResponse(res, 500, error.message, chainId);
    }
  }

  /**
   * Handle liquidity analyze requests
   */
  private async handleLiquidityAnalyze(chainId: number, req: Request, res: Response): Promise<void> {
    try {
      const liquidityRouter = this.multiChainBackend.getLiquidityRouter(chainId);
      const result = await liquidityRouter.analyzePool(req.body);
      this.sendChainSuccessResponse(res, result, chainId);
    } catch (error) {
      this.sendChainErrorResponse(res, 500, error.message, chainId);
    }
  }

  /**
   * Handle liquidity health requests
   */
  private async handleLiquidityHealth(chainId: number, req: Request, res: Response): Promise<void> {
    try {
      const liquidityRouter = this.multiChainBackend.getLiquidityRouter(chainId);
      const result = await liquidityRouter.healthCheck();
      this.sendChainSuccessResponse(res, result, chainId);
    } catch (error) {
      this.sendChainErrorResponse(res, 500, error.message, chainId);
    }
  }

  /**
   * Handle chain metrics requests
   */
  private async handleChainMetrics(chainId: number, req: Request, res: Response): Promise<void> {
    try {
      const metrics = this.multiChainBackend.getChainIsolationStatus(chainId);
      this.sendChainSuccessResponse(res, metrics, chainId);
    } catch (error) {
      this.sendChainErrorResponse(res, 500, error.message, chainId);
    }
  }

  /**
   * Handle chain isolation requests
   */
  private async handleChainIsolation(chainId: number, req: Request, res: Response): Promise<void> {
    try {
      const isolation = this.multiChainBackend.verifyChainIsolation();
      this.sendChainSuccessResponse(res, isolation, chainId);
    } catch (error) {
      this.sendChainErrorResponse(res, 500, error.message, chainId);
    }
  }

  /**
   * Get chain-specific rate limiter
   */
  private getChainRateLimiter(chainId: number): any {
    if (!this.chainRateLimiters.has(chainId)) {
      const config = this.multiChainBackend.getChainConfig(chainId);
      
      const limiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // limit each IP to 100 requests per windowMs per chain
        message: `Too many requests for ${config.name}, please try again later.`,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `${req.ip}_chain_${chainId}`,
        skip: (req) => {
          // Skip rate limiting for health checks
          return req.path.includes('/health');
        }
      });
      
      this.chainRateLimiters.set(chainId, limiter);
    }
    
    return this.chainRateLimiters.get(chainId);
  }

  /**
   * Create chain-specific authentication middleware
   */
  private createChainAuthMiddleware(chainId: number): express.RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      const authConfig = this.chainAuthConfigs.get(chainId);
      
      if (!authConfig || !authConfig.enabled) {
        return next();
      }

      // Check API key if required
      if (authConfig.apiKeyRequired) {
        const apiKey = req.headers['x-api-key'] as string;
        if (!apiKey || !this.validateApiKey(chainId, apiKey)) {
          return this.sendChainErrorResponse(res, 401, 'Invalid or missing API key', chainId);
        }
      }

      // Check allowed origins
      if (authConfig.allowedOrigins.length > 0) {
        const origin = req.headers.origin as string;
        if (origin && !authConfig.allowedOrigins.includes(origin)) {
          return this.sendChainErrorResponse(res, 403, 'Origin not allowed', chainId);
        }
      }

      next();
    };
  }

  /**
   * Validate API key for a chain
   */
  private validateApiKey(chainId: number, apiKey: string): boolean {
    // In production, this would validate against a database or key store
    // For now, we'll use environment variables
    const validKey = process.env[`CHAIN_${chainId}_API_KEY`];
    return validKey && validKey === apiKey;
  }

  /**
   * Get chain endpoint name (URL-friendly)
   */
  private getChainEndpointName(chainName: string): string {
    return chainName.toLowerCase().replace(/\s+/g, '-');
  }

  /**
   * Send success response for chain
   */
  private sendChainSuccessResponse(res: Response, data: any, chainId: number): void {
    const response: ChainResponse<any> = {
      success: true,
      chainId,
      data,
      timestamp: new Date(),
      requestId: res.req.id
    };
    
    res.json(response);
  }

  /**
   * Send error response for chain
   */
  private sendChainErrorResponse(res: Response, status: number, error: string, chainId: number): void {
    const response: ChainResponse<any> = {
      success: false,
      chainId,
      error,
      timestamp: new Date(),
      requestId: res.req.id
    };
    
    res.status(status).json(response);
  }

  /**
   * Configure authentication for a chain
   */
  configureChainAuth(chainId: number, authConfig: ChainAuthConfig): void {
    this.chainAuthConfigs.set(chainId, authConfig);
    console.log(`Configured authentication for chain ${chainId}`);
  }

  /**
   * Remove chain router
   */
  removeChainRouter(chainId: number): void {
    this.chainRouters.delete(chainId);
    this.chainRateLimiters.delete(chainId);
    this.chainAuthConfigs.delete(chainId);
    console.log(`Removed router for chain ${chainId}`);
  }
}

// Extend Express Request interface for chain context
declare global {
  namespace Express {
    interface Request {
      chainId?: number;
      chainConfig?: any;
    }
  }
}