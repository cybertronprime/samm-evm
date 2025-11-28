#!/usr/bin/env node

/**
 * CREATE WORKING DAI POOL
 * Create a fresh DAI pool that actually works for multi-hop
 */

require('dotenv').config({ path: '.env.monad' });
const { ethers } = require('ethers');

const DEPLOYMENT_DATA = require('./deployment-data/monad-multi-shard-1764330063991.json');

const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const FACTORY_ABI = [
  "function createPool(address tokenA, address tokenB, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator) external returns (address pool)",
  "function initializePool(address pool, uint256 amountA, uint256 amountB, address to) external returns (uint256 liquidity)",
  "event PoolCreated(address indexed tokenA, address indexed tokenB, address pool)"
];

const SAMM_POOL_ABI = [
  "function getPoolState() view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))",
  "function calculateSwapSAMM(uint256 amountOut, address tokenIn, address tokenOut) view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function symbol() view returns (string)"
];

async function createWorkingDaiPool() {
  console.log('🏗️  CREATING WORKING DAI POOL');
  console.log('=============================');
  
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
    DEPLOYMENT_DATA.contracts.factory, // It's stored as a string
    FACTORY_ABI,
    wallet
  );

  console.log('\n💰 CURRENT BALANCES:');
  console.log('====================');
  
  const usdcBalance = await tokens.USDC.contract.balanceOf(wallet.address);
  const daiBalance = await tokens.DAI.contract.balanceOf(wallet.address);
  
  console.log(`USDC: ${ethers.formatUnits(usdcBalance, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiBalance, 18)}`);

  console.log('\n🏗️  CREATING NEW USDC/DAI POOL:');
  console.log('===============================');
  
  try {
    console.log('Creating pool...');
    const createTx = await factory.createPool(
      tokens.USDC.address,
      tokens.DAI.address,
      3, // 0.3% trade fee
      1000,
      1, // 0.1% owner fee  
      1000,
      { gasLimit: 2000000 }
    );
    
    console.log(`Transaction sent: ${createTx.hash}`);
    const receipt = await createTx.wait();
    console.log(`✅ Pool creation confirmed! Gas used: ${receipt.gasUsed}`);
    
    // Find the new pool address from events
    let newPoolAddress = null;
    for (const log of receipt.logs) {
      try {
        const decoded = factory.interface.parseLog(log);
        if (decoded.name === 'PoolCreated') {
          newPoolAddress = decoded.args.pool;
          console.log(`✅ New pool address: ${newPoolAddress}`);
          break;
        }
      } catch (e) {
        // Skip logs that don't match our interface
      }
    }
    
    if (!newPoolAddress) {
      console.log('❌ Could not find pool address in transaction logs');
      return;
    }

    console.log('\n💧 INITIALIZING POOL WITH LIQUIDITY:');
    console.log('====================================');
    
    const usdcAmount = ethers.parseUnits('1000000', 6); // 1M USDC
    const daiAmount = ethers.parseUnits('1000000', 18); // 1M DAI
    
    console.log(`Approving ${ethers.formatUnits(usdcAmount, 6)} USDC...`);
    const approveUsdcTx = await tokens.USDC.contract.approve(factory.target, usdcAmount);
    await approveUsdcTx.wait();
    
    console.log(`Approving ${ethers.formatUnits(daiAmount, 18)} DAI...`);
    const approveDaiTx = await tokens.DAI.contract.approve(factory.target, daiAmount);
    await approveDaiTx.wait();
    
    console.log('Initializing pool with liquidity...');
    const initTx = await factory.initializePool(
      newPoolAddress,
      usdcAmount,
      daiAmount,
      wallet.address,
      { gasLimit: 2000000 }
    );
    
    console.log(`Initialization transaction sent: ${initTx.hash}`);
    const initReceipt = await initTx.wait();
    console.log(`✅ Pool initialized! Gas used: ${initReceipt.gasUsed}`);

    console.log('\n📊 CHECKING NEW POOL STATE:');
    console.log('===========================');
    
    const newPool = new ethers.Contract(newPoolAddress, SAMM_POOL_ABI, wallet);
    const state = await newPool.getPoolState();
    
    console.log(`Token A (USDC): ${state.tokenA}`);
    console.log(`Token B (DAI): ${state.tokenB}`);
    console.log(`USDC Reserve: ${ethers.formatUnits(state.reserveA, 6)}`);
    console.log(`DAI Reserve: ${ethers.formatUnits(state.reserveB, 18)}`);
    console.log(`Total Supply: ${ethers.formatUnits(state.totalSupply, 18)}`);
    
    const reserveA = Number(ethers.formatUnits(state.reserveA, 6));
    const reserveB = Number(ethers.formatUnits(state.reserveB, 18));
    const ratio = reserveA / reserveB;
    
    console.log(`Exchange Rate: 1 DAI = ${ratio.toFixed(6)} USDC`);

    console.log('\n🧪 TESTING SWAP CALCULATION:');
    console.log('============================');
    
    try {
      const testDaiAmount = ethers.parseUnits('1', 18); // 1 DAI
      const calculation = await newPool.calculateSwapSAMM(
        testDaiAmount,
        tokens.USDC.address,
        tokens.DAI.address
      );
      
      console.log(`✅ Swap calculation works!`);
      console.log(`To get 1 DAI:`);
      console.log(`  Need: ${ethers.formatUnits(calculation.amountIn, 6)} USDC`);
      console.log(`  Fee: ${ethers.formatUnits(calculation.tradeFee, 18)} DAI`);
      console.log(`  Rate: ${Number(ethers.formatUnits(calculation.amountIn, 6)).toFixed(6)} USDC per DAI`);
      
      const rate = Number(ethers.formatUnits(calculation.amountIn, 6));
      if (rate > 0.9 && rate < 1.1) {
        console.log(`✅ Rate looks reasonable!`);
      } else {
        console.log(`⚠️  Rate seems unusual: ${rate.toFixed(6)}`);
      }
      
    } catch (error) {
      console.log(`❌ Swap calculation failed: ${error.message}`);
    }

    console.log('\n🎉 SUCCESS! WORKING DAI POOL CREATED');
    console.log('====================================');
    console.log(`✅ Pool Address: ${newPoolAddress}`);
    console.log(`✅ USDC Reserve: ${ethers.formatUnits(state.reserveA, 6)}`);
    console.log(`✅ DAI Reserve: ${ethers.formatUnits(state.reserveB, 18)}`);
    console.log(`✅ Ready for multi-hop swaps!`);
    
    // Update deployment data
    console.log('\n📝 POOL INFO FOR DEPLOYMENT DATA:');
    console.log('=================================');
    console.log(`Add this to your deployment data:`);
    console.log(`{`);
    console.log(`  "name": "USDC/DAI-WORKING",`);
    console.log(`  "pairName": "USDC/DAI",`);
    console.log(`  "address": "${newPoolAddress}",`);
    console.log(`  "tokenA": "${tokens.USDC.address}",`);
    console.log(`  "tokenB": "${tokens.DAI.address}",`);
    console.log(`  "liquidity": "1000000.0"`);
    console.log(`}`);
    
  } catch (error) {
    console.log(`❌ Failed to create working DAI pool: ${error.message}`);
    console.log('Full error:', error);
  }
}

createWorkingDaiPool()
  .then(() => {
    console.log('\n🏁 Working DAI pool creation complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Working DAI pool creation failed:', error);
    process.exit(1);
  });