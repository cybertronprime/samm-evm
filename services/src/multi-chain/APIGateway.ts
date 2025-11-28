import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { MultiChainBackend } from './MultiChainBackend';
import { ChainSpecificRouter } from './ChainSpecificRouter';
import { ChainRequestContext, ChainResponse, ChainRateLimitConfig, ChainAuthConfig } from './types';
import { v4 as uuidv4 } from 'uuid';

/**
 * API Gateway for Multi-Chain Backend
 * 
 * Routes requests to appropriate chain-specific services.
 * Maintains complete isolation between chains.
 */
export class APIGateway {
  private app: express.Application;
  private multiChainBackend: MultiChainBackend;
  private chainSpecificRouter: ChainSpecificRouter;
  private chainRateLimiters: Map<number, any> = new Map();
  private chainAuthConfigs: Map<number, ChainAuthConfig> = new Map();

  constructor(multiChainBackend: MultiChainBackend) {
    this.app = express();
    this.multiChainBackend = multiChainBackend;
    this.chainSpecificRouter = new ChainSpecificRouter(multiChainBackend);
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Get Express application
   */
  getApp(): express.Application {
    return this.app;
  }

  /**
   * Setup global middleware
   */
  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet());
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
      credentials: true
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request ID and logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      req.id = uuidv4();
      req.timestamp = new Date();
      
      console.log(`[${req.id}] ${req.method} ${req.path} - ${req.ip}`);
      next();
    });

    // Global rate limiting (fallback)
    const globalLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // limit each IP to 1000 requests per windowMs
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api/', globalLimiter);
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', this.handleHealthCheck.bind(this));

    // Multi-chain status endpoint
    this.app.get('/api/chains', this.handleChainsStatus.bind(this));

    // Chain-specific routes using ChainSpecificRouter
    this.setupChainSpecificRoutes();

    // 404 handler
    this.app.use('*', (req: Request, res: Response) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        timestamp: new Date()
      });
    });

    // Error handler
    this.app.use(this.errorHandler.bind(this));
  }

  /**
   * Setup chain-specific routes
   */
  private setupChainSpecificRoutes(): void {
    const supportedChains = this.multiChainBackend.getSupportedChains();
    
    for (const chainId of supportedChains) {
      const config = this.multiChainBackend.getChainConfig(chainId);
      const chainName = this.getChainEndpointName(config.name);
      
      // Create chain-specific router
      const chainRouter = this.chainSpecificRouter.createChainRouter(chainId);
      
      // Mount chain router at chain-specific path
      this.app.use(`/api/${chainName}`, chainRouter);
      
      console.log(`Mounted API routes for chain ${chainId} at /api/${chainName}`);
    }
  }

  /**
   * Add support for new chain
   */
  addChainSupport(chainId: number): void {
    const config = this.multiChainBackend.getChainConfig(chainId);
    const chainName = this.getChainEndpointName(config.name);
    
    // Create and mount chain-specific router
    const chainRouter = this.chainSpecificRouter.createChainRouter(chainId);
    this.app.use(`/api/${chainName}`, chainRouter);
    
    console.log(`Added API support for chain ${chainId} at /api/${chainName}`);
  }

  /**
   * Remove support for a chain
   */
  removeChainSupport(chainId: number): void {
    this.chainSpecificRouter.removeChainRouter(chainId);
    console.log(`Removed API support for chain ${chainId}`);
  }

  /**
   * Get chain endpoint name (URL-friendly)
   */
  private getChainEndpointName(chainName: string): string {
    return chainName.toLowerCase().replace(/\s+/g, '-');
  }



  /**
   * Handle health check requests
   */
  private async handleHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      const supportedChains = this.multiChainBackend.getSupportedChains();
      const chainHealths = await Promise.all(
        supportedChains.map(async (chainId) => {
          try {
            const health = await this.multiChainBackend.checkChainHealth(chainId);
            return { chainId, health };
          } catch (error) {
            return { 
              chainId, 
              health: { 
                chainId, 
                isHealthy: false, 
                errors: [error.message],
                lastChecked: new Date()
              } 
            };
          }
        })
      );

      const overallHealthy = chainHealths.every(({ health }) => health.isHealthy);

      res.status(overallHealthy ? 200 : 503).json({
        success: true,
        status: overallHealthy ? 'healthy' : 'degraded',
        chains: chainHealths.reduce((acc, { chainId, health }) => {
          acc[chainId] = health;
          return acc;
        }, {} as any),
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Health check error:', error);
      res.status(500).json({
        success: false,
        error: 'Health check failed',
        timestamp: new Date()
      });
    }
  }

  /**
   * Handle chains status requests
   */
  private async handleChainsStatus(req: Request, res: Response): Promise<void> {
    try {
      const supportedChains = this.multiChainBackend.getSupportedChains();
      const chainConfigs = supportedChains.map(chainId => {
        const config = this.multiChainBackend.getChainConfig(chainId);
        return {
          chainId: config.chainId,
          name: config.name,
          nativeToken: config.nativeToken,
          endpoints: {
            router: `/api/${config.name.toLowerCase().replace(/\s+/g, '-')}/router`,
            crossPool: `/api/${config.name.toLowerCase().replace(/\s+/g, '-')}/cross-pool`,
            liquidity: `/api/${config.name.toLowerCase().replace(/\s+/g, '-')}/liquidity`
          }
        };
      });

      res.json({
        success: true,
        data: {
          supportedChains: chainConfigs,
          totalChains: supportedChains.length
        },
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Chains status error:', error);
      this.sendErrorResponse(res, 500, 'Failed to get chains status', null);
    }
  }





  /**
   * Send success response
   */
  private sendSuccessResponse(res: Response, data: any, chainId: number): void {
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
   * Send error response
   */
  private sendErrorResponse(res: Response, status: number, error: string, chainId: number | null): void {
    const response: ChainResponse<any> = {
      success: false,
      chainId: chainId || 0,
      error,
      timestamp: new Date(),
      requestId: res.req.id
    };
    
    res.status(status).json(response);
  }

  /**
   * Error handler middleware
   */
  private errorHandler(error: Error, req: Request, res: Response, next: NextFunction): void {
    console.error('Unhandled error:', error);
    
    this.sendErrorResponse(res, 500, 'Internal server error', req.chainContext?.chainId || null);
  }
}

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      id?: string;
      timestamp?: Date;
      chainContext?: ChainRequestContext;
    }
  }
}