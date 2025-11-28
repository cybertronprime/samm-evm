#!/usr/bin/env node

/**
 * DEBUG SIMPLE SWAP ISSUES
 * Figure out why even basic swaps are failing
 */

require('dotenv').config({ path: '.env.monad' });
const { ethers } = require('ethers');

const DEPLOYMENT_DATA = require('./deployment-data/monad-multi-shard-1764330063991.json');

const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const SAMM_POOL_ABI = [
  "function swap(uint256 amountOut, address tokenIn, address tokenOut, address to, uint256 deadline) external returns (uint256 amountIn)",
  "function calculateSwapSAMM(uint256 amountOut, address tokenIn, address tokenOut) view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))",
  "function getPoolState() view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)"
];

async function debugSimpleSwap() {
  console.log('🔍 DEBUGGING SIMPLE SWAP ISSUES');
  console.log('===============================');
  
  // Get token contracts
  const tokens = {};
  for (const token of DEPLOYMENT_DATA.contracts.tokens) {
    tokens[token.symbol] = {
      address: token.address,
      contract: new ethers.Contract(token.address, ERC20_ABI, wallet),
      decimals: token.symbol === 'USDC' ? 6 : (token.symbol === 'USDT' ? 6 : 18)
    };
  }

  // Get a working pool
  const pool = new ethers.Contract(
    DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/USDT-1').address,
    SAMM_POOL_ABI,
    wallet
  );

  console.log('\n📊 POOL AND BALANCE INFO:');
  console.log('=========================');
  
  const state = await pool.getPoolState();
  const usdtBalance = await tokens.USDT.contract.balanceOf(wallet.address);
  const usdcBalance = await tokens.USDC.contract.balanceOf(wallet.address);
  
  console.log(`Pool Address: ${pool.target}`);
  console.log(`USDC Reserve: ${ethers.formatUnits(state.reserveA, 6)}`);
  console.log(`USDT Reserve: ${ethers.formatUnits(state.reserveB, 6)}`);
  console.log(`Wallet USDT: ${ethers.formatUnits(usdtBalance, 6)}`);
  console.log(`Wallet USDC: ${ethers.formatUnits(usdcBalance, 6)}`);

  // Try a tiny swap first
  const tinyUsdcAmount = ethers.parseUnits('1', 6); // Just 1 USDC
  
  console.log('\n🧪 TESTING TINY SWAP CALCULATION:');
  console.log('=================================');
  
  try {
    const calculation = await pool.calculateSwapSAMM(
      tinyUsdcAmount,
      tokens.USDT.address,
      tokens.USDC.address
    );
    
    console.log(`✅ Calculation works!`);
    console.log(`To get 1 USDC:`);
    console.log(`  Need: ${ethers.formatUnits(calculation.amountIn, 6)} USDT`);
    console.log(`  Fee: ${ethers.formatUnits(calculation.tradeFee, 6)} USDC`);
    
    const neededUsdt = calculation.amountIn;
    
    console.log('\n🔧 CHECKING APPROVAL AND BALANCE:');
    console.log('=================================');
    
    // Check if we have enough USDT
    if (usdtBalance < neededUsdt) {
      console.log(`❌ Insufficient USDT balance`);
      console.log(`Need: ${ethers.formatUnits(neededUsdt, 6)} USDT`);
      console.log(`Have: ${ethers.formatUnits(usdtBalance, 6)} USDT`);
      return;
    }
    
    // Check current allowance
    const currentAllowance = await tokens.USDT.contract.allowance(wallet.address, pool.target);
    console.log(`Current USDT allowance: ${ethers.formatUnits(currentAllowance, 6)}`);
    
    if (currentAllowance < neededUsdt) {
      console.log('Approving USDT...');
      const approveTx = await tokens.USDT.contract.approve(pool.target, neededUsdt);
      await approveTx.wait();
      console.log('✅ USDT approved');
      
      // Verify approval
      const newAllowance = await tokens.USDT.contract.allowance(wallet.address, pool.target);
      console.log(`New USDT allowance: ${ethers.formatUnits(newAllowance, 6)}`);
    }
    
    console.log('\n🚀 ATTEMPTING TINY SWAP:');
    console.log('========================');
    
    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
    
    console.log(`Swapping for ${ethers.formatUnits(tinyUsdcAmount, 6)} USDC...`);
    console.log(`Expected USDT cost: ${ethers.formatUnits(neededUsdt, 6)}`);
    console.log(`Deadline: ${deadline}`);
    
    try {
      // Try with manual gas limit
      const swapTx = await pool.swap(
        tinyUsdcAmount,
        tokens.USDT.address,
        tokens.USDC.address,
        wallet.address,
        deadline,
        { gasLimit: 300000 }
      );
      
      console.log(`Transaction sent: ${swapTx.hash}`);
      const receipt = await swapTx.wait();
      console.log(`✅ Swap successful! Gas used: ${receipt.gasUsed}`);
      
      // Check new balances
      const newUsdtBalance = await tokens.USDT.contract.balanceOf(wallet.address);
      const newUsdcBalance = await tokens.USDC.contract.balanceOf(wallet.address);
      
      console.log('\n📊 BALANCE CHANGES:');
      console.log('===================');
      console.log(`USDT: ${ethers.formatUnits(newUsdtBalance - usdtBalance, 6)}`);
      console.log(`USDC: ${ethers.formatUnits(newUsdcBalance - usdcBalance, 6)}`);
      
      console.log('\n🎉 SWAP WORKS! MULTI-HOP IS POSSIBLE!');
      
    } catch (swapError) {
      console.log(`❌ Swap failed: ${swapError.message}`);
      
      // Try to understand why
      console.log('\n🔍 DEBUGGING SWAP FAILURE:');
      console.log('==========================');
      
      // Check if it's a slippage issue by trying with more USDT
      const extraUsdt = ethers.parseUnits('0.1', 6); // Add 0.1 USDT buffer
      const totalUsdt = neededUsdt + extraUsdt;
      
      console.log(`Trying with extra USDT buffer: ${ethers.formatUnits(totalUsdt, 6)}`);
      
      try {
        // Approve extra amount
        await tokens.USDT.contract.approve(pool.target, totalUsdt);
        
        const bufferSwapTx = await pool.swap(
          tinyUsdcAmount,
          tokens.USDT.address,
          tokens.USDC.address,
          wallet.address,
          deadline,
          { gasLimit: 300000 }
        );
        
        const bufferReceipt = await bufferSwapTx.wait();
        console.log(`✅ Swap with buffer successful! Gas used: ${bufferReceipt.gasUsed}`);
        
      } catch (bufferError) {
        console.log(`❌ Even with buffer failed: ${bufferError.message}`);
        
        // Check if pool state changed
        const newState = await pool.getPoolState();
        console.log(`Pool state changed: ${state.reserveA !== newState.reserveA || state.reserveB !== newState.reserveB}`);
      }
    }
    
  } catch (error) {
    console.log(`❌ Even calculation failed: ${error.message}`);
  }
}

debugSimpleSwap()
  .then(() => {
    console.log('\n🏁 Swap debugging complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Swap debugging failed:', error);
    process.exit(1);
  });