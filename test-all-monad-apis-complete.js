#!/usr/bin/env node

/**
 * COMPLETE MONAD API TESTING
 * Tests ALL available APIs for Monad multi-shard backend
 */

require('dotenv').config();
const axios = require('axios');
const { ethers } = require('ethers');

// Configuration
const CONFIG = {
  API_BASE_URL: 'http://localhost:3000',
  RPC_URL: 'https://testnet-rpc.monad.xyz',
  PRIVATE_KEY: process.env.PRIVATE_KEY
};

// Use oldest Monad deployment
const DEPLOYMENT_DATA = require('./deployment-data/monad-multi-shard-1764330063991.json');

class CompleteAPITester {
  constructor() {
    this.results = {
      basicAPIs: [],
      swapAPIs: [],
      shardAPIs: [],
      routingAPIs: [],
      chainSpecificAPIs: []
    };
  }

  async testBasicAPIs() {
    console.log('🔍 Testing Basic APIs...\n');

    const basicTests = [
      {
        name: 'Health Check',
        method: 'GET',
        endpoint: '/health',
        description: 'Check if backend is running'
      },
      {
        name: 'Legacy Pool Info',
        method: 'GET', 
        endpoint: '/api/pool/info',
        description: 'Get legacy pool information'
      }
    ];

    for (const test of basicTests) {
      try {
        console.log(`📡 ${test.name}...`);
        const response = await axios({
          method: test.method,
          url: `${CONFIG.API_BASE_URL}${test.endpoint}`,
          timeout: 10000
        });
        
        console.log(`   ✅ Status: ${response.status}`);
        console.log(`   📊 Response:`, JSON.stringify(response.data, null, 2));
        
        this.results.basicAPIs.push({
          name: test.name,
          success: true,
          status: response.status,
          data: response.data
        });
        
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        this.results.basicAPIs.push({
          name: test.name,
          success: false,
          error: error.message
        });
      }
      console.log('');
    }
  }

  async testShardAPIs() {
    console.log('🏗️ Testing Shard APIs...\n');

    const shardTests = [
      {
        name: 'All Shards Info',
        method: 'GET',
        endpoint: '/api/shards',
        description: 'Get information about all shards'
      }
    ];

    // Test getting all shards
    for (const test of shardTests) {
      try {
        console.log(`📡 ${test.name}...`);
        const response = await axios({
          method: test.method,
          url: `${CONFIG.API_BASE_URL}${test.endpoint}`,
          timeout: 10000
        });
        
        console.log(`   ✅ Status: ${response.status}`);
        console.log(`   📊 Total Pairs: ${Object.keys(response.data.shards).length}`);
        
        // Show shard details
        Object.entries(response.data.shards).forEach(([pair, shards]) => {
          console.log(`   📈 ${pair}: ${shards.length} shards`);
          shards.forEach((shard, i) => {
            const reserveA = ethers.formatUnits(shard.reserves.tokenA, 6);
            const reserveB = ethers.formatUnits(shard.reserves.tokenB, 6);
            console.log(`      ${i + 1}. ${shard.name}: ${reserveA}/${reserveB} reserves`);
          });
        });
        
        this.results.shardAPIs.push({
          name: test.name,
          success: true,
          status: response.status,
          shardsCount: Object.keys(response.data.shards).length
        });
        
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        this.results.shardAPIs.push({
          name: test.name,
          success: false,
          error: error.message
        });
      }
      console.log('');
    }

    // Test individual shard endpoints
    const shardAddresses = [
      '0x686ff8090b18C0DF4f828f02deAf122CeC40B1DE', // USDC/USDT-1
      '0x0481CD694F9C4EfC925C694f49835547404c0460', // USDC/USDT-2
      '0x49ac6067BB0b6d5b793e9F3af3CD78b3a108AA5a'  // USDC/USDT-3
    ];

    for (const address of shardAddresses) {
      try {
        console.log(`📡 Individual Shard Info (${address.slice(0, 10)}...)...`);
        const response = await axios.get(`${CONFIG.API_BASE_URL}/api/shard/${address}`);
        
        console.log(`   ✅ Status: ${response.status}`);
        console.log(`   📊 Shard: ${response.data.name}`);
        console.log(`   💰 Reserves: ${ethers.formatUnits(response.data.reserves.tokenA, 6)}/${ethers.formatUnits(response.data.reserves.tokenB, 6)}`);
        console.log(`   🎯 C Parameter: ${response.data.sammParams.c}`);
        
        this.results.shardAPIs.push({
          name: `Individual Shard ${response.data.name}`,
          success: true,
          status: response.status,
          shardName: response.data.name
        });
        
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        this.results.shardAPIs.push({
          name: `Individual Shard ${address.slice(0, 10)}`,
          success: false,
          error: error.message
        });
      }
      console.log('');
    }
  }

  async testSwapAPIs() {
    console.log('🔄 Testing Swap APIs...\n');

    const usdcAddress = DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'USDC').address;
    const usdtAddress = DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'USDT').address;
    const daiAddress = DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'DAI').address;

    const swapTests = [
      {
        name: 'Best Shard for Small Swap (10 USDT)',
        endpoint: '/api/swap/best-shard',
        data: {
          amountOut: ethers.parseUnits('10', 6).toString(),
          tokenIn: usdcAddress,
          tokenOut: usdtAddress
        }
      },
      {
        name: 'Best Shard for Medium Swap (100 USDT)',
        endpoint: '/api/swap/best-shard',
        data: {
          amountOut: ethers.parseUnits('100', 6).toString(),
          tokenIn: usdcAddress,
          tokenOut: usdtAddress
        }
      },
      {
        name: 'Best Shard for Large Swap (500 USDT)',
        endpoint: '/api/swap/best-shard',
        data: {
          amountOut: ethers.parseUnits('500', 6).toString(),
          tokenIn: usdcAddress,
          tokenOut: usdtAddress
        }
      }
    ];

    for (const test of swapTests) {
      try {
        console.log(`📡 ${test.name}...`);
        const response = await axios.post(`${CONFIG.API_BASE_URL}${test.endpoint}`, test.data);
        
        console.log(`   ✅ Status: ${response.status}`);
        console.log(`   🏆 Best Shard: ${response.data.bestShard.shardName}`);
        console.log(`   💰 Total Cost: ${ethers.formatUnits(response.data.bestShard.totalCost, 6)} USDC`);
        console.log(`   📈 Price Impact: ${response.data.bestShard.priceImpact}%`);
        console.log(`   🎯 C-Smaller-Better: ${response.data.cSmallerBetterDemonstrated}`);
        
        // Show all shard comparison
        console.log(`   📊 All Shard Costs:`);
        response.data.allShards.forEach((shard, i) => {
          const cost = ethers.formatUnits(shard.totalCost, 6);
          const marker = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
          console.log(`      ${marker} ${shard.shardName}: ${cost} USDC`);
        });
        
        this.results.swapAPIs.push({
          name: test.name,
          success: true,
          status: response.status,
          bestShard: response.data.bestShard.shardName,
          cSmallerBetter: response.data.cSmallerBetterDemonstrated
        });
        
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        this.results.swapAPIs.push({
          name: test.name,
          success: false,
          error: error.message
        });
      }
      console.log('');
    }
  }

  async testRoutingAPIs() {
    console.log('🔀 Testing Routing APIs...\n');

    const usdcAddress = DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'USDC').address;
    const usdtAddress = DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'USDT').address;
    const daiAddress = DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'DAI').address;

    const routingTests = [
      {
        name: 'Direct Route USDC->USDT',
        endpoint: '/api/swap/cross-pool',
        data: {
          amountIn: ethers.parseUnits('100', 6).toString(),
          tokenIn: usdcAddress,
          tokenOut: usdtAddress
        }
      },
      {
        name: 'Multi-hop Route USDC->DAI (should fail - no DAI pools)',
        endpoint: '/api/swap/cross-pool',
        data: {
          amountIn: ethers.parseUnits('50', 6).toString(),
          tokenIn: usdcAddress,
          tokenOut: daiAddress
        }
      },
      {
        name: 'Multi-hop Route USDT->DAI via USDC (should fail - no DAI pools)',
        endpoint: '/api/swap/cross-pool',
        data: {
          amountIn: ethers.parseUnits('75', 6).toString(),
          tokenIn: usdtAddress,
          tokenOut: daiAddress
        }
      }
    ];

    for (const test of routingTests) {
      try {
        console.log(`📡 ${test.name}...`);
        const response = await axios.post(`${CONFIG.API_BASE_URL}${test.endpoint}`, test.data);
        
        console.log(`   ✅ Status: ${response.status}`);
        console.log(`   🛤️  Route Type: ${response.data.route}`);
        console.log(`   📍 Path: ${response.data.path.join(' -> ')}`);
        console.log(`   🏗️ Shards Used: ${response.data.shards.join(', ')}`);
        console.log(`   💰 Amount In: ${ethers.formatUnits(response.data.amountIn, 6)}`);
        console.log(`   💰 Amount Out: ${ethers.formatUnits(response.data.amountOut, 6)}`);
        
        if (response.data.steps) {
          console.log(`   📋 Steps:`);
          response.data.steps.forEach((step, i) => {
            console.log(`      ${i + 1}. ${step.from} -> ${step.to} via ${step.shard}`);
          });
        }
        
        this.results.routingAPIs.push({
          name: test.name,
          success: true,
          status: response.status,
          routeType: response.data.route,
          pathLength: response.data.path.length
        });
        
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        if (error.response) {
          console.log(`   📊 Error Response:`, error.response.data);
        }
        this.results.routingAPIs.push({
          name: test.name,
          success: false,
          error: error.message,
          errorResponse: error.response?.data
        });
      }
      console.log('');
    }
  }

  async testChainSpecificAPIs() {
    console.log('⛓️ Testing Chain-Specific APIs...\n');

    // Check if multi-chain endpoints exist
    const chainTests = [
      {
        name: 'Multi-Chain Health Check',
        method: 'GET',
        endpoint: '/api/chains/health',
        description: 'Check multi-chain backend health'
      },
      {
        name: 'Monad Chain Status',
        method: 'GET',
        endpoint: '/api/chains/monad/status',
        description: 'Get Monad chain specific status'
      },
      {
        name: 'Monad Shards',
        method: 'GET',
        endpoint: '/api/chains/monad/shards',
        description: 'Get Monad specific shards'
      }
    ];

    for (const test of chainTests) {
      try {
        console.log(`📡 ${test.name}...`);
        const response = await axios({
          method: test.method,
          url: `${CONFIG.API_BASE_URL}${test.endpoint}`,
          timeout: 5000
        });
        
        console.log(`   ✅ Status: ${response.status}`);
        console.log(`   📊 Response:`, JSON.stringify(response.data, null, 2));
        
        this.results.chainSpecificAPIs.push({
          name: test.name,
          success: true,
          status: response.status,
          data: response.data
        });
        
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message} (This is expected if multi-chain backend not running)`);
        this.results.chainSpecificAPIs.push({
          name: test.name,
          success: false,
          error: error.message,
          expected: true
        });
      }
      console.log('');
    }
  }

  async testAllEndpoints() {
    console.log('🔍 Testing ALL Possible Endpoints...\n');

    // Test various endpoint patterns
    const endpointTests = [
      '/api/pools',
      '/api/tokens',
      '/api/factory',
      '/api/router',
      '/api/liquidity',
      '/api/stats',
      '/api/config',
      '/status',
      '/info'
    ];

    for (const endpoint of endpointTests) {
      try {
        console.log(`📡 Testing ${endpoint}...`);
        const response = await axios.get(`${CONFIG.API_BASE_URL}${endpoint}`, { timeout: 3000 });
        
        console.log(`   ✅ Status: ${response.status}`);
        console.log(`   📊 Found endpoint: ${endpoint}`);
        
      } catch (error) {
        if (error.response?.status === 404) {
          console.log(`   ⚪ Not found: ${endpoint}`);
        } else {
          console.log(`   ❌ Error: ${error.message}`);
        }
      }
    }
    console.log('');
  }

  generateReport() {
    console.log('📋 COMPREHENSIVE API TEST REPORT');
    console.log('='.repeat(50));
    
    const categories = [
      { name: 'Basic APIs', results: this.results.basicAPIs },
      { name: 'Shard APIs', results: this.results.shardAPIs },
      { name: 'Swap APIs', results: this.results.swapAPIs },
      { name: 'Routing APIs', results: this.results.routingAPIs },
      { name: 'Chain-Specific APIs', results: this.results.chainSpecificAPIs }
    ];

    let totalTests = 0;
    let totalPassed = 0;

    categories.forEach(category => {
      const passed = category.results.filter(r => r.success).length;
      const total = category.results.length;
      totalTests += total;
      totalPassed += passed;
      
      console.log(`\n📊 ${category.name}: ${passed}/${total} passed`);
      category.results.forEach(result => {
        const status = result.success ? '✅' : '❌';
        console.log(`   ${status} ${result.name}`);
      });
    });

    console.log(`\n🎯 OVERALL RESULTS: ${totalPassed}/${totalTests} tests passed`);
    console.log(`📈 Success Rate: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);
    
    return {
      totalTests,
      totalPassed,
      successRate: (totalPassed / totalTests) * 100,
      results: this.results
    };
  }

  async runAllTests() {
    console.log('🚀 Starting Comprehensive Monad API Testing');
    console.log('='.repeat(50));
    console.log(`🔗 API Base URL: ${CONFIG.API_BASE_URL}`);
    console.log(`📊 Using deployment: ${DEPLOYMENT_DATA.timestamp}`);
    console.log('');

    try {
      await this.testBasicAPIs();
      await this.testShardAPIs();
      await this.testSwapAPIs();
      await this.testRoutingAPIs();
      await this.testChainSpecificAPIs();
      await this.testAllEndpoints();
      
      const report = this.generateReport();
      
      console.log('\n🎉 All API tests completed!');
      return report;
      
    } catch (error) {
      console.error('❌ Test execution failed:', error);
      throw error;
    }
  }
}

// Run the test if called directly
if (require.main === module) {
  const tester = new CompleteAPITester();
  tester.runAllTests()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

module.exports = CompleteAPITester;