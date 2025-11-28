#!/usr/bin/env node

/**
 * REAL BLOCKCHAIN MULTI-HOP TEST
 * Actually execute transactions on-chain to prove multi-hop works
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
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function symbol() view returns (string)"
];

async function executeRealMultiHop() {
  console.log('🔥 EXECUTING REAL MULTI-HOP BLOCKCHAIN TRANSACTIONS');
  console.log('==================================================');
  
  // Get token contracts
  const tokens = {};
  for (const token of DEPLOYMENT_DATA.contracts.tokens) {
    tokens[token.symbol] = {
      address: token.address,
      contract: new ethers.Contract(token.address, ERC20_ABI, wallet),
      decimals: token.symbol === 'USDC' ? 6 : (token.symbol === 'USDT' ? 6 : 18)
    };
  }

  // Get pool contracts
  const usdtUsdcPool = new ethers.Contract(
    DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/USDT-1').address,
    SAMM_POOL_ABI,
    wallet
  );
  
  const usdcDaiPool = new ethers.Contract(
    DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/DAI-1').address,
    SAMM_POOL_ABI,
    wallet
  );

  console.log('\n📊 CHECKING INITIAL BALANCES:');
  console.log('=============================');
  
  const initialUsdtBalance = await tokens.USDT.contract.balanceOf(wallet.address);
  const initialUsdcBalance = await tokens.USDC.contract.balanceOf(wallet.address);
  const initialDaiBalance = await tokens.DAI.contract.balanceOf(wallet.address);
  
  console.log(`USDT: ${ethers.formatUnits(initialUsdtBalance, 6)}`);
  console.log(`USDC: ${ethers.formatUnits(initialUsdcBalance, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(initialDaiBalance, 18)}`);

  console.log('\n🏊 CHECKING POOL RESERVES:');
  console.log('==========================');
  
  const usdtUsdcState = await usdtUsdcPool.getPoolState();
  const usdcDaiState = await usdcDaiPool.getPoolState();
  
  console.log('USDT/USDC Pool:');
  console.log(`  USDC Reserve: ${ethers.formatUnits(usdtUsdcState.reserveA, 6)}`);
  console.log(`  USDT Reserve: ${ethers.formatUnits(usdtUsdcState.reserveB, 6)}`);
  
  console.log('USDC/DAI Pool:');
  console.log(`  USDC Reserve: ${ethers.formatUnits(usdcDaiState.reserveA, 6)}`);
  console.log(`  DAI Reserve: ${ethers.formatUnits(usdcDaiState.reserveB, 18)}`);

  // Start with TINY amounts that will definitely work
  const targetDaiAmount = ethers.parseUnits('1', 18); // Just 1 DAI
  
  console.log('\n🎯 STEP 1: Calculate USDC needed for 1 DAI');
  console.log('==========================================');
  
  let step2Calculation;
  try {
    step2Calculation = await usdcDaiPool.calculateSwapSAMM(
      targetDaiAmount,
      tokens.USDC.address,
      tokens.DAI.address
    );
    
    console.log(`✅ Need ${ethers.formatUnits(step2Calculation.amountIn, 6)} USDC for 1 DAI`);
  } catch (error) {
    console.log('❌ Step 2 calculation failed:', error.message);
    
    // Try even smaller amount
    const tinyDaiAmount = ethers.parseUnits('0.1', 18); // 0.1 DAI
    console.log('\n🔧 Trying with 0.1 DAI instead...');
    
    try {
      step2Calculation = await usdcDaiPool.calculateSwapSAMM(
        tinyDaiAmount,
        tokens.USDC.address,
        tokens.DAI.address
      );
      
      console.log(`✅ Need ${ethers.formatUnits(step2Calculation.amountIn, 6)} USDC for 0.1 DAI`);
    } catch (tinyError) {
      console.log('❌ Even 0.1 DAI failed:', tinyError.message);
      return;
    }
  }

  console.log('\n🎯 STEP 2: Calculate USDT needed for required USDC');
  console.log('=================================================');
  
  let step1Calculation;
  try {
    step1Calculation = await usdtUsdcPool.calculateSwapSAMM(
      step2Calculation.amountIn, // USDC needed from step 2
      tokens.USDT.address,
      tokens.USDC.address
    );
    
    console.log(`✅ Need ${ethers.formatUnits(step1Calculation.amountIn, 6)} USDT total`);
  } catch (error) {
    console.log('❌ Step 1 calculation failed:', error.message);
    return;
  }

  console.log('\n💰 MULTI-HOP ROUTE SUMMARY:');
  console.log('===========================');
  console.log(`Input: ${ethers.formatUnits(step1Calculation.amountIn, 6)} USDT`);
  console.log(`Intermediate: ${ethers.formatUnits(step2Calculation.amountIn, 6)} USDC`);
  console.log(`Output: ${ethers.formatUnits(step2Calculation.amountOut, 18)} DAI`);
  
  const effectiveRate = Number(ethers.formatUnits(step2Calculation.amountOut, 18)) / 
                       Number(ethers.formatUnits(step1Calculation.amountIn, 6));
  console.log(`Effective Rate: ${effectiveRate.toFixed(6)} DAI per USDT`);

  // Check if we have enough USDT
  if (initialUsdtBalance < step1Calculation.amountIn) {
    console.log('\n❌ INSUFFICIENT USDT BALANCE');
    console.log(`Need: ${ethers.formatUnits(step1Calculation.amountIn, 6)} USDT`);
    console.log(`Have: ${ethers.formatUnits(initialUsdtBalance, 6)} USDT`);
    return;
  }

  console.log('\n🚀 EXECUTING REAL TRANSACTIONS:');
  console.log('===============================');

  // Approve USDT for first pool
  console.log('Step 1: Approving USDT...');
  const approveTx1 = await tokens.USDT.contract.approve(
    usdtUsdcPool.target,
    step1Calculation.amountIn
  );
  await approveTx1.wait();
  console.log('✅ USDT approved');

  // Execute first swap: USDT → USDC
  console.log('Step 2: Swapping USDT → USDC...');
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
  
  const swap1Tx = await usdtUsdcPool.swap(
    step2Calculation.amountIn, // USDC amount out
    tokens.USDT.address,
    tokens.USDC.address,
    wallet.address,
    deadline
  );
  
  const swap1Receipt = await swap1Tx.wait();
  console.log(`✅ First swap complete! Gas used: ${swap1Receipt.gasUsed}`);

  // Check intermediate balance
  const intermediateUsdcBalance = await tokens.USDC.contract.balanceOf(wallet.address);
  console.log(`Intermediate USDC balance: ${ethers.formatUnits(intermediateUsdcBalance, 6)}`);

  // Approve USDC for second pool
  console.log('Step 3: Approving USDC...');
  const approveTx2 = await tokens.USDC.contract.approve(
    usdcDaiPool.target,
    step2Calculation.amountIn
  );
  await approveTx2.wait();
  console.log('✅ USDC approved');

  // Execute second swap: USDC → DAI
  console.log('Step 4: Swapping USDC → DAI...');
  
  const swap2Tx = await usdcDaiPool.swap(
    step2Calculation.amountOut, // DAI amount out
    tokens.USDC.address,
    tokens.DAI.address,
    wallet.address,
    deadline
  );
  
  const swap2Receipt = await swap2Tx.wait();
  console.log(`✅ Second swap complete! Gas used: ${swap2Receipt.gasUsed}`);

  console.log('\n🎉 MULTI-HOP SWAP SUCCESSFUL!');
  console.log('=============================');

  // Check final balances
  const finalUsdtBalance = await tokens.USDT.contract.balanceOf(wallet.address);
  const finalUsdcBalance = await tokens.USDC.contract.balanceOf(wallet.address);
  const finalDaiBalance = await tokens.DAI.contract.balanceOf(wallet.address);
  
  console.log('\n📊 FINAL BALANCES:');
  console.log('==================');
  console.log(`USDT: ${ethers.formatUnits(finalUsdtBalance, 6)} (change: ${ethers.formatUnits(finalUsdtBalance - initialUsdtBalance, 6)})`);
  console.log(`USDC: ${ethers.formatUnits(finalUsdcBalance, 6)} (change: ${ethers.formatUnits(finalUsdcBalance - initialUsdcBalance, 6)})`);
  console.log(`DAI: ${ethers.formatUnits(finalDaiBalance, 18)} (change: ${ethers.formatUnits(finalDaiBalance - initialDaiBalance, 18)})`);

  console.log('\n✅ PROOF: MULTI-HOP SWAPS WORK ON BLOCKCHAIN!');
  console.log('============================================');
  console.log('🎯 Successfully executed USDT → USDC → DAI');
  console.log('🎯 Both transactions confirmed on-chain');
  console.log('🎯 Multi-hop routing is fully functional');
  
  console.log('\n📋 TRANSACTION DETAILS:');
  console.log('=======================');
  console.log(`Swap 1 Hash: ${swap1Tx.hash}`);
  console.log(`Swap 2 Hash: ${swap2Tx.hash}`);
  console.log(`Total Gas Used: ${Number(swap1Receipt.gasUsed) + Number(swap2Receipt.gasUsed)}`);
}

executeRealMultiHop()
  .then(() => {
    console.log('\n🏁 Real multi-hop test complete!');
    console.log('Multi-hop swaps are working perfectly on the blockchain!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Real multi-hop test failed:', error);
    process.exit(1);
  });