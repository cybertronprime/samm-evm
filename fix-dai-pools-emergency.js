#!/usr/bin/env node

/**
 * EMERGENCY DAI POOL FIX
 * The DAI pools are completely broken - fix them now!
 */

require('dotenv').config({ path: '.env.monad' });
const { ethers } = require('ethers');

const DEPLOYMENT_DATA = require('./deployment-data/monad-multi-shard-1764330063991.json');

const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const SAMM_POOL_ABI = [
  "function addLiquidity(uint256 amountA, uint256 amountB, uint256 minLiquidityOut, address to, uint256 deadline) external returns (uint256 liquidity)",
  "function getPoolState() view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function symbol() view returns (string)"
];

async function fixDaiPools() {
  console.log('🚨 EMERGENCY DAI POOL FIX');
  console.log('=========================');
  
  // Get token contracts
  const tokens = {};
  for (const token of DEPLOYMENT_DATA.contracts.tokens) {
    tokens[token.symbol] = {
      address: token.address,
      contract: new ethers.Contract(token.address, ERC20_ABI, wallet),
      decimals: token.symbol === 'USDC' ? 6 : (token.symbol === 'USDT' ? 6 : 18)
    };
  }

  console.log('\n💰 CURRENT BALANCES:');
  console.log('====================');
  
  const usdcBalance = await tokens.USDC.contract.balanceOf(wallet.address);
  const daiBalance = await tokens.DAI.contract.balanceOf(wallet.address);
  
  console.log(`USDC: ${ethers.formatUnits(usdcBalance, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiBalance, 18)}`);

  // Find all DAI pools
  const daiPools = DEPLOYMENT_DATA.contracts.shards.filter(s => s.pairName.includes('DAI'));
  
  console.log('\n🔧 FIXING DAI POOLS:');
  console.log('====================');
  
  for (const poolInfo of daiPools) {
    console.log(`\nFixing ${poolInfo.name}...`);
    
    const pool = new ethers.Contract(poolInfo.address, SAMM_POOL_ABI, wallet);
    
    // Check current state
    const state = await pool.getPoolState();
    console.log(`Current USDC Reserve: ${ethers.formatUnits(state.reserveA, 6)}`);
    console.log(`Current DAI Reserve: ${ethers.formatUnits(state.reserveB, 18)}`);
    
    // Add massive liquidity to fix the pool
    const usdcAmount = ethers.parseUnits('10000000', 6); // 10M USDC
    const daiAmount = ethers.parseUnits('10000000', 18); // 10M DAI
    
    console.log('Approving tokens...');
    
    // Approve USDC
    const approveUsdcTx = await tokens.USDC.contract.approve(pool.target, usdcAmount);
    await approveUsdcTx.wait();
    
    // Approve DAI
    const approveDaiTx = await tokens.DAI.contract.approve(pool.target, daiAmount);
    await approveDaiTx.wait();
    
    console.log('Adding liquidity...');
    
    const deadline = Math.floor(Date.now() / 1000) + 300;
    
    try {
      const addLiquidityTx = await pool.addLiquidity(
        usdcAmount,
        daiAmount,
        0, // min liquidity out
        wallet.address,
        deadline
      );
      
      const receipt = await addLiquidityTx.wait();
      console.log(`✅ Liquidity added! Gas used: ${receipt.gasUsed}`);
      
      // Check new state
      const newState = await pool.getPoolState();
      console.log(`New USDC Reserve: ${ethers.formatUnits(newState.reserveA, 6)}`);
      console.log(`New DAI Reserve: ${ethers.formatUnits(newState.reserveB, 18)}`);
      
    } catch (error) {
      console.log(`❌ Failed to add liquidity: ${error.message}`);
    }
  }

  console.log('\n🎉 DAI POOL FIX COMPLETE!');
  console.log('=========================');
  
  // Test a small swap to verify it works
  console.log('\n🧪 TESTING SMALL SWAP:');
  console.log('======================');
  
  const testPool = new ethers.Contract(
    DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/DAI-1').address,
    [
      ...SAMM_POOL_ABI,
      "function calculateSwapSAMM(uint256 amountOut, address tokenIn, address tokenOut) view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))"
    ],
    wallet
  );
  
  try {
    const testAmount = ethers.parseUnits('1', 18); // 1 DAI
    const calculation = await testPool.calculateSwapSAMM(
      testAmount,
      tokens.USDC.address,
      tokens.DAI.address
    );
    
    console.log(`✅ Test swap works!`);
    console.log(`Need ${ethers.formatUnits(calculation.amountIn, 6)} USDC for 1 DAI`);
    
  } catch (error) {
    console.log(`❌ Test swap still failing: ${error.message}`);
  }
}

fixDaiPools()
  .then(() => {
    console.log('\n🏁 DAI pool fix complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ DAI pool fix failed:', error);
    process.exit(1);
  });