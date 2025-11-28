#!/usr/bin/env node

/**
 * Comprehensive API Testing Script
 * Tests all SAMM backend services across RiseChain and Monad testnets
 */

require('dotenv').config();
const axios = require('axios');
const { ethers } = require('ethers');

// Load deployment data
const riseChainData = require('./deployment-data/risechain-multi-shard-1764273559148.json');
const monadData = require('./deployment-data/monad-multi-shard-1764330063991.json');

const SERVICES = {
  multiShard: 'http://localhost:3000',
  multiChain: 'http://localhost:3002'
};

const CHAINS = {
  risechain: {
    name: 'RiseChain Testnet',
    rpc: 'https://testnet.riselabs.xyz',
    chainId: 11155931,
    data: riseChainData
  },
  monad: {
    name: 'Monad Testnet', 
    rpc: 'https://testnet-rpc.monad.xyz',
    chainId: 10143,
    data: monadData
  }
};

class APITester {
  constructor() {
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async test(name, testFn) {
    this.results.total++;
    console.log(`\n🧪 Testing: ${name}`);
    
    try {
      const result = await testFn();
      console.log(`✅ PASSED: ${name}`);
      this.results.passed++;
      this.results.tests.push({ name, status: 'PASSED', result });
      return result;
    } catch (error) {
      console.log(`❌ FAILED: ${name}`);
      console.log(`   Error: ${error.message}`);
      this.results.failed++;
      this.results.tests.push({ name, status: 'FAILED', error: error.message });
      return null;
    }
  }

  async testHealthChecks() {
    console.log('\n🏥 === HEALTH CHECKS ===');
    
    await this.test('Multi-Shard Backend Health', async () => {
      const response = await axios.get(`${SERVICES.multiShard}/health`);
      if (response.data.status !== 'ok') throw new Error('Service not healthy');
      return response.data;
    });

    await this.test('Multi-Chain Server Health', async () => {
      const response = await axios.get(`${SERVICES.multiChain}/health`);
      if (response.data.status !== 'ok') throw new Error('Service not healthy');
      return response.data;
    });
  }

  async testMultiShardAPIs() {
    console.log('\n🔀 === MULTI-SHARD APIs ===');

    await this.test('Get All Shards Info', async () => {
      const response = await axios.get(`${SERVICES.multiShard}/api/shards`);
      const shards = response.data.shards;
      
      if (!shards['USDC/USDT'] || shards['USDC/USDT'].length !== 3) {
        throw new Error('Expected 3 USDC/USDT shards');
      }
      if (!shards['USDC/DAI'] || shards['USDC/DAI'].length !== 2) {
        throw new Error('Expected 2 USDC/DAI shards');
      }
      
      return { totalShards: Object.values(shards).flat().length };
    });

    await this.test('Find Best Shard for USDC→USDT Swap', async () => {
      const swapRequest = {
        amountOut: ethers.parseUnits('1', 6).toString(), // 1 USDT
        tokenIn: riseChainData.contracts.tokens.find(t => t.symbol === 'USDC').address,
        tokenOut: riseChainData.contracts.tokens.find(t => t.symbol === 'USDT').address
      };

      const response = await axios.post(`${SERVICES.multiShard}/api/swap/best-shard`, swapRequest);
      const result = response.data;
      
      if (!result.bestShard) throw new Error('No best shard found');
      if (!result.cSmallerBetterDemonstrated) throw new Error('c-smaller-better not demonstrated');
      
      return {
        bestShard: result.bestShard.shardName,
        totalCost: result.bestShard.totalCost,
        allShardsCount: result.allShards.length
      };
    });

    await this.test('Cross-Pool Routing USDC→DAI', async () => {
      const routeRequest = {
        amountIn: ethers.parseUnits('10', 6).toString(), // 10 USDC
        tokenIn: riseChainData.contracts.tokens.find(t => t.symbol === 'USDC').address,
        tokenOut: riseChainData.contracts.tokens.find(t => t.symbol === 'DAI').address
      };

      const response = await axios.post(`${SERVICES.multiShard}/api/swap/cross-pool`, routeRequest);
      const result = response.data;
      
      if (!result.route) throw new Error('No route found');
      if (!result.steps || result.steps.length === 0) throw new Error('No routing steps');
      
      return {
        route: result.route,
        pathLength: result.path.length,
        stepsCount: result.steps.length
      };
    });

    await this.test('Get Specific Shard Info', async () => {
      const shardAddress = riseChainData.contracts.shards[0].address;
      const response = await axios.get(`${SERVICES.multiShard}/api/shard/${shardAddress}`);
      const shard = response.data;
      
      if (!shard.name || !shard.reserves) throw new Error('Invalid shard data');
      
      return {
        shardName: shard.name,
        hasReserves: !!shard.reserves,
        hasSAMMParams: !!shard.sammParams
      };
    });
  }

  async testMultiChainAPIs() {
    console.log('\n🌐 === MULTI-CHAIN APIs ===');

    await this.test('Get Supported Chains', async () => {
      const response = await axios.get(`${SERVICES.multiChain}/api/chains`);
      const chains = response.data.chains;
      
      if (!Array.isArray(chains) || chains.length === 0) {
        throw new Error('No chains returned');
      }
      
      const riseChain = chains.find(c => c.name === 'risechain');
      const monadChain = chains.find(c => c.name === 'monad');
      
      return {
        totalChains: chains.length,
        hasRiseChain: !!riseChain,
        hasMonadChain: !!monadChain
      };
    });

    await this.test('RiseChain Info', async () => {
      const response = await axios.get(`${SERVICES.multiChain}/api/risechain/info`);
      const info = response.data;
      
      if (info.network.chainId !== 11155931) {
        throw new Error('Wrong chain ID for RiseChain');
      }
      
      return {
        chainId: info.network.chainId,
        connected: info.status.connected,
        blockNumber: info.status.blockNumber
      };
    });

    await this.test('Monad Info', async () => {
      const response = await axios.get(`${SERVICES.multiChain}/api/monad/info`);
      const info = response.data;
      
      if (info.network.chainId !== 10143) {
        throw new Error('Wrong chain ID for Monad');
      }
      
      return {
        chainId: info.network.chainId,
        connected: info.status.connected,
        blockNumber: info.status.blockNumber
      };
    });

    await this.test('RiseChain Pools', async () => {
      const response = await axios.get(`${SERVICES.multiChain}/api/risechain/pools`);
      const pools = response.data.pools;
      
      if (!Array.isArray(pools) || pools.length !== 5) {
        throw new Error('Expected 5 pools on RiseChain');
      }
      
      return {
        totalPools: pools.length,
        poolNames: pools.map(p => p.name)
      };
    });

    await this.test('Chain Isolation Test', async () => {
      const response = await axios.get(`${SERVICES.multiChain}/api/isolation/test`);
      const isolation = response.data.isolationTest;
      
      if (!isolation.passed) {
        throw new Error('Chain isolation test failed');
      }
      
      return {
        passed: isolation.passed,
        successfulChains: isolation.successfulChains,
        totalChains: isolation.totalChains
      };
    });
  }

  async testChainSpecificOperations() {
    console.log('\n⛓️ === CHAIN-SPECIFIC OPERATIONS ===');

    // Test RiseChain operations
    await this.test('RiseChain: Verify Deployment Data', async () => {
      const provider = new ethers.JsonRpcProvider(CHAINS.risechain.rpc);
      
      // Test first shard contract
      const shardAddress = riseChainData.contracts.shards[0].address;
      const code = await provider.getCode(shardAddress);
      
      if (code === '0x') throw new Error('Shard contract not deployed');
      
      return {
        chainId: await provider.getNetwork().then(n => Number(n.chainId)),
        shardDeployed: code !== '0x',
        totalShards: riseChainData.contracts.shards.length
      };
    });

    // Test Monad operations  
    await this.test('Monad: Verify Deployment Data', async () => {
      const provider = new ethers.JsonRpcProvider(CHAINS.monad.rpc);
      
      // Test first shard contract
      const shardAddress = monadData.contracts.shards[0].address;
      const code = await provider.getCode(shardAddress);
      
      if (code === '0x') throw new Error('Shard contract not deployed');
      
      return {
        chainId: await provider.getNetwork().then(n => Number(n.chainId)),
        shardDeployed: code !== '0x',
        totalShards: monadData.contracts.shards.length
      };
    });
  }

  async testSAMMProperties() {
    console.log('\n🔬 === SAMM PROPERTIES VALIDATION ===');

    await this.test('C-Smaller-Better Property', async () => {
      const swapRequest = {
        amountOut: ethers.parseUnits('1', 6).toString(),
        tokenIn: riseChainData.contracts.tokens.find(t => t.symbol === 'USDC').address,
        tokenOut: riseChainData.contracts.tokens.find(t => t.symbol === 'USDT').address
      };

      const response = await axios.post(`${SERVICES.multiShard}/api/swap/best-shard`, swapRequest);
      const shards = response.data.allShards;
      
      // Verify smallest shard has best rate
      const sortedByLiquidity = [...shards].sort((a, b) => 
        parseFloat(a.liquidity) - parseFloat(b.liquidity)
      );
      const sortedByCost = [...shards].sort((a, b) => 
        parseFloat(a.totalCost) - parseFloat(b.totalCost)
      );
      
      const smallestShard = sortedByLiquidity[0];
      const bestRateShard = sortedByCost[0];
      
      return {
        smallestShardName: smallestShard.shardName,
        bestRateShardName: bestRateShard.shardName,
        cSmallerBetterHolds: smallestShard.shardName === bestRateShard.shardName,
        liquidityDifference: parseFloat(sortedByLiquidity[1].liquidity) - parseFloat(sortedByLiquidity[0].liquidity)
      };
    });

    await this.test('Multi-Shard Architecture Validation', async () => {
      const response = await axios.get(`${SERVICES.multiShard}/api/shards`);
      const shards = response.data.shards;
      
      const usdcUsdtShards = shards['USDC/USDT'] || [];
      const usdcDaiShards = shards['USDC/DAI'] || [];
      
      // Verify different liquidity levels
      const liquidityLevels = usdcUsdtShards.map(s => parseFloat(s.liquidity));
      const hasVariedLiquidity = new Set(liquidityLevels).size > 1;
      
      return {
        totalPairs: Object.keys(shards).length,
        usdcUsdtShards: usdcUsdtShards.length,
        usdcDaiShards: usdcDaiShards.length,
        hasVariedLiquidity,
        liquidityLevels
      };
    });
  }

  async runAllTests() {
    console.log('🚀 SAMM Comprehensive API Testing');
    console.log('==================================');
    console.log(`Testing against:`);
    console.log(`- Multi-Shard Backend: ${SERVICES.multiShard}`);
    console.log(`- Multi-Chain Server: ${SERVICES.multiChain}`);
    console.log(`- RiseChain: ${CHAINS.risechain.rpc}`);
    console.log(`- Monad: ${CHAINS.monad.rpc}`);

    await this.testHealthChecks();
    await this.testMultiShardAPIs();
    await this.testMultiChainAPIs();
    await this.testChainSpecificOperations();
    await this.testSAMMProperties();

    this.printSummary();
  }

  printSummary() {
    console.log('\n📊 === TEST SUMMARY ===');
    console.log(`Total Tests: ${this.results.total}`);
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`Success Rate: ${((this.results.passed / this.results.total) * 100).toFixed(1)}%`);

    if (this.results.failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.tests
        .filter(t => t.status === 'FAILED')
        .forEach(t => console.log(`   - ${t.name}: ${t.error}`));
    }

    console.log('\n🎯 === API ENDPOINTS SUMMARY ===');
    console.log('Multi-Shard Backend (Port 3000):');
    console.log('  GET  /health');
    console.log('  GET  /api/shards');
    console.log('  POST /api/swap/best-shard');
    console.log('  POST /api/swap/cross-pool');
    console.log('  GET  /api/shard/:address');
    
    console.log('\nMulti-Chain Server (Port 3002):');
    console.log('  GET  /health');
    console.log('  GET  /api/chains');
    console.log('  GET  /api/:chain/info');
    console.log('  GET  /api/:chain/pools');
    console.log('  GET  /api/isolation/test');

    console.log('\n🔗 Quick Test Commands:');
    console.log(`curl ${SERVICES.multiShard}/health`);
    console.log(`curl ${SERVICES.multiChain}/api/chains`);
    console.log(`curl ${SERVICES.multiShard}/api/shards`);
  }
}

// Run tests
async function main() {
  const tester = new APITester();
  
  try {
    await tester.runAllTests();
  } catch (error) {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = APITester;