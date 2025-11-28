#!/usr/bin/env node

/**
 * PROPERLY Initialize DAI Pools with Full Parameters
 */

require('dotenv').config({ path: '.env.monad' });
const { ethers } = require('ethers');

const DEPLOYMENT_DATA = require('./deployment-data/monad-multi-shard-1764330063991.json');

const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Contract ABIs
const SAMM_POOL_ABI = [
  "function initialize(address _tokenA, address _tokenB, uint256 _amountA, uint256 _amountB, uint256 _tradeFeeNumerator, uint256 _tradeFeeDenominator, uint256 _ownerFeeNumerator, uint256 _ownerFeeDenominator) external returns (uint256 lpTokens)",
  "function getPoolState() view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))",
  "function owner() view returns (address)",
  "function initialized() view returns (bool)"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

async function properlyInitializeDAIPools() {
  console.log('🔧 PROPERLY INITIALIZING DAI POOLS');
  console.log('==================================');
  console.log(`👤 Wallet: ${wallet.address}`);

  // Get token contracts
  const tokens = {};
  for (const token of DEPLOYMENT_DATA.contracts.tokens) {
    tokens[token.symbol] = {
      address: token.address,
      contract: new ethers.Contract(token.address, ERC20_ABI, wallet)
    };
  }

  // Get DAI pools
  const daiShards = DEPLOYMENT_DATA.contracts.shards.filter(s => s.pairName === 'USDC/DAI');
  
  console.log(`\n🏊 Found ${daiShards.length} DAI pools:`);

  let nonce = await provider.getTransactionCount(wallet.address);

  for (const shard of daiShards) {
    console.log(`\n🔧 Processing ${shard.name} (${shard.address})`);
    
    try {
      const pool = new ethers.Contract(shard.address, SAMM_POOL_ABI, wallet);
      
      // Check ownership
      const owner = await pool.owner();
      console.log(`   Owner: ${owner}`);
      console.log(`   Our wallet: ${wallet.address}`);
      console.log(`   We own this pool: ${owner.toLowerCase() === wallet.address.toLowerCase()}`);
      
      // Check if already initialized
      const isInitialized = await pool.initialized();
      console.log(`   Already initialized: ${isInitialized}`);
      
      if (isInitialized) {
        console.log(`   ✅ Pool already initialized`);
        continue;
      }
      
      if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
        console.log(`   ❌ We don't own this pool - cannot initialize`);
        continue;
      }
      
      // Check token balances in pool
      const daiBalance = await tokens.DAI.contract.balanceOf(shard.address);
      const usdcBalance = await tokens.USDC.contract.balanceOf(shard.address);
      
      console.log(`   Pool balances:`);
      console.log(`     DAI: ${ethers.formatUnits(daiBalance, 18)}`);
      console.log(`     USDC: ${ethers.formatUnits(usdcBalance, 6)}`);
      
      if (daiBalance > 0 && usdcBalance > 0) {
        console.log(`   🏊 Initializing with existing balances...`);
        
        // Initialize with standard fee parameters
        const tx = await pool.initialize(
          tokens.DAI.address,    // tokenA (DAI)
          tokens.USDC.address,   // tokenB (USDC)
          daiBalance,            // amountA
          usdcBalance,           // amountB
          25,                    // tradeFeeNumerator (0.25%)
          10000,                 // tradeFeeDenominator
          5,                     // ownerFeeNumerator (0.05%)
          10000,                 // ownerFeeDenominator
          { nonce: nonce++, gasLimit: 1000000 }
        );
        
        const receipt = await tx.wait();
        console.log(`   ✅ Pool initialized! Tx: ${receipt.hash}`);
        
      } else {
        console.log(`   ❌ Pool has no tokens - cannot initialize`);
      }
      
    } catch (error) {
      console.log(`   ❌ Failed to process ${shard.name}: ${error.message}`);
    }
  }

  console.log('\n📊 Final Verification:');
  console.log('======================');
  
  for (const shard of daiShards) {
    try {
      const pool = new ethers.Contract(shard.address, SAMM_POOL_ABI, wallet);
      const state = await pool.getPoolState();
      
      if (state.reserveA > 0 && state.reserveB > 0) {
        console.log(`✅ ${shard.name}:`);
        console.log(`   Reserves: ${ethers.formatUnits(state.reserveA, 18)} DAI + ${ethers.formatUnits(state.reserveB, 6)} USDC`);
        console.log(`   LP Supply: ${ethers.formatUnits(state.totalSupply, 18)}`);
      } else {
        console.log(`❌ ${shard.name}: Still not initialized (reserves: ${state.reserveA}, ${state.reserveB})`);
      }
      
    } catch (error) {
      console.log(`❌ ${shard.name}: Error - ${error.message}`);
    }
  }
}

properlyInitializeDAIPools()
  .then(() => {
    console.log('\n🎉 DAI pool initialization complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Initialization failed:', error);
    process.exit(1);
  });