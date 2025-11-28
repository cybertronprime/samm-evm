#!/usr/bin/env node

/**
 * Initialize DAI Pools for Multi-Hop Swaps
 * This will enable USDT -> USDC -> DAI multi-hop swaps
 */

require('dotenv').config();
const { ethers } = require('ethers');

// Use oldest Monad deployment
const DEPLOYMENT_DATA = require('./deployment-data/monad-multi-shard-1764330063991.json');

// Configuration
const CONFIG = {
  RPC_URL: 'https://testnet-rpc.monad.xyz',
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  CHAIN_ID: 10143
};

// Contract ABIs
const SAMM_POOL_FACTORY_ABI = [
  "function initializeShard(address shard, uint256 amountA, uint256 amountB) external returns (uint256 lpTokens)"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

class DAIPoolInitializer {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);
  }

  async initialize() {
    console.log('🚀 Initializing DAI Pools for Multi-Hop Swaps');
    console.log(`👤 Wallet: ${this.wallet.address}`);
    console.log(`🔗 Network: Monad Testnet`);
    
    // Get contract addresses
    this.factoryAddress = DEPLOYMENT_DATA.contracts.factory;
    this.usdcAddress = DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'USDC').address;
    this.daiAddress = DEPLOYMENT_DATA.contracts.tokens.find(t => t.symbol === 'DAI').address;
    
    console.log(`🏭 Factory: ${this.factoryAddress}`);
    console.log(`💰 USDC: ${this.usdcAddress}`);
    console.log(`💰 DAI: ${this.daiAddress}`);
    
    // Connect to contracts
    this.factory = new ethers.Contract(this.factoryAddress, SAMM_POOL_FACTORY_ABI, this.wallet);
    this.usdc = new ethers.Contract(this.usdcAddress, ERC20_ABI, this.wallet);
    this.dai = new ethers.Contract(this.daiAddress, ERC20_ABI, this.wallet);
    
    console.log('');
  }

  async mintTokens() {
    console.log('💰 Minting tokens for DAI pool initialization...');
    
    let nonce = await this.provider.getTransactionCount(this.wallet.address);
    
    // Mint USDC and DAI for pool initialization
    const usdcAmount = ethers.parseUnits('10000000', 6); // 10M USDC
    const daiAmount = ethers.parseUnits('10000000', 18); // 10M DAI
    
    console.log('   Minting USDC...');
    await this.usdc.mint(this.wallet.address, usdcAmount, { nonce: nonce++ });
    
    console.log('   Minting DAI...');
    await this.dai.mint(this.wallet.address, daiAmount, { nonce: nonce++ });
    
    console.log('✅ Tokens minted successfully\n');
  }

  async initializeDAIPools() {
    console.log('🏊 Initializing USDC/DAI Pools...');
    
    // Get DAI shards from deployment
    const daiShards = DEPLOYMENT_DATA.contracts.shards.filter(s => s.pairName === 'USDC/DAI');
    
    console.log(`📊 Found ${daiShards.length} USDC/DAI shards to initialize:`);
    daiShards.forEach((shard, i) => {
      console.log(`   ${i + 1}. ${shard.name}: ${shard.address}`);
    });
    
    // Different liquidity amounts for each shard (to maintain C-smaller-better)
    const liquidityAmounts = [
      { usdc: '2000000', dai: '2000000' },   // 2M each - USDC/DAI-1
      { usdc: '5000000', dai: '5000000' }    // 5M each - USDC/DAI-2
    ];
    
    let nonce = await this.provider.getTransactionCount(this.wallet.address);
    
    for (let i = 0; i < daiShards.length; i++) {
      const shard = daiShards[i];
      const amounts = liquidityAmounts[i];
      
      try {
        console.log(`\n🏊 Initializing ${shard.name}...`);
        console.log(`   💰 Amounts: ${amounts.usdc} USDC + ${amounts.dai} DAI`);
        
        const usdcAmount = ethers.parseUnits(amounts.usdc, 6);
        const daiAmount = ethers.parseUnits(amounts.dai, 18);
        
        // Approve tokens to factory
        console.log(`   📝 Approving tokens to factory...`);
        await this.usdc.approve(this.factoryAddress, usdcAmount, { nonce: nonce++ });
        await this.dai.approve(this.factoryAddress, daiAmount, { nonce: nonce++ });
        
        // Initialize via factory
        console.log(`   🏊 Calling factory.initializeShard...`);
        const tx = await this.factory.initializeShard(
          shard.address,
          usdcAmount,
          daiAmount,
          { nonce: nonce++, gasLimit: 800000 }
        );
        
        const receipt = await tx.wait();
        console.log(`   ✅ ${shard.name} initialized! Tx: ${receipt.hash}`);
        
      } catch (error) {
        console.log(`   ❌ Failed to initialize ${shard.name}: ${error.message}`);
      }
    }
  }

  async verifyInitialization() {
    console.log('\n📊 Verifying DAI Pool Initialization...');
    
    const daiShards = DEPLOYMENT_DATA.contracts.shards.filter(s => s.pairName === 'USDC/DAI');
    
    for (const shard of daiShards) {
      try {
        const usdcBalance = await this.usdc.balanceOf(shard.address);
        const daiBalance = await this.dai.balanceOf(shard.address);
        
        console.log(`📈 ${shard.name}:`);
        console.log(`   USDC: ${ethers.formatUnits(usdcBalance, 6)}`);
        console.log(`   DAI: ${ethers.formatUnits(daiBalance, 18)}`);
        
      } catch (error) {
        console.log(`   ❌ Error checking ${shard.name}: ${error.message}`);
      }
    }
  }

  async run() {
    try {
      await this.initialize();
      await this.mintTokens();
      await this.initializeDAIPools();
      await this.verifyInitialization();
      
      console.log('\n🎉 DAI Pools Initialized Successfully!');
      console.log('✅ Multi-hop swaps (USDT -> USDC -> DAI) are now possible');
      
    } catch (error) {
      console.error('❌ Initialization failed:', error);
      throw error;
    }
  }
}

// Run the initializer if called directly
if (require.main === module) {
  const initializer = new DAIPoolInitializer();
  initializer.run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Initialization failed:', error);
      process.exit(1);
    });
}

module.exports = DAIPoolInitializer;