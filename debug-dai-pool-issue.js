#!/usr/bin/env node

/**
 * Debug DAI Pool Issue
 * Investigate the "zero source reserve" error
 */

require('dotenv').config({ path: '.env.monad' });
const { ethers } = require('ethers');

const DEPLOYMENT_DATA = require('./deployment-data/monad-multi-shard-1764330063991.json');

const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const SAMM_POOL_ABI = [
  "function getPoolState() view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))",
  "function calculateSwapSAMM(uint256 amountOut, address tokenIn, address tokenOut) view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)"
];

async function debugDAIPools() {
  console.log('🔍 DEBUGGING DAI POOL ISSUE');
  console.log('===========================');

  // Get token contracts
  const tokens = {};
  for (const token of DEPLOYMENT_DATA.contracts.tokens) {
    tokens[token.symbol] = {
      address: token.address,
      contract: new ethers.Contract(token.address, ERC20_ABI, wallet),
      decimals: token.symbol === 'USDC' ? 6 : (token.symbol === 'USDT' ? 6 : 18)
    };
  }

  console.log('📊 Detailed Pool Analysis:');
  console.log('==========================');

  for (const shard of DEPLOYMENT_DATA.contracts.shards) {
    console.log(`\n🏊 ${shard.name} (${shard.address})`);
    
    try {
      const pool = new ethers.Contract(shard.address, SAMM_POOL_ABI, wallet);
      const state = await pool.getPoolState();
      
      console.log(`   Token A: ${state.tokenA}`);
      console.log(`   Token B: ${state.tokenB}`);
      console.log(`   Reserve A: ${state.reserveA.toString()}`);
      console.log(`   Reserve B: ${state.reserveB.toString()}`);
      console.log(`   Total Supply: ${state.totalSupply.toString()}`);
      
      // Check actual token balances
      const [tokenA, tokenB] = shard.pairName.split('/');
      const balanceA = await tokens[tokenA].contract.balanceOf(shard.address);
      const balanceB = await tokens[tokenB].contract.balanceOf(shard.address);
      
      console.log(`   Actual ${tokenA} Balance: ${balanceA.toString()}`);
      console.log(`   Actual ${tokenB} Balance: ${balanceB.toString()}`);
      
      // Check if reserves match balances
      const reserveAMatch = state.reserveA.toString() === balanceA.toString();
      const reserveBMatch = state.reserveB.toString() === balanceB.toString();
      
      console.log(`   Reserve A matches balance: ${reserveAMatch}`);
      console.log(`   Reserve B matches balance: ${reserveBMatch}`);
      
      // Test swap calculation if this is a DAI pool
      if (shard.pairName === 'USDC/DAI') {
        console.log(`   🧪 Testing swap calculation...`);
        
        try {
          const daiOut = ethers.parseUnits('1', 18); // Try to get 1 DAI
          const calc = await pool.calculateSwapSAMM(
            daiOut,
            tokens.USDC.address,
            tokens.DAI.address
          );
          console.log(`   ✅ Swap calc works: ${ethers.formatUnits(calc.amountIn, 6)} USDC -> 1 DAI`);
        } catch (error) {
          console.log(`   ❌ Swap calc failed: ${error.message}`);
          
          // Try the reverse direction
          try {
            const usdcOut = ethers.parseUnits('1', 6); // Try to get 1 USDC
            const calc = await pool.calculateSwapSAMM(
              usdcOut,
              tokens.DAI.address,
              tokens.USDC.address
            );
            console.log(`   ✅ Reverse swap works: ${ethers.formatUnits(calc.amountIn, 18)} DAI -> 1 USDC`);
          } catch (reverseError) {
            console.log(`   ❌ Reverse swap also failed: ${reverseError.message}`);
          }
        }
      }
      
    } catch (error) {
      console.log(`   ❌ Error analyzing pool: ${error.message}`);
    }
  }

  console.log('\n🔍 DIAGNOSIS:');
  console.log('=============');
  
  // Check if DAI pools are properly initialized
  const daiShards = DEPLOYMENT_DATA.contracts.shards.filter(s => s.pairName === 'USDC/DAI');
  
  for (const shard of daiShards) {
    try {
      const pool = new ethers.Contract(shard.address, SAMM_POOL_ABI, wallet);
      const state = await pool.getPoolState();
      
      if (state.reserveA.toString() === '0' || state.reserveB.toString() === '0') {
        console.log(`❌ ${shard.name} has zero reserves - NOT INITIALIZED`);
      } else {
        console.log(`✅ ${shard.name} has reserves - INITIALIZED`);
      }
      
    } catch (error) {
      console.log(`❌ ${shard.name} - Error checking: ${error.message}`);
    }
  }
}

debugDAIPools()
  .then(() => {
    console.log('\n🏁 Debug complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Debug failed:', error);
    process.exit(1);
  });