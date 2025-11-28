import { MultiChainBackend } from './MultiChainBackend';
import { APIGateway } from './APIGateway';
import { ChainConfig } from './types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Main Multi-Chain SAMM Service Entry Point
 * 
 * Integrates all chain-specific services with complete isolation
 */

async function main() {
  console.log('🚀 Starting SAMM Multi-Chain Backend Service');
  
  try {
    // Initialize multi-chain backend
    const multiChainBackend = new MultiChainBackend();
    
    // Load chain configurations
    const chainsConfigPath = path.join(__dirname, '../../config/chains.json');
    const chainsConfig = JSON.parse(fs.readFileSync(chainsConfigPath, 'utf8'));
    
    // Add supported chains
    for (const [chainName, config] of Object.entries(chainsConfig)) {
      const chainConfig = config as ChainConfig;
      
      try {
        await multiChainBackend.addChain(chainConfig.chainId, chainConfig);
        console.log(`✅ Added chain: ${chainConfig.name} (${chainConfig.chainId})`);
      } catch (error) {
        console.error(`❌ Failed to add chain ${chainConfig.name}:`, error.message);
      }
    }
    
    // Initialize API Gateway
    const apiGateway = new APIGateway(multiChainBackend);
    const app = apiGateway.getApp();
    
    // Start server
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`\n🌐 SAMM Multi-Chain Service running on port ${port}`);
      console.log(`📊 Supported chains: ${multiChainBackend.getSupportedChains().length}`);
      console.log(`🔗 Health check: http://localhost:${port}/health`);
      console.log(`📋 Chains info: http://localhost:${port}/api/chains`);
      
      // Log chain-specific endpoints
      for (const chainId of multiChainBackend.getSupportedChains()) {
        const config = multiChainBackend.getChainConfig(chainId);
        const chainEndpoint = config.name.toLowerCase().replace(/\s+/g, '-');
        console.log(`🔗 ${config.name}: http://localhost:${port}/api/${chainEndpoint}/info`);
      }
    });
    
    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('🛑 Shutting down gracefully...');
      
      // Stop all chain monitoring
      for (const chainId of multiChainBackend.getSupportedChains()) {
        try {
          await multiChainBackend.removeChain(chainId);
        } catch (error) {
          console.error(`Error removing chain ${chainId}:`, error);
        }
      }
      
      process.exit(0);
    });
    
  } catch (error) {
    console.error('💥 Failed to start multi-chain service:', error);
    process.exit(1);
  }
}

// Start the service
if (require.main === module) {
  main();
}

export { main };