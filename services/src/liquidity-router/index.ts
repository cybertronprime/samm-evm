/**
 * Liquidity Router Service Entry Point
 * Exports all main components and provides easy initialization
 */

export { LiquidityRouterService } from './LiquidityRouterService';
export { LiquidityRouterAPI } from './LiquidityRouterAPI';
export { PoolAnalysisService } from './PoolAnalysisService';
export { FillupStrategyEngine } from './FillupStrategyEngine';

export * from './types';

// Default configuration factory
export function createDefaultConfig(): import('./types').LiquidityRouterConfig {
  return {
    chains: [
      {
        chainId: 11155111, // Sepolia
        name: 'Ethereum Sepolia',
        rpcEndpoint: process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/YOUR_KEY',
        contractAddresses: {
          sammPoolFactory: process.env.SEPOLIA_SAMM_FACTORY || '0x0000000000000000000000000000000000000000',
          router: process.env.SEPOLIA_ROUTER || '0x0000000000000000000000000000000000000000'
        }
      },
      {
        chainId: 1234, // Monad (example)
        name: 'Monad',
        rpcEndpoint: process.env.MONAD_RPC_URL || 'https://monad-rpc.example.com',
        contractAddresses: {
          sammPoolFactory: process.env.MONAD_SAMM_FACTORY || '0x0000000000000000000000000000000000000000',
          router: process.env.MONAD_ROUTER || '0x0000000000000000000000000000000000000000'
        }
      },
      {
        chainId: 5678, // RiseChain (example)
        name: 'RiseChain',
        rpcEndpoint: process.env.RISECHAIN_RPC_URL || 'https://risechain-rpc.example.com',
        contractAddresses: {
          sammPoolFactory: process.env.RISECHAIN_SAMM_FACTORY || '0x0000000000000000000000000000000000000000',
          router: process.env.RISECHAIN_ROUTER || '0x0000000000000000000000000000000000000000'
        }
      }
    ],
    analysisInterval: 5 * 60 * 1000, // 5 minutes
    metricsRetentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
    minLiquidityThreshold: BigInt(1000), // Minimum 1000 wei
    maxRiskScore: 0.8 // Maximum acceptable risk score
  };
}

// Convenience function to start the service
export async function startLiquidityRouterService(
  config?: import('./types').LiquidityRouterConfig,
  port?: number
): Promise<LiquidityRouterAPI> {
  const serviceConfig = config || createDefaultConfig();
  const api = new LiquidityRouterAPI(serviceConfig, port);
  
  await api.start();
  return api;
}