#!/usr/bin/env node

/**
 * PROPERLY Initialize DAI Pools
 * Fix the zero reserves issue
 */

require('dotenv').config({ path: '.env.monad' });
const { ethers } = require('ethers');

const DEPLOYMENT_DATA = require('./deployment-data/monad-multi-shard-1764330063991.json');

const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Contract ABIs
const SAMM_POOL_ABI = [
  "function initializePool(uint256 amountA, uint256 amountB) external returns (uint256 lpTokens)",
  "function getPoolState() view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount) returns (bool)"
];

async function fixDAIPools() {
  console.log('🔧 FIXING DAI POOLS PROPERLY');
  console.log('============================');
  console.log(`👤 Wallet: ${wallet.address}`);

  // Get token contracts
  const tokens = {};
  for (const token of DEPLOYMENT_DATA.contracts.tokens) {
    tokens[token.symbol] = {
      address: token.address,
      contract: new ethers.Contract(token.address, ERC20_ABI, wallet),
      decimals: token.symbol === 'USDC' ? 6 : (token.symbol === 'USDT' ? 6 : 18)
    };
  }

  // Get DAI pools that need fixing
  const daiShards = DEPLOYMENT_DATA.contracts.shards.filter(s => s.pairName === 'USDC/DAI');
  
  console.log(`\n🏊 Found ${daiShards.length} DAI pools to fix:`);
  for (const shard of daiShards) {
    console.log(`   ${shard.name}: ${shard.address}`);
  }

  let nonce = await provider.getTransactionCount(wallet.address);

  for (const shard of daiShards) {
    console.log(`\n🔧 Fixing ${shard.name}...`);
    
    try {
      const pool = new ethers.Contract(shard.address, SAMM_POOL_ABI, wallet);
      
      // Check current state
      const state = await pool.getPoolState();
      console.log(`   Current reserves: ${state.reserveA} DAI, ${state.reserveB} USDC`);
      
      if (state.reserveA.toString() === '0' && state.reserveB.toString() === '0') {
        console.log(`   ❌ Pool not initialized - fixing now...`);
        
        // Check token balances in pool
        const daiBalance = await tokens.DAI.contract.balanceOf(shard.address);
        const usdcBalance = await tokens.USDC.contract.balanceOf(shard.address);
        
        console.log(`   Pool has: ${ethers.formatUnits(daiBalance, 18)} DAI, ${ethers.formatUnits(usdcBalance, 6)} USDC`);
        
        if (daiBalance > 0 && usdcBalance > 0) {
          // Pool has tokens but isn't initialized - call initializePool directly
          console.log(`   🏊 Calling initializePool directly...`);
          
          const tx = await pool.initializePool(
            daiBalance,
            usdcBalance,
            { nonce: nonce++, gasLimit: 800000 }
          );
          
          const receipt = await tx.wait();
          console.log(`   ✅ Pool initialized! Tx: ${receipt.hash}`);
          
          // Verify initialization
          const newState = await pool.getPoolState();
          console.log(`   New reserves: ${newState.reserveA} DAI, ${newState.reserveB} USDC`);
          
        } else {
          console.log(`   ❌ Pool has no tokens - need to add liquidity first`);
          
          // Mint and add liquidity
          const daiAmount = ethers.parseUnits('1000000', 18); // 1M DAI
          const usdcAmount = ethers.parseUnits('1000000', 6);  // 1M USDC
          
          console.log(`   💰 Minting tokens...`);
          await tokens.DAI.contract.mint(wallet.address, daiAmount, { nonce: nonce++ });
          await tokens.USDC.contract.mint(wallet.address, usdcAmount, { nonce: nonce++ });
          
          console.log(`   📝 Approving tokens...`);
          await tokens.DAI.contract.approve(shard.address, daiAmount, { nonce: nonce++ });
          await tokens.USDC.contract.approve(shard.address, usdcAmount, { nonce: nonce++ });
          
          console.log(`   💸 Transferring tokens to pool...`);
          await tokens.DAI.contract.transfer(shard.address, daiAmount, { nonce: nonce++ });
          await tokens.USDC.contract.transfer(shard.address, usdcAmount, { nonce: nonce++ });
          
          console.log(`   🏊 Initializing pool...`);
          const tx = await pool.initializePool(
            daiAmount,
            usdcAmount,
            { nonce: nonce++, gasLimit: 800000 }
          );
          
          const receipt = await tx.wait();
          console.log(`   ✅ Pool initialized! Tx: ${receipt.hash}`);
        }
        
      } else {
        console.log(`   ✅ Pool already initialized`);
      }
      
    } catch (error) {
      console.log(`   ❌ Failed to fix ${shard.name}: ${error.message}`);
    }
  }

  console.log('\n📊 Final Verification:');
  console.log('======================');
  
  for (const shard of daiShards) {
    try {
      const pool = new ethers.Contract(shard.address, SAMM_POOL_ABI, wallet);
      const state = await pool.getPoolState();
      
      if (state.reserveA > 0 && state.reserveB > 0) {
        console.log(`✅ ${shard.name}: ${ethers.formatUnits(state.reserveA, 18)} DAI + ${ethers.formatUnits(state.reserveB, 6)} USDC`);
      } else {
        console.log(`❌ ${shard.name}: Still not initialized`);
      }
      
    } catch (error) {
      console.log(`❌ ${shard.name}: Error - ${error.message}`);
    }
  }
}

fixDAIPools()
  .then(() => {
    console.log('\n🎉 DAI pools fixed!');
    console.log('Multi-hop swaps should now work properly.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fix failed:', error);
    process.exit(1);
  });