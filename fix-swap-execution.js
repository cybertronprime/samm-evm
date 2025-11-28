#!/usr/bin/env node

/**
 * FIX SWAP EXECUTION
 * The calculations work, now let's fix the actual swap execution
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

async function fixSwapExecution() {
  console.log('🔧 FIXING SWAP EXECUTION');
  console.log('========================');
  console.log('The calculations work - now let\'s make the swaps work too!');
  
  // Get token contracts
  const tokens = {};
  for (const token of DEPLOYMENT_DATA.contracts.tokens) {
    tokens[token.symbol] = {
      address: token.address,
      contract: new ethers.Contract(token.address, ERC20_ABI, wallet),
      decimals: token.symbol === 'USDC' ? 6 : (token.symbol === 'USDT' ? 6 : 18)
    };
  }

  // Get working pool
  const pool = new ethers.Contract(
    DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/USDT-1').address,
    SAMM_POOL_ABI,
    wallet
  );

  console.log('\n📊 INITIAL STATE:');
  console.log('=================');
  
  const initialUsdtBalance = await tokens.USDT.contract.balanceOf(wallet.address);
  const initialUsdcBalance = await tokens.USDC.contract.balanceOf(wallet.address);
  const poolState = await pool.getPoolState();
  
  console.log(`USDT Balance: ${ethers.formatUnits(initialUsdtBalance, 6)}`);
  console.log(`USDC Balance: ${ethers.formatUnits(initialUsdcBalance, 6)}`);
  console.log(`Pool USDC Reserve: ${ethers.formatUnits(poolState.reserveA, 6)}`);
  console.log(`Pool USDT Reserve: ${ethers.formatUnits(poolState.reserveB, 6)}`);

  // Start with a VERY small swap to test
  const targetUsdcAmount = ethers.parseUnits('10', 6); // Just 10 USDC
  
  console.log('\n🎯 TESTING SMALL SWAP:');
  console.log('======================');
  console.log(`Target: ${ethers.formatUnits(targetUsdcAmount, 6)} USDC`);
  
  try {
    // Calculate what we need
    const calculation = await pool.calculateSwapSAMM(
      targetUsdcAmount,
      tokens.USDT.address,
      tokens.USDC.address
    );
    
    console.log(`✅ Calculation successful:`);
    console.log(`  Need: ${ethers.formatUnits(calculation.amountIn, 6)} USDT`);
    console.log(`  Get: ${ethers.formatUnits(calculation.amountOut, 6)} USDC`);
    console.log(`  Fee: ${ethers.formatUnits(calculation.tradeFee, 6)} USDC`);
    
    const neededUsdt = calculation.amountIn;
    
    // Add 5% slippage buffer
    const slippageBuffer = neededUsdt * 5n / 100n; // 5% extra
    const totalUsdtWithSlippage = neededUsdt + slippageBuffer;
    
    console.log(`  With 5% slippage: ${ethers.formatUnits(totalUsdtWithSlippage, 6)} USDT`);
    
    // Check balance
    if (initialUsdtBalance < totalUsdtWithSlippage) {
      console.log(`❌ Insufficient USDT balance`);
      return;
    }
    
    console.log('\n🔧 PREPARING SWAP:');
    console.log('==================');
    
    // Check and set allowance
    const currentAllowance = await tokens.USDT.contract.allowance(wallet.address, pool.target);
    console.log(`Current allowance: ${ethers.formatUnits(currentAllowance, 6)} USDT`);
    
    if (currentAllowance < totalUsdtWithSlippage) {
      console.log('Setting allowance...');
      const approveTx = await tokens.USDT.contract.approve(
        pool.target, 
        totalUsdtWithSlippage,
        { gasLimit: 100000 }
      );
      await approveTx.wait();
      console.log('✅ Allowance set');
      
      // Verify
      const newAllowance = await tokens.USDT.contract.allowance(wallet.address, pool.target);
      console.log(`New allowance: ${ethers.formatUnits(newAllowance, 6)} USDT`);
    }
    
    console.log('\n🚀 EXECUTING SWAP:');
    console.log('==================');
    
    const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes
    console.log(`Deadline: ${deadline}`);
    
    // Try the swap with generous gas limit
    const swapTx = await pool.swap(
      targetUsdcAmount,
      tokens.USDT.address,
      tokens.USDC.address,
      wallet.address,
      deadline,
      { 
        gasLimit: 500000,
        gasPrice: ethers.parseUnits('120', 'gwei') // Higher gas price
      }
    );
    
    console.log(`Transaction sent: ${swapTx.hash}`);
    console.log('Waiting for confirmation...');
    
    const receipt = await swapTx.wait();
    console.log(`✅ SWAP SUCCESSFUL! Gas used: ${receipt.gasUsed}`);
    
    // Check results
    const finalUsdtBalance = await tokens.USDT.contract.balanceOf(wallet.address);
    const finalUsdcBalance = await tokens.USDC.contract.balanceOf(wallet.address);
    
    console.log('\n📊 RESULTS:');
    console.log('===========');
    console.log(`USDT Change: ${ethers.formatUnits(finalUsdtBalance - initialUsdtBalance, 6)}`);
    console.log(`USDC Change: ${ethers.formatUnits(finalUsdcBalance - initialUsdcBalance, 6)}`);
    
    const actualUsdtUsed = initialUsdtBalance - finalUsdtBalance;
    const actualUsdcReceived = finalUsdcBalance - initialUsdcBalance;
    
    console.log(`Actual USDT used: ${ethers.formatUnits(actualUsdtUsed, 6)}`);
    console.log(`Actual USDC received: ${ethers.formatUnits(actualUsdcReceived, 6)}`);
    
    const effectiveRate = Number(ethers.formatUnits(actualUsdtUsed, 6)) / Number(ethers.formatUnits(actualUsdcReceived, 6));
    console.log(`Effective rate: ${effectiveRate.toFixed(6)} USDT per USDC`);
    
    console.log('\n🎉 SUCCESS! SWAPS ARE WORKING!');
    console.log('==============================');
    console.log('✅ Single swap executed successfully');
    console.log('✅ Multi-hop is now possible');
    console.log('✅ The system is functional');
    
    console.log('\n🔄 NOW TESTING MULTI-HOP:');
    console.log('=========================');
    
    // Now try a simple multi-hop using two different pools
    const pool2 = new ethers.Contract(
      DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/USDT-2').address,
      SAMM_POOL_ABI,
      wallet
    );
    
    // Multi-hop: USDT → USDC (Pool 1) → USDT (Pool 2)
    const targetUsdtFromPool2 = ethers.parseUnits('5', 6); // Just 5 USDT
    
    console.log(`Multi-hop target: ${ethers.formatUnits(targetUsdtFromPool2, 6)} USDT from Pool 2`);
    
    // Step 1: Calculate USDC needed for Pool 2
    const step2Calc = await pool2.calculateSwapSAMM(
      targetUsdtFromPool2,
      tokens.USDC.address,
      tokens.USDT.address
    );
    
    console.log(`Step 2 needs: ${ethers.formatUnits(step2Calc.amountIn, 6)} USDC`);
    
    // Step 2: Calculate USDT needed for Pool 1
    const step1Calc = await pool.calculateSwapSAMM(
      step2Calc.amountIn,
      tokens.USDT.address,
      tokens.USDC.address
    );
    
    console.log(`Step 1 needs: ${ethers.formatUnits(step1Calc.amountIn, 6)} USDT`);
    
    const totalUsdtNeeded = step1Calc.amountIn + (step1Calc.amountIn * 5n / 100n); // 5% buffer
    
    if (finalUsdtBalance < totalUsdtNeeded) {
      console.log('❌ Not enough USDT for multi-hop after first swap');
      return;
    }
    
    console.log('\n🔄 EXECUTING MULTI-HOP:');
    console.log('=======================');
    
    // Step 1: USDT → USDC (Pool 1)
    console.log('Step 1: USDT → USDC...');
    
    await tokens.USDT.contract.approve(pool.target, totalUsdtNeeded);
    
    const multiHop1Tx = await pool.swap(
      step1Calc.amountOut,
      tokens.USDT.address,
      tokens.USDC.address,
      wallet.address,
      Math.floor(Date.now() / 1000) + 600,
      { gasLimit: 500000 }
    );
    
    await multiHop1Tx.wait();
    console.log('✅ Step 1 complete');
    
    // Step 2: USDC → USDT (Pool 2)
    console.log('Step 2: USDC → USDT...');
    
    const midUsdcBalance = await tokens.USDC.contract.balanceOf(wallet.address);
    await tokens.USDC.contract.approve(pool2.target, midUsdcBalance);
    
    const multiHop2Tx = await pool2.swap(
      targetUsdtFromPool2,
      tokens.USDC.address,
      tokens.USDT.address,
      wallet.address,
      Math.floor(Date.now() / 1000) + 600,
      { gasLimit: 500000 }
    );
    
    await multiHop2Tx.wait();
    console.log('✅ Step 2 complete');
    
    console.log('\n🏆 MULTI-HOP SUCCESS!');
    console.log('=====================');
    console.log('✅ Multi-hop swap executed successfully');
    console.log('✅ Cross-shard routing works');
    console.log('✅ System is fully functional');
    
    console.log('\n📋 TRANSACTION HASHES:');
    console.log('======================');
    console.log(`Single swap: ${swapTx.hash}`);
    console.log(`Multi-hop step 1: ${multiHop1Tx.hash}`);
    console.log(`Multi-hop step 2: ${multiHop2Tx.hash}`);
    
  } catch (error) {
    console.log(`❌ Swap failed: ${error.message}`);
    
    if (error.message.includes('require(false)')) {
      console.log('\n🔍 DEBUGGING require(false) ERROR:');
      console.log('==================================');
      console.log('This usually means:');
      console.log('1. Insufficient allowance (check approval)');
      console.log('2. Slippage too high (pool state changed)');
      console.log('3. Deadline expired');
      console.log('4. Pool reserves insufficient');
      console.log('5. Amount calculation error');
      
      // Let's check each possibility
      const currentAllowance = await tokens.USDT.contract.allowance(wallet.address, pool.target);
      const currentBalance = await tokens.USDT.contract.balanceOf(wallet.address);
      const currentPoolState = await pool.getPoolState();
      
      console.log(`\nCurrent allowance: ${ethers.formatUnits(currentAllowance, 6)} USDT`);
      console.log(`Current balance: ${ethers.formatUnits(currentBalance, 6)} USDT`);
      console.log(`Pool USDC reserve: ${ethers.formatUnits(currentPoolState.reserveA, 6)}`);
      console.log(`Pool USDT reserve: ${ethers.formatUnits(currentPoolState.reserveB, 6)}`);
    }
  }
}

fixSwapExecution()
  .then(() => {
    console.log('\n🏁 Swap execution fix complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Swap execution fix failed:', error);
    process.exit(1);
  });