/**
 * Cross-Pool Router Integration Example
 * Demonstrates how to use the Cross-Pool Router service and SDK
 */

import { ethers } from 'ethers';
import { CrossPoolRouterService, CrossPoolRouterSDK } from '../index';
import { CrossPoolRouterConfig, Token, Pool } from '../types';

// Example configuration
const CHAIN_ID = 11155931; // RiseChain testnet
const RPC_URL = 'https://testnet.riselabs.xyz';

async function main() {
  console.log('🚀 Cross-Pool Router Integration Example');
  console.log('='.repeat(50));

  // 1. Setup provider and configuration
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  const routerConfig: CrossPoolRouterConfig = {
    chainId: CHAIN_ID,
    rpcEndpoint: RPC_URL,
    maxHops: 3,
    maxPaths: 10,
    minLiquidityThreshold: ethers.parseEther('1000'),
    pathCacheTTL: 60000,
    poolRefreshInterval: 30000,
    gasSettings: {
      gasPrice: '20000000000',
      gasLimit: 8000000,
      maxFeePerGas: '20000000000',
      maxPriorityFeePerGas: '2000000000'
    },
    defaultSlippage: 1.0,
    enableCaching: true
  };

  // 2. Create router service
  const router = new CrossPoolRouterService(routerConfig, provider);

  // 3. Example tokens (from RiseChain deployment)
  const USDC: Token = {
    address: '0x1D4a4B63733B36400BFD388937F5bE6CBd5902cb',
    symbol: 'USDC',
    decimals: 18,
    chainId: CHAIN_ID
  };

  const USDT: Token = {
    address: '0x2250AD5DE3eCb3C84CC0deBbfaE145E5B99835Cd',
    symbol: 'USDT',
    decimals: 18,
    chainId: CHAIN_ID
  };

  const DAI: Token = {
    address: '0xAdE16eAbd36F0E9dea4224a1C27FA973dDe78d43',
    symbol: 'DAI',
    decimals: 18,
    chainId: CHAIN_ID
  };

  // 4. Example pools (from RiseChain deployment)
  const pools: Pool[] = [
    {
      address: '0x36A3950Ed31A2875dA4df2588528BDA6d9F4709A',
      tokenPair: { tokenA: USDC, tokenB: USDT, chainId: CHAIN_ID },
      reserves: {
        tokenA: ethers.parseEther('100'),
        tokenB: ethers.parseEther('100'),
        totalSupply: ethers.parseEther('100')
      },
      metrics: {
        volume24h: 0n,
        fees24h: 0n,
        transactions24h: 0,
        lastUpdated: Date.now()
      },
      sammParams: {
        beta1: -1050000,
        rmin: 1000,
        rmax: 12000,
        c: 10400
      },
      fees: {
        tradeFeeNumerator: 25,
        tradeFeeDenominator: 10000,
        ownerFeeNumerator: 5,
        ownerFeeDenominator: 10000
      },
      status: 'active',
      chainId: CHAIN_ID
    },
    {
      address: '0xD80bAf05268B9c8eF662ce14D5D92860CF3D3B90',
      tokenPair: { tokenA: USDC, tokenB: DAI, chainId: CHAIN_ID },
      reserves: {
        tokenA: ethers.parseEther('200'),
        tokenB: ethers.parseEther('200'),
        totalSupply: ethers.parseEther('200')
      },
      metrics: {
        volume24h: 0n,
        fees24h: 0n,
        transactions24h: 0,
        lastUpdated: Date.now()
      },
      sammParams: {
        beta1: -1050000,
        rmin: 1000,
        rmax: 12000,
        c: 10400
      },
      fees: {
        tradeFeeNumerator: 25,
        tradeFeeDenominator: 10000,
        ownerFeeNumerator: 5,
        ownerFeeDenominator: 10000
      },
      status: 'active',
      chainId: CHAIN_ID
    }
  ];

  // 5. Initialize router with pool data
  await router.initialize(pools);

  // 6. Example 1: Direct swap path discovery
  console.log('\n📍 Example 1: Direct USDC -> USDT swap');
  try {
    const directSwapResult = await router.discoverPaths({
      tokenIn: USDC,
      tokenOut: USDT,
      amountOut: ethers.parseEther('10'), // Want 10 USDT
      chainId: CHAIN_ID,
      slippageTolerance: 1.0
    });

    console.log(`Found ${directSwapResult.paths.length} paths`);
    if (directSwapResult.bestPath) {
      console.log(`Best path: ${directSwapResult.bestPath.hops.length} hops`);
      console.log(`Total input needed: ${ethers.formatEther(directSwapResult.bestPath.totalAmountIn)} USDC`);
      console.log(`Total fees: ${ethers.formatEther(directSwapResult.bestPath.totalFees)} USDC`);
      console.log(`Price impact: ${directSwapResult.bestPath.totalPriceImpact.toFixed(2)}%`);
    }
  } catch (error) {
    console.error('Direct swap failed:', error);
  }

  // 7. Example 2: Multi-hop swap path discovery (USDT -> DAI via USDC)
  console.log('\n📍 Example 2: Multi-hop USDT -> DAI swap (via USDC)');
  try {
    const multiHopResult = await router.discoverPaths({
      tokenIn: USDT,
      tokenOut: DAI,
      amountOut: ethers.parseEther('5'), // Want 5 DAI
      maxHops: 2,
      chainId: CHAIN_ID,
      slippageTolerance: 2.0
    });

    console.log(`Found ${multiHopResult.paths.length} multi-hop paths`);
    if (multiHopResult.bestPath) {
      console.log(`Best path: ${multiHopResult.bestPath.hops.length} hops`);
      multiHopResult.bestPath.hops.forEach((hop, i) => {
        console.log(`  Hop ${i + 1}: ${hop.tokenIn.symbol} -> ${hop.tokenOut.symbol}`);
        console.log(`    Pool: ${hop.pool.address}`);
        console.log(`    Expected in: ${ethers.formatEther(hop.expectedAmountIn)}`);
        console.log(`    Expected out: ${ethers.formatEther(hop.expectedAmountOut)}`);
      });
      console.log(`Total input needed: ${ethers.formatEther(multiHopResult.bestPath.totalAmountIn)} USDT`);
    }
  } catch (error) {
    console.error('Multi-hop swap failed:', error);
  }

  // 8. Example 3: Path validation
  console.log('\n📍 Example 3: Path validation');
  const availablePairs = router.getAvailableTokenPairs();
  console.log(`Available token pairs: ${availablePairs.length}`);
  availablePairs.forEach(pair => {
    console.log(`  ${pair.tokenA.symbol}/${pair.tokenB.symbol}`);
  });

  // 9. Example 4: Start API server (commented out for example)
  /*
  console.log('\n📍 Example 4: Starting API server');
  const apiConfig = {
    port: 3001,
    corsOrigins: ['http://localhost:3000'],
    rateLimitWindowMs: 15 * 60 * 1000, // 15 minutes
    rateLimitMaxRequests: 100,
    enableLogging: true
  };
  
  await router.startAPI(apiConfig);
  console.log('API server started on port 3001');
  */

  // 10. Example 5: Using the SDK (if API is running)
  console.log('\n📍 Example 5: SDK usage example');
  const sdk = new CrossPoolRouterSDK({
    baseURL: 'http://localhost:3001',
    timeout: 30000,
    retries: 3
  });

  try {
    // This would work if the API server was running
    console.log('SDK created - would connect to API at http://localhost:3001');
    console.log('Example SDK calls:');
    console.log('  - await sdk.healthCheck()');
    console.log('  - await sdk.discoverPaths({ tokenIn: USDC, tokenOut: USDT, amountOut: "10" })');
    console.log('  - await sdk.getQuote({ tokenIn: USDC, tokenOut: USDT, amountOut: "10" })');
    console.log('  - await sdk.executeSwap({ path, userAddress, deadline })');
  } catch (error) {
    console.log('SDK example (API not running)');
  }

  // 11. Get service statistics
  console.log('\n📊 Service Statistics:');
  const stats = router.getStats();
  console.log('Path Discovery:', stats.pathDiscovery);
  console.log('Shard Selector:', stats.shardSelector);
  console.log('Atomic Execution:', stats.atomicExecution);

  console.log('\n✅ Cross-Pool Router integration example completed!');
}

// Run the example
if (require.main === module) {
  main()
    .then(() => {
      console.log('\n🎉 Example completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Example failed:', error);
      process.exit(1);
    });
}

export { main as runIntegrationExample };