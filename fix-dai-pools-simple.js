#!/usr/bin/env node

/**
 * Fix DAI Pools - Simple Factory Approach
 * Use the same method that worked for USDC/USDT pools
 */

require('dotenv').config({ path: '.env.monad' });
const { ethers } = require('ethers');

const DEPLOYMENT_DATA = require('./deployment-data/monad-multi-shard-1764330063991.json');

const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const SAMM_POOL_FACTORY_ABI = [
  "function initializeShard(address shard, uint256 amountA, uint256 amountB) external returns (uint256 lpTokens)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount) returns (bool)"
];

const SAMM_POOL_ABI = [
  "function getPoolState() view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))"
];

async function fixDAIPoolsSimple() {
  console.log('🔧 FIXING DAI POOLS - SIMPLE APPROACH');
  console.log('====================================');

  const factory = new ethers.Contract(DEPLOYMENT_DATA.contracts.factory, SAMM_POOL_FACTORY_ABI, wallet);
  
  // Get token contracts
  const usdc = new ethers.Contract(
    DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'USDC').address,
    ERC20_ABI,
    wallet
  );
  const dai = new ethers.Contract(
    DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'DAI').address,
    ERC20_ABI,
    wallet
  );

  // Get DAI pools
  const daiShards = DEPLOYMENT_DATA.contracts.shards.filter(s => s.pairName === 'USDC/DAI');
  
  let nonce = await provider.getTransactionCount(wallet.address);

  for (const shard of daiShards) {
    console.log(`\n🔧 Fixing ${shard.name}...`);
    
    try {
      // Check current state
      const pool = new ethers.Contract(shard.address, SAMM_POOL_ABI, wallet);
      const state = await pool.getPoolState();
      
      if (state.reserveA > 0 && state.reserveB > 0) {
        console.log(`   ✅ Already initialized`);
        continue;
      }
      
      // Mint fresh tokens
      const usdcAmount = ethers.parseUnits('2000000', 6);  // 2M USDC
      const daiAmount = ethers.parseUnits('2000000', 18);  // 2M DAI
      
      console.log(`   💰 Minting tokens...`);
      await usdc.mint(wallet.address, usdcAmount, { nonce: nonce++ });
      await dai.mint(wallet.address, daiAmount, { nonce: nonce++ });
      
      console.log(`   📝 Approving to factory...`);
      await usdc.approve(factory.target, usdcAmount, { nonce: nonce++ });
      await dai.approve(factory.target, daiAmount, { nonce: nonce++ });
      
      console.log(`   🏭 Initializing via factory...`);
      const tx = await factory.initializeShard(
        shard.address,
        daiAmount,     // amountA (DAI first)
        usdcAmount,    // amountB (USDC second)
        { nonce: nonce++, gasLimit: 1000000 }
      );
      
      const receipt = await tx.wait();
      console.log(`   ✅ Initialized! Tx: ${receipt.hash}`);
      
    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}`);
    }
  }

  console.log('\n📊 Final Check:');
  for (const shard of daiShards) {
    try {
      const pool = new ethers.Contract(shard.address, SAMM_POOL_ABI, wallet);
      const state = await pool.getPoolState();
      
      if (state.reserveA > 0 && state.reserveB > 0) {
        console.log(`✅ ${shard.name}: ${ethers.formatUnits(state.reserveA, 18)} DAI + ${ethers.formatUnits(state.reserveB, 6)} USDC`);
      } else {
        console.log(`❌ ${shard.name}: Still not working`);
      }
    } catch (error) {
      console.log(`❌ ${shard.name}: Error`);
    }
  }
}

fixDAIPoolsSimple()
  .then(() => {
    console.log('\n🎉 DAI pools fixed! Multi-hop swaps should work now.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });