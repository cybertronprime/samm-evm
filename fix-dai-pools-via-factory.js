#!/usr/bin/env node

/**
 * Fix DAI Pools via Factory (The Right Way)
 */

require('dotenv').config({ path: '.env.monad' });
const { ethers } = require('ethers');

const DEPLOYMENT_DATA = require('./deployment-data/monad-multi-shard-1764330063991.json');

const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Contract ABIs
const SAMM_POOL_FACTORY_ABI = [
  "function initializeShard(address shard, uint256 amountA, uint256 amountB) external returns (uint256 lpTokens)",
  "function owner() view returns (address)"
];

const SAMM_POOL_ABI = [
  "function getPoolState() view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount) returns (bool)"
];

async function fixDAIPoolsViaFactory() {
  console.log('🏭 FIXING DAI POOLS VIA FACTORY');
  console.log('===============================');
  console.log(`👤 Wallet: ${wallet.address}`);
  console.log(`🏭 Factory: ${DEPLOYMENT_DATA.contracts.factory}`);

  // Connect to factory
  const factory = new ethers.Contract(DEPLOYMENT_DATA.contracts.factory, SAMM_POOL_FACTORY_ABI, wallet);
  
  // Check factory ownership
  const factoryOwner = await factory.owner();
  console.log(`🔑 Factory owner: ${factoryOwner}`);
  console.log(`✅ We own factory: ${factoryOwner.toLowerCase() === wallet.address.toLowerCase()}`);

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
  
  console.log(`\n🏊 Processing ${daiShards.length} DAI pools:`);

  let nonce = await provider.getTransactionCount(wallet.address);

  for (const shard of daiShards) {
    console.log(`\n🔧 Processing ${shard.name} (${shard.address})`);
    
    try {
      const pool = new ethers.Contract(shard.address, SAMM_POOL_ABI, wallet);
      const state = await pool.getPoolState();
      
      console.log(`   Current reserves: ${state.reserveA} DAI, ${state.reserveB} USDC`);
      
      if (state.reserveA.toString() === '0' && state.reserveB.toString() === '0') {
        console.log(`   ❌ Pool not initialized`);
        
        // Check if tokens are already in the pool
        const daiBalance = await tokens.DAI.contract.balanceOf(shard.address);
        const usdcBalance = await tokens.USDC.contract.balanceOf(shard.address);
        
        console.log(`   Pool token balances:`);
        console.log(`     DAI: ${ethers.formatUnits(daiBalance, 18)}`);
        console.log(`     USDC: ${ethers.formatUnits(usdcBalance, 6)}`);
        
        if (daiBalance > 0 && usdcBalance > 0) {
          console.log(`   🏭 Calling factory.initializeShard with existing balances...`);
          
          // The factory should initialize with the tokens already in the pool
          const tx = await factory.initializeShard(
            shard.address,
            daiBalance,     // amountA (DAI)
            usdcBalance,    // amountB (USDC)
            { nonce: nonce++, gasLimit: 1000000 }
          );
          
          const receipt = await tx.wait();
          console.log(`   ✅ Pool initialized via factory! Tx: ${receipt.hash}`);
          
        } else {
          console.log(`   💰 Need to provide liquidity first...`);
          
          // Mint tokens for initialization
          const daiAmount = ethers.parseUnits('1000000', 18); // 1M DAI
          const usdcAmount = ethers.parseUnits('1000000', 6);  // 1M USDC
          
          console.log(`   💰 Minting tokens...`);
          await tokens.DAI.contract.mint(wallet.address, daiAmount, { nonce: nonce++ });
          await tokens.USDC.contract.mint(wallet.address, usdcAmount, { nonce: nonce++ });
          
          console.log(`   📝 Approving tokens to factory...`);
          await tokens.DAI.contract.approve(factory.target, daiAmount, { nonce: nonce++ });
          await tokens.USDC.contract.approve(factory.target, usdcAmount, { nonce: nonce++ });
          
          console.log(`   🏭 Calling factory.initializeShard...`);
          const tx = await factory.initializeShard(
            shard.address,
            daiAmount,
            usdcAmount,
            { nonce: nonce++, gasLimit: 1000000 }
          );
          
          const receipt = await tx.wait();
          console.log(`   ✅ Pool initialized via factory! Tx: ${receipt.hash}`);
        }
        
      } else {
        console.log(`   ✅ Pool already initialized`);
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
        console.log(`❌ ${shard.name}: Still not initialized`);
      }
      
    } catch (error) {
      console.log(`❌ ${shard.name}: Error - ${error.message}`);
    }
  }
}

fixDAIPoolsViaFactory()
  .then(() => {
    console.log('\n🎉 DAI pools should now be properly initialized!');
    console.log('🔀 Multi-hop swaps should work!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Factory initialization failed:', error);
    process.exit(1);
  });