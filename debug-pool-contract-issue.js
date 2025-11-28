#!/usr/bin/env node

/**
 * DEBUG POOL CONTRACT ISSUE
 * Figure out why the DAI pools are rejecting liquidity
 */

require('dotenv').config({ path: '.env.monad' });
const { ethers } = require('ethers');

const DEPLOYMENT_DATA = require('./deployment-data/monad-multi-shard-1764330063991.json');

const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const SAMM_POOL_ABI = [
  "function getPoolState() view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))",
  "function owner() view returns (address)",
  "function factory() view returns (address)",
  "function initialized() view returns (bool)"
];

const FACTORY_ABI = [
  "function createPool(address tokenA, address tokenB, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator) external returns (address pool)",
  "function initializePool(address pool, uint256 amountA, uint256 amountB, address to) external returns (uint256 liquidity)"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)"
];

async function debugPoolIssue() {
  console.log('🔍 DEBUGGING DAI POOL CONTRACT ISSUES');
  console.log('====================================');
  
  // Get token contracts
  const tokens = {};
  for (const token of DEPLOYMENT_DATA.contracts.tokens) {
    tokens[token.symbol] = {
      address: token.address,
      contract: new ethers.Contract(token.address, ERC20_ABI, wallet),
      decimals: token.symbol === 'USDC' ? 6 : (token.symbol === 'USDT' ? 6 : 18)
    };
  }

  // Get factory
  const factory = new ethers.Contract(
    DEPLOYMENT_DATA.contracts.factory.address,
    FACTORY_ABI,
    wallet
  );

  console.log('\n📋 POOL DIAGNOSTICS:');
  console.log('====================');
  
  const daiPools = DEPLOYMENT_DATA.contracts.shards.filter(s => s.pairName.includes('DAI'));
  
  for (const poolInfo of daiPools) {
    console.log(`\n🔍 Analyzing ${poolInfo.name}:`);
    console.log(`Address: ${poolInfo.address}`);
    
    try {
      const pool = new ethers.Contract(poolInfo.address, SAMM_POOL_ABI, wallet);
      
      // Check basic contract info
      const state = await pool.getPoolState();
      console.log(`  Token A: ${state.tokenA}`);
      console.log(`  Token B: ${state.tokenB}`);
      console.log(`  Reserve A: ${ethers.formatUnits(state.reserveA, 6)} USDC`);
      console.log(`  Reserve B: ${ethers.formatUnits(state.reserveB, 18)} DAI`);
      console.log(`  Total Supply: ${ethers.formatUnits(state.totalSupply, 18)}`);
      console.log(`  Trade Fee: ${state.tradeFeeNumerator}/${state.tradeFeeDenominator}`);
      
      // Check if initialized
      try {
        const initialized = await pool.initialized();
        console.log(`  Initialized: ${initialized}`);
      } catch (e) {
        console.log(`  Initialized: Cannot check (method may not exist)`);
      }
      
      // Check owner
      try {
        const owner = await pool.owner();
        console.log(`  Owner: ${owner}`);
        console.log(`  Is our wallet owner: ${owner.toLowerCase() === wallet.address.toLowerCase()}`);
      } catch (e) {
        console.log(`  Owner: Cannot check (${e.message})`);
      }
      
      // Check factory
      try {
        const poolFactory = await pool.factory();
        console.log(`  Factory: ${poolFactory}`);
        console.log(`  Matches deployment: ${poolFactory.toLowerCase() === DEPLOYMENT_DATA.contracts.factory.address.toLowerCase()}`);
      } catch (e) {
        console.log(`  Factory: Cannot check (${e.message})`);
      }
      
      // Check if reserves are in weird state
      const reserveA = Number(ethers.formatUnits(state.reserveA, 6));
      const reserveB = Number(ethers.formatUnits(state.reserveB, 18));
      const totalSupply = Number(ethers.formatUnits(state.totalSupply, 18));
      
      console.log(`  Reserve Ratio: ${reserveA > 0 ? (reserveA / Math.max(reserveB, 0.000001)).toFixed(6) : 'N/A'}`);
      console.log(`  Pool Health: ${reserveA > 0 && reserveB > 0 ? 'HEALTHY' : 'BROKEN - Missing reserves'}`);
      
      if (totalSupply === 0 && (reserveA > 0 || reserveB > 0)) {
        console.log(`  ⚠️  ISSUE: Has reserves but no total supply - pool may be corrupted`);
      }
      
      if (reserveA > 1000000000) { // More than 1B USDC
        console.log(`  ⚠️  ISSUE: Reserve A is suspiciously large - possible overflow`);
      }
      
    } catch (error) {
      console.log(`  ❌ Failed to analyze pool: ${error.message}`);
    }
  }

  console.log('\n🔧 ATTEMPTING POOL RECREATION:');
  console.log('==============================');
  
  // Try to create a fresh DAI pool
  console.log('Creating new USDC/DAI pool...');
  
  try {
    const createTx = await factory.createPool(
      tokens.USDC.address,
      tokens.DAI.address,
      3, // 0.3% trade fee
      1000,
      1, // 0.1% owner fee  
      1000
    );
    
    const receipt = await createTx.wait();
    console.log(`✅ New pool created! Gas used: ${receipt.gasUsed}`);
    
    // Find the new pool address from logs
    const poolCreatedEvent = receipt.logs.find(log => {
      try {
        const decoded = factory.interface.parseLog(log);
        return decoded.name === 'PoolCreated';
      } catch {
        return false;
      }
    });
    
    if (poolCreatedEvent) {
      const decoded = factory.interface.parseLog(poolCreatedEvent);
      const newPoolAddress = decoded.args.pool;
      console.log(`New pool address: ${newPoolAddress}`);
      
      // Initialize the new pool
      console.log('Initializing new pool...');
      
      // Approve tokens for factory
      await tokens.USDC.contract.approve(factory.target, ethers.parseUnits('1000000', 6));
      await tokens.DAI.contract.approve(factory.target, ethers.parseUnits('1000000', 18));
      
      const initTx = await factory.initializePool(
        newPoolAddress,
        ethers.parseUnits('1000000', 6), // 1M USDC
        ethers.parseUnits('1000000', 18), // 1M DAI
        wallet.address
      );
      
      const initReceipt = await initTx.wait();
      console.log(`✅ Pool initialized! Gas used: ${initReceipt.gasUsed}`);
      
      // Test the new pool
      const newPool = new ethers.Contract(newPoolAddress, SAMM_POOL_ABI, wallet);
      const newState = await newPool.getPoolState();
      
      console.log(`New pool reserves:`);
      console.log(`  USDC: ${ethers.formatUnits(newState.reserveA, 6)}`);
      console.log(`  DAI: ${ethers.formatUnits(newState.reserveB, 18)}`);
      
    }
    
  } catch (error) {
    console.log(`❌ Failed to create new pool: ${error.message}`);
  }

  console.log('\n💡 RECOMMENDATIONS:');
  console.log('===================');
  console.log('1. The existing DAI pools appear to be in a corrupted state');
  console.log('2. They have massive USDC reserves but almost no DAI');
  console.log('3. This suggests an initialization or liquidity addition bug');
  console.log('4. We should either:');
  console.log('   a) Create fresh DAI pools, or');
  console.log('   b) Find a way to drain/reset the existing pools');
  console.log('5. For now, use the working USDT/USDC pools for single-hop swaps');
}

debugPoolIssue()
  .then(() => {
    console.log('\n🏁 Pool debugging complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Pool debugging failed:', error);
    process.exit(1);
  });