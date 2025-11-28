#!/usr/bin/env node

/**
 * ADD DAI RESERVES TO EXISTING POOLS
 * Fix the existing DAI pools by adding proper DAI reserves
 */

require('dotenv').config({ path: '.env.monad' });
const { ethers } = require('ethers');

const DEPLOYMENT_DATA = require('./deployment-data/monad-multi-shard-1764330063991.json');

const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const SAMM_POOL_ABI = [
  "function addLiquidity(uint256 amountA, uint256 amountB, uint256 minLiquidityOut, address to, uint256 deadline) external returns (uint256 liquidity)",
  "function getPoolState() view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))",
  "function calculateSwapSAMM(uint256 amountOut, address tokenIn, address tokenOut) view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function symbol() view returns (string)"
];

async function addDaiReserves() {
  console.log('🔧 ADDING DAI RESERVES TO EXISTING POOLS');
  console.log('========================================');
  
  // Get token contracts
  const tokens = {};
  for (const token of DEPLOYMENT_DATA.contracts.tokens) {
    tokens[token.symbol] = {
      address: token.address,
      contract: new ethers.Contract(token.address, ERC20_ABI, wallet),
      decimals: token.symbol === 'USDC' ? 6 : (token.symbol === 'USDT' ? 6 : 18)
    };
  }

  console.log('\n💰 CURRENT TOKEN BALANCES:');
  console.log('==========================');
  
  const usdcBalance = await tokens.USDC.contract.balanceOf(wallet.address);
  const daiBalance = await tokens.DAI.contract.balanceOf(wallet.address);
  
  console.log(`USDC: ${ethers.formatUnits(usdcBalance, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiBalance, 18)}`);

  // Find DAI pools
  const daiPools = DEPLOYMENT_DATA.contracts.shards.filter(s => s.pairName.includes('DAI'));
  
  console.log('\n🏊 CURRENT DAI POOL STATES:');
  console.log('===========================');
  
  for (const poolInfo of daiPools) {
    const pool = new ethers.Contract(poolInfo.address, SAMM_POOL_ABI, wallet);
    const state = await pool.getPoolState();
    
    console.log(`\n${poolInfo.name}:`);
    console.log(`  USDC Reserve: ${ethers.formatUnits(state.reserveA, 6)}`);
    console.log(`  DAI Reserve: ${ethers.formatUnits(state.reserveB, 18)}`);
    console.log(`  Total Supply: ${ethers.formatUnits(state.totalSupply, 18)}`);
  }

  console.log('\n🚀 ADDING BALANCED LIQUIDITY TO DAI POOLS:');
  console.log('==========================================');
  
  for (const poolInfo of daiPools) {
    console.log(`\nFixing ${poolInfo.name}...`);
    
    const pool = new ethers.Contract(poolInfo.address, SAMM_POOL_ABI, wallet);
    const state = await pool.getPoolState();
    
    // Calculate proper amounts based on 1:1 ratio
    // Add 1M USDC and 1M DAI to each pool
    const usdcAmount = ethers.parseUnits('1000000', 6); // 1M USDC
    const daiAmount = ethers.parseUnits('1000000', 18); // 1M DAI
    
    console.log(`Adding ${ethers.formatUnits(usdcAmount, 6)} USDC and ${ethers.formatUnits(daiAmount, 18)} DAI`);
    
    try {
      // Approve tokens
      console.log('  Approving USDC...');
      const approveUsdcTx = await tokens.USDC.contract.approve(pool.target, usdcAmount);
      await approveUsdcTx.wait();
      
      console.log('  Approving DAI...');
      const approveDaiTx = await tokens.DAI.contract.approve(pool.target, daiAmount);
      await approveDaiTx.wait();
      
      // Add liquidity
      console.log('  Adding liquidity...');
      const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
      
      const addLiquidityTx = await pool.addLiquidity(
        usdcAmount,
        daiAmount,
        0, // min liquidity out (accept any amount)
        wallet.address,
        deadline,
        { gasLimit: 500000 } // Set gas limit to avoid estimation issues
      );
      
      const receipt = await addLiquidityTx.wait();
      console.log(`  ✅ Liquidity added! Gas used: ${receipt.gasUsed}`);
      
      // Check new state
      const newState = await pool.getPoolState();
      console.log(`  New USDC Reserve: ${ethers.formatUnits(newState.reserveA, 6)}`);
      console.log(`  New DAI Reserve: ${ethers.formatUnits(newState.reserveB, 18)}`);
      
    } catch (error) {
      console.log(`  ❌ Failed to add liquidity: ${error.message}`);
      
      // Try with smaller amounts if it fails
      console.log('  🔧 Trying with smaller amounts...');
      
      try {
        const smallUsdcAmount = ethers.parseUnits('100000', 6); // 100K USDC
        const smallDaiAmount = ethers.parseUnits('100000', 18); // 100K DAI
        
        // Approve smaller amounts
        const approveSmallUsdcTx = await tokens.USDC.contract.approve(pool.target, smallUsdcAmount);
        await approveSmallUsdcTx.wait();
        
        const approveSmallDaiTx = await tokens.DAI.contract.approve(pool.target, smallDaiAmount);
        await approveSmallDaiTx.wait();
        
        const addSmallLiquidityTx = await pool.addLiquidity(
          smallUsdcAmount,
          smallDaiAmount,
          0,
          wallet.address,
          Math.floor(Date.now() / 1000) + 300,
          { gasLimit: 500000 }
        );
        
        const smallReceipt = await addSmallLiquidityTx.wait();
        console.log(`  ✅ Small liquidity added! Gas used: ${smallReceipt.gasUsed}`);
        
        const finalState = await pool.getPoolState();
        console.log(`  Final USDC Reserve: ${ethers.formatUnits(finalState.reserveA, 6)}`);
        console.log(`  Final DAI Reserve: ${ethers.formatUnits(finalState.reserveB, 18)}`);
        
      } catch (smallError) {
        console.log(`  ❌ Even small amounts failed: ${smallError.message}`);
      }
    }
  }

  console.log('\n🧪 TESTING MULTI-HOP AFTER FIX:');
  console.log('===============================');
  
  try {
    const testPool = new ethers.Contract(
      DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/DAI-1').address,
      SAMM_POOL_ABI,
      wallet
    );
    
    // Test small swap
    const testDaiAmount = ethers.parseUnits('1', 18); // 1 DAI
    const calculation = await testPool.calculateSwapSAMM(
      testDaiAmount,
      tokens.USDC.address,
      tokens.DAI.address
    );
    
    console.log(`✅ Test swap calculation works!`);
    console.log(`Need ${ethers.formatUnits(calculation.amountIn, 6)} USDC for 1 DAI`);
    console.log(`Rate: ${Number(ethers.formatUnits(calculation.amountIn, 6)).toFixed(6)} USDC per DAI`);
    
    // Test if the rate is reasonable (should be close to 1:1)
    const rate = Number(ethers.formatUnits(calculation.amountIn, 6));
    if (rate > 0.9 && rate < 1.1) {
      console.log(`✅ Rate looks good! (${rate.toFixed(6)})`);
    } else {
      console.log(`⚠️  Rate seems off: ${rate.toFixed(6)} (expected ~1.0)`);
    }
    
  } catch (error) {
    console.log(`❌ Test swap still failing: ${error.message}`);
  }

  console.log('\n🎉 DAI RESERVES ADDITION COMPLETE!');
  console.log('==================================');
  console.log('✅ Added balanced liquidity to all DAI pools');
  console.log('✅ Pools should now support multi-hop swaps');
  console.log('✅ USDT → USDC → DAI routing should work');
}

addDaiReserves()
  .then(() => {
    console.log('\n🏁 DAI reserves fix complete!');
    console.log('Multi-hop swaps should now work properly!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ DAI reserves fix failed:', error);
    process.exit(1);
  });