#!/usr/bin/env node

/**
 * Comprehensive Monad Multi-Shard SAMM Testing
 * Tests all APIs and executes real transactions including multi-hop swaps
 * Uses the oldest Monad deployment: monad-multi-shard-1764330063991.json
 */

require('dotenv').config();
const { ethers } = require('ethers');
const axios = require('axios');

// Use oldest Monad deployment
const DEPLOYMENT_DATA = require('./deployment-data/monad-multi-shard-1764330063991.json');

// Configuration
const CONFIG = {
  RPC_URL: 'https://testnet-rpc.monad.xyz',
  API_BASE_URL: 'http://localhost:3000',
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  CHAIN_ID: 10143,
  GAS_LIMIT: 500000,
  GAS_PRICE: '20000000000' // 20 gwei
};

// Contract ABIs
const SAMM_POOL_ABI = [
  "function swap(uint256 amountOut, address tokenIn, address tokenOut, address to, bytes calldata data) external returns (uint256 amountIn)",
  "function addLiquidity(uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
  "function getReserves() view returns (uint256 reserveA, uint256 reserveB)",
  "function calculateSwapSAMM(uint256 amountOut, address tokenIn, address tokenOut) view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))",
  "function getPoolState() view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))",
  "function getSAMMParams() view returns (int256 beta1, uint256 rmin, uint256 rmax, uint256 c)"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)"
];

class MonadSAMMTester {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);
    this.contracts = {};
    this.tokens = {};
    this.results = {
      apiTests: [],
      liquidityAdditions: [],
      swapExecutions: [],
      multiHopSwaps: []
    };
  }

  async initialize() {
    console.log('🚀 Initializing Monad SAMM Comprehensive Tester');
    console.log(`📊 Using deployment: ${DEPLOYMENT_DATA.timestamp}`);
    console.log(`🔗 Network: ${DEPLOYMENT_DATA.network} (Chain ID: ${DEPLOYMENT_DATA.chainId})`);
    console.log(`👤 Wallet: ${this.wallet.address}`);
    
    // Initialize token contracts
    for (const token of DEPLOYMENT_DATA.contracts.tokens) {
      this.tokens[token.symbol] = new ethers.Contract(
        token.address,
        ERC20_ABI,
        this.wallet
      );
      console.log(`✅ ${token.symbol}: ${token.address}`);
    }

    // Initialize shard contracts
    for (const shard of DEPLOYMENT_DATA.contracts.shards) {
      this.contracts[shard.name] = new ethers.Contract(
        shard.address,
        SAMM_POOL_ABI,
        this.wallet
      );
      console.log(`✅ ${shard.name}: ${shard.address}`);
    }

    console.log('\n');
  }

  async checkWalletBalances() {
    console.log('💰 Checking wallet balances...');
    const balances = {};
    
    for (const [symbol, contract] of Object.entries(this.tokens)) {
      try {
        const balance = await contract.balanceOf(this.wallet.address);
        const decimals = await contract.decimals();
        const formatted = ethers.formatUnits(balance, decimals);
        balances[symbol] = { raw: balance.toString(), formatted };
        console.log(`   ${symbol}: ${formatted}`);
      } catch (error) {
        console.error(`   ❌ Error checking ${symbol} balance:`, error.message);
      }
    }
    
    return balances;
  }

  async testAllAPIs() {
    console.log('🔍 Testing All API Endpoints...\n');

    const tests = [
      { name: 'Health Check', endpoint: '/health', method: 'GET' },
      { name: 'All Shards Info', endpoint: '/api/shards', method: 'GET' },
      { name: 'Legacy Pool Info', endpoint: '/api/pool/info', method: 'GET' },
      { 
        name: 'Best Shard for USDC->USDT', 
        endpoint: '/api/swap/best-shard', 
        method: 'POST',
        data: {
          amountOut: ethers.parseUnits('10', 6).toString(),
          tokenIn: DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'USDC').address,
          tokenOut: DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'USDT').address
        }
      },
      {
        name: 'Cross-Pool Route USDC->DAI',
        endpoint: '/api/swap/cross-pool',
        method: 'POST',
        data: {
          amountIn: ethers.parseUnits('50', 6).toString(),
          tokenIn: DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'USDC').address,
          tokenOut: DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'DAI').address
        }
      },
      {
        name: 'Multi-Hop Route USDT->DAI via USDC',
        endpoint: '/api/swap/cross-pool',
        method: 'POST',
        data: {
          amountIn: ethers.parseUnits('25', 6).toString(),
          tokenIn: DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'USDT').address,
          tokenOut: DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'DAI').address
        }
      }
    ];

    for (const test of tests) {
      try {
        console.log(`📡 Testing: ${test.name}`);
        
        const config = {
          method: test.method,
          url: `${CONFIG.API_BASE_URL}${test.endpoint}`,
          timeout: 10000
        };

        if (test.data) {
          config.data = test.data;
          config.headers = { 'Content-Type': 'application/json' };
        }

        const response = await axios(config);
        
        console.log(`   ✅ Status: ${response.status}`);
        console.log(`   📊 Response:`, JSON.stringify(response.data, null, 2));
        
        this.results.apiTests.push({
          name: test.name,
          success: true,
          status: response.status,
          data: response.data
        });
        
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        if (error.response) {
          console.log(`   📊 Error Response:`, error.response.data);
        }
        
        this.results.apiTests.push({
          name: test.name,
          success: false,
          error: error.message,
          response: error.response?.data
        });
      }
      
      console.log('');
    }
  }

  async addLiquidityToAllPools() {
    console.log('💧 Adding Liquidity to All Pools...\n');

    const liquidityAmounts = {
      'USDC/USDT-1': { amountA: '1000', amountB: '1000' },
      'USDC/USDT-2': { amountA: '5000', amountB: '5000' },
      'USDC/USDT-3': { amountA: '10000', amountB: '10000' },
      'USDC/DAI-1': { amountA: '2000', amountB: '2000' },
      'USDC/DAI-2': { amountA: '8000', amountB: '8000' }
    };

    for (const [shardName, amounts] of Object.entries(liquidityAmounts)) {
      try {
        console.log(`💧 Adding liquidity to ${shardName}...`);
        
        const shard = DEPLOYMENT_DATA.contracts.shards.find(s => s.name === shardName);
        const contract = this.contracts[shardName];
        
        // Get token contracts
        const tokenA = this.tokens[shard.tokenA === DEPLOYMENT_DATA.contracts.tokens[0].address ? 'USDC' : 
                                   shard.tokenA === DEPLOYMENT_DATA.contracts.tokens[1].address ? 'USDT' : 'DAI'];
        const tokenB = this.tokens[shard.tokenB === DEPLOYMENT_DATA.contracts.tokens[0].address ? 'USDC' : 
                                   shard.tokenB === DEPLOYMENT_DATA.contracts.tokens[1].address ? 'USDT' : 'DAI'];

        // Parse amounts (assuming 6 decimals for all tokens)
        const amountADesired = ethers.parseUnits(amounts.amountA, 6);
        const amountBDesired = ethers.parseUnits(amounts.amountB, 6);
        const amountAMin = amountADesired * 95n / 100n; // 5% slippage
        const amountBMin = amountBDesired * 95n / 100n;

        // Approve tokens
        console.log(`   📝 Approving tokens...`);
        const approveA = await tokenA.approve(shard.address, amountADesired);
        await approveA.wait();
        
        const approveB = await tokenB.approve(shard.address, amountBDesired);
        await approveB.wait();

        // Add liquidity
        console.log(`   💧 Adding liquidity...`);
        const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
        
        const tx = await contract.addLiquidity(
          amountADesired,
          amountBDesired,
          amountAMin,
          amountBMin,
          this.wallet.address,
          deadline,
          { gasLimit: CONFIG.GAS_LIMIT }
        );

        const receipt = await tx.wait();
        console.log(`   ✅ Liquidity added! Tx: ${receipt.hash}`);
        
        // Get updated reserves
        const reserves = await contract.getReserves();
        console.log(`   📊 New reserves: ${ethers.formatUnits(reserves[0], 6)} / ${ethers.formatUnits(reserves[1], 6)}`);

        this.results.liquidityAdditions.push({
          shard: shardName,
          success: true,
          txHash: receipt.hash,
          amountA: amounts.amountA,
          amountB: amounts.amountB,
          newReserves: {
            reserveA: ethers.formatUnits(reserves[0], 6),
            reserveB: ethers.formatUnits(reserves[1], 6)
          }
        });

      } catch (error) {
        console.log(`   ❌ Failed to add liquidity to ${shardName}:`, error.message);
        this.results.liquidityAdditions.push({
          shard: shardName,
          success: false,
          error: error.message
        });
      }
      
      console.log('');
    }
  }

  async executeDirectSwaps() {
    console.log('🔄 Executing Direct Swaps...\n');

    const swaps = [
      {
        name: 'USDC -> USDT (Small Shard)',
        shard: 'USDC/USDT-1',
        tokenIn: 'USDC',
        tokenOut: 'USDT',
        amountOut: '50'
      },
      {
        name: 'USDC -> USDT (Medium Shard)',
        shard: 'USDC/USDT-2',
        tokenIn: 'USDC',
        tokenOut: 'USDT',
        amountOut: '100'
      },
      {
        name: 'USDC -> USDT (Large Shard)',
        shard: 'USDC/USDT-3',
        tokenIn: 'USDC',
        tokenOut: 'USDT',
        amountOut: '200'
      },
      {
        name: 'USDC -> DAI (Small Shard)',
        shard: 'USDC/DAI-1',
        tokenIn: 'USDC',
        tokenOut: 'DAI',
        amountOut: '75'
      },
      {
        name: 'USDC -> DAI (Large Shard)',
        shard: 'USDC/DAI-2',
        tokenIn: 'USDC',
        tokenOut: 'DAI',
        amountOut: '150'
      }
    ];

    for (const swap of swaps) {
      try {
        console.log(`🔄 Executing: ${swap.name}`);
        
        const contract = this.contracts[swap.shard];
        const tokenInContract = this.tokens[swap.tokenIn];
        const tokenOutContract = this.tokens[swap.tokenOut];
        
        const tokenInAddress = DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === swap.tokenIn).address;
        const tokenOutAddress = DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === swap.tokenOut).address;
        
        const amountOut = ethers.parseUnits(swap.amountOut, 6);
        
        // Calculate required input
        const swapCalc = await contract.calculateSwapSAMM(amountOut, tokenInAddress, tokenOutAddress);
        console.log(`   📊 Required input: ${ethers.formatUnits(swapCalc.amountIn, 6)} ${swap.tokenIn}`);
        console.log(`   💰 Trade fee: ${ethers.formatUnits(swapCalc.tradeFee, 6)}`);
        
        // Approve input token
        const approveTx = await tokenInContract.approve(contract.target, swapCalc.amountIn);
        await approveTx.wait();
        
        // Execute swap
        const swapTx = await contract.swap(
          amountOut,
          tokenInAddress,
          tokenOutAddress,
          this.wallet.address,
          '0x',
          { gasLimit: CONFIG.GAS_LIMIT }
        );
        
        const receipt = await swapTx.wait();
        console.log(`   ✅ Swap executed! Tx: ${receipt.hash}`);
        
        this.results.swapExecutions.push({
          name: swap.name,
          success: true,
          txHash: receipt.hash,
          amountIn: ethers.formatUnits(swapCalc.amountIn, 6),
          amountOut: swap.amountOut,
          tradeFee: ethers.formatUnits(swapCalc.tradeFee, 6),
          shard: swap.shard
        });

      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        this.results.swapExecutions.push({
          name: swap.name,
          success: false,
          error: error.message
        });
      }
      
      console.log('');
    }
  }

  async executeMultiHopSwaps() {
    console.log('🔀 Executing Multi-Hop Swaps...\n');

    const multiHopSwaps = [
      {
        name: 'USDT -> DAI via USDC (Two-hop)',
        path: ['USDT', 'USDC', 'DAI'],
        amountIn: '100'
      },
      {
        name: 'DAI -> USDT via USDC (Two-hop reverse)',
        path: ['DAI', 'USDC', 'USDT'],
        amountIn: '100'
      }
    ];

    for (const multiSwap of multiHopSwaps) {
      try {
        console.log(`🔀 Executing: ${multiSwap.name}`);
        console.log(`   🛤️  Path: ${multiSwap.path.join(' -> ')}`);
        
        let currentAmount = ethers.parseUnits(multiSwap.amountIn, 6);
        const steps = [];
        
        for (let i = 0; i < multiSwap.path.length - 1; i++) {
          const tokenIn = multiSwap.path[i];
          const tokenOut = multiSwap.path[i + 1];
          
          console.log(`   Step ${i + 1}: ${tokenIn} -> ${tokenOut}`);
          
          // Find appropriate shard for this pair
          const pairName = `${tokenIn}/${tokenOut}` === 'USDT/USDC' ? 'USDC/USDT' : 
                          `${tokenIn}/${tokenOut}` === 'DAI/USDC' ? 'USDC/DAI' : 
                          `${tokenIn}/${tokenOut}`;
          
          const shard = DEPLOYMENT_DATA.contracts.shards.find(s => 
            s.pairName === pairName || s.pairName === `${tokenOut}/${tokenIn}`
          );
          
          if (!shard) {
            throw new Error(`No shard found for pair ${tokenIn}/${tokenOut}`);
          }
          
          const contract = this.contracts[shard.name];
          const tokenInContract = this.tokens[tokenIn];
          const tokenInAddress = DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === tokenIn).address;
          const tokenOutAddress = DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === tokenOut).address;
          
          // For multi-hop, we need to calculate how much we can get out with our current amount in
          // This is a simplified approach - in production you'd want more sophisticated routing
          const swapCalc = await contract.calculateSwapSAMM(currentAmount, tokenInAddress, tokenOutAddress);
          
          console.log(`     Input: ${ethers.formatUnits(currentAmount, 6)} ${tokenIn}`);
          console.log(`     Output: ${ethers.formatUnits(swapCalc.amountOut, 6)} ${tokenOut}`);
          
          // Approve and execute
          const approveTx = await tokenInContract.approve(contract.target, currentAmount);
          await approveTx.wait();
          
          const swapTx = await contract.swap(
            swapCalc.amountOut,
            tokenInAddress,
            tokenOutAddress,
            this.wallet.address,
            '0x',
            { gasLimit: CONFIG.GAS_LIMIT }
          );
          
          const receipt = await swapTx.wait();
          console.log(`     ✅ Step completed! Tx: ${receipt.hash}`);
          
          steps.push({
            step: i + 1,
            from: tokenIn,
            to: tokenOut,
            shard: shard.name,
            amountIn: ethers.formatUnits(currentAmount, 6),
            amountOut: ethers.formatUnits(swapCalc.amountOut, 6),
            txHash: receipt.hash
          });
          
          currentAmount = swapCalc.amountOut;
        }
        
        console.log(`   🎉 Multi-hop swap completed!`);
        console.log(`   📊 Final output: ${ethers.formatUnits(currentAmount, 6)} ${multiSwap.path[multiSwap.path.length - 1]}`);
        
        this.results.multiHopSwaps.push({
          name: multiSwap.name,
          success: true,
          path: multiSwap.path,
          initialAmount: multiSwap.amountIn,
          finalAmount: ethers.formatUnits(currentAmount, 6),
          steps
        });

      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        this.results.multiHopSwaps.push({
          name: multiSwap.name,
          success: false,
          error: error.message
        });
      }
      
      console.log('');
    }
  }

  async generateReport() {
    console.log('📋 Generating Comprehensive Test Report...\n');
    
    const report = {
      timestamp: new Date().toISOString(),
      deployment: {
        file: 'monad-multi-shard-1764330063991.json',
        network: DEPLOYMENT_DATA.network,
        chainId: DEPLOYMENT_DATA.chainId,
        totalShards: DEPLOYMENT_DATA.multiShardStats.totalShards
      },
      wallet: this.wallet.address,
      results: this.results,
      summary: {
        apiTests: {
          total: this.results.apiTests.length,
          passed: this.results.apiTests.filter(t => t.success).length,
          failed: this.results.apiTests.filter(t => !t.success).length
        },
        liquidityAdditions: {
          total: this.results.liquidityAdditions.length,
          successful: this.results.liquidityAdditions.filter(l => l.success).length,
          failed: this.results.liquidityAdditions.filter(l => !l.success).length
        },
        swapExecutions: {
          total: this.results.swapExecutions.length,
          successful: this.results.swapExecutions.filter(s => s.success).length,
          failed: this.results.swapExecutions.filter(s => !s.success).length
        },
        multiHopSwaps: {
          total: this.results.multiHopSwaps.length,
          successful: this.results.multiHopSwaps.filter(m => m.success).length,
          failed: this.results.multiHopSwaps.filter(m => !m.success).length
        }
      }
    };

    // Save report
    const reportFile = `samm-evm/comprehensive-monad-test-report-${Date.now()}.json`;
    require('fs').writeFileSync(reportFile, JSON.stringify(report, null, 2));
    
    console.log('📊 TEST SUMMARY');
    console.log('================');
    console.log(`📡 API Tests: ${report.summary.apiTests.passed}/${report.summary.apiTests.total} passed`);
    console.log(`💧 Liquidity Additions: ${report.summary.liquidityAdditions.successful}/${report.summary.liquidityAdditions.total} successful`);
    console.log(`🔄 Direct Swaps: ${report.summary.swapExecutions.successful}/${report.summary.swapExecutions.total} successful`);
    console.log(`🔀 Multi-Hop Swaps: ${report.summary.multiHopSwaps.successful}/${report.summary.multiHopSwaps.total} successful`);
    console.log(`📄 Full report saved: ${reportFile}`);
    
    return report;
  }

  async runComprehensiveTest() {
    try {
      await this.initialize();
      await this.checkWalletBalances();
      await this.testAllAPIs();
      await this.addLiquidityToAllPools();
      await this.executeDirectSwaps();
      await this.executeMultiHopSwaps();
      
      const report = await this.generateReport();
      
      console.log('\n🎉 Comprehensive Monad SAMM Testing Complete!');
      return report;
      
    } catch (error) {
      console.error('❌ Test execution failed:', error);
      throw error;
    }
  }
}

// Run the test if called directly
if (require.main === module) {
  const tester = new MonadSAMMTester();
  tester.runComprehensiveTest()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

module.exports = MonadSAMMTester;