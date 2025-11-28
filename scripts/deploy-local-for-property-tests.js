/**
 * Deploy Local Contracts for Property Tests
 * Deploys fresh SAMM contracts and tokens on local Hardhat network
 * Then sends tokens to specified address for testing
 */

const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

// Configuration
const TARGET_ADDRESS = '0x0fb795cfc581666932abafe438bd3ce6702da69c';
const AMOUNT_TO_SEND = ethers.parseEther('1000'); // 1000 tokens each

async function main() {
  console.log('🚀 Deploying SAMM contracts locally for property tests...');
  console.log('='.repeat(60));
  
  try {
    const [deployer] = await ethers.getSigners();
    console.log(`Deployer: ${deployer.address}`);
    console.log(`Deployer balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
    
    // 1. Deploy SAMM Pool Factory
    console.log('\n1️⃣ Deploying SAMM Pool Factory...');
    const SAMMPoolFactory = await ethers.getContractFactory('SAMMPoolFactory');
    const factory = await SAMMPoolFactory.deploy();
    await factory.waitForDeployment();
    
    const factoryAddress = await factory.getAddress();
    console.log(`✅ SAMM Factory deployed: ${factoryAddress}`);
    
    // 2. Deploy test tokens
    console.log('\n2️⃣ Deploying test tokens...');
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    
    const usdc = await MockERC20.deploy('USD Coin', 'USDC', 6);
    await usdc.waitForDeployment();
    
    const usdt = await MockERC20.deploy('Tether USD', 'USDT', 6);
    await usdt.waitForDeployment();
    
    const dai = await MockERC20.deploy('Dai Stablecoin', 'DAI', 18);
    await dai.waitForDeployment();
    
    const usdcAddress = await usdc.getAddress();
    const usdtAddress = await usdt.getAddress();
    const daiAddress = await dai.getAddress();
    
    console.log(`✅ USDC deployed: ${usdcAddress}`);
    console.log(`✅ USDT deployed: ${usdtAddress}`);
    console.log(`✅ DAI deployed: ${daiAddress}`);
    
    // 3. Create multiple shards for each token pair
    console.log('\n3️⃣ Creating SAMM shards...');
    
    const shards = [];
    
    // Create USDC/USDT shards (3 shards with different sizes)
    console.log('   Creating USDC/USDT shards...');
    for (let i = 0; i < 3; i++) {
      const createTx = await factory.createShardDefault(usdcAddress, usdtAddress);
      const receipt = await createTx.wait();
      
      const shardCreatedEvent = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'ShardCreated'
      );
      
      if (!shardCreatedEvent) {
        throw new Error(`ShardCreated event not found for USDC/USDT shard ${i + 1}`);
      }
      
      const shardAddress = shardCreatedEvent.args[0];
      shards.push({
        name: `USDC/USDT-${i + 1}`,
        pairName: 'USDC/USDT',
        address: shardAddress,
        tokenA: usdcAddress,
        tokenB: usdtAddress,
        liquidity: (100 * (i + 1)).toString() // 100, 200, 300
      });
      
      console.log(`   ✅ USDC/USDT-${i + 1}: ${shardAddress}`);
    }
    
    // Create USDC/DAI shards (2 shards with different sizes)
    console.log('   Creating USDC/DAI shards...');
    for (let i = 0; i < 2; i++) {
      const createTx = await factory.createShardDefault(usdcAddress, daiAddress);
      const receipt = await createTx.wait();
      
      const shardCreatedEvent = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'ShardCreated'
      );
      
      if (!shardCreatedEvent) {
        throw new Error(`ShardCreated event not found for USDC/DAI shard ${i + 1}`);
      }
      
      const shardAddress = shardCreatedEvent.args[0];
      shards.push({
        name: `USDC/DAI-${i + 1}`,
        pairName: 'USDC/DAI',
        address: shardAddress,
        tokenA: usdcAddress,
        tokenB: daiAddress,
        liquidity: (200 * (i + 1)).toString() // 200, 400
      });
      
      console.log(`   ✅ USDC/DAI-${i + 1}: ${shardAddress}`);
    }
    
    console.log(`✅ Created ${shards.length} shards total`);
    
    // 4. Initialize shards with liquidity
    console.log('\n4️⃣ Initializing shards with liquidity...');
    
    // Mint tokens to deployer
    const mintAmount = ethers.parseUnits('1000000', 6); // 1M USDC/USDT (6 decimals)
    const mintAmountDAI = ethers.parseEther('1000000'); // 1M DAI (18 decimals)
    
    console.log('   Minting tokens to deployer...');
    await usdc.mint(deployer.address, mintAmount);
    await usdt.mint(deployer.address, mintAmount);
    await dai.mint(deployer.address, mintAmountDAI);
    
    const SAMMPool = await ethers.getContractFactory('SAMMPool');
    
    for (const shard of shards) {
      console.log(`   Initializing ${shard.name}...`);
      
      const shardContract = SAMMPool.attach(shard.address);
      
      // Determine liquidity amounts based on shard size
      let liquidityA, liquidityB;
      
      if (shard.pairName === 'USDC/USDT') {
        // Both 6 decimals
        liquidityA = ethers.parseUnits(shard.liquidity, 6);
        liquidityB = ethers.parseUnits(shard.liquidity, 6);
      } else {
        // USDC (6 decimals) / DAI (18 decimals)
        liquidityA = ethers.parseUnits(shard.liquidity, 6);
        liquidityB = ethers.parseEther(shard.liquidity);
      }
      
      // Approve tokens
      if (shard.tokenA === usdcAddress) {
        await usdc.approve(shard.address, liquidityA);
      }
      if (shard.tokenB === usdtAddress) {
        await usdt.approve(shard.address, liquidityB);
      }
      if (shard.tokenB === daiAddress) {
        await dai.approve(shard.address, liquidityB);
      }
      
      // Initialize shard
      const initTx = await shardContract.initialize(
        shard.tokenA,
        shard.tokenB,
        liquidityA,
        liquidityB,
        25,    // tradeFeeNumerator (0.25%)
        10000, // tradeFeeDenominator
        10,    // ownerFeeNumerator (0.1%)
        10000  // ownerFeeDenominator
      );
      await initTx.wait();
      
      console.log(`   ✅ ${shard.name} initialized with ${shard.liquidity} tokens each`);
    }
    
    // 5. Send tokens to target address
    console.log(`\n5️⃣ Sending tokens to ${TARGET_ADDRESS}...`);
    
    const tokens = [
      { contract: usdc, symbol: 'USDC', decimals: 6 },
      { contract: usdt, symbol: 'USDT', decimals: 6 },
      { contract: dai, symbol: 'DAI', decimals: 18 }
    ];
    
    for (const token of tokens) {
      const amountToSend = ethers.parseUnits('1000', token.decimals);
      
      console.log(`   Sending ${ethers.formatUnits(amountToSend, token.decimals)} ${token.symbol}...`);
      
      const transferTx = await token.contract.transfer(TARGET_ADDRESS, amountToSend);
      await transferTx.wait();
      
      const targetBalance = await token.contract.balanceOf(TARGET_ADDRESS);
      console.log(`   ✅ ${token.symbol} sent. Target balance: ${ethers.formatUnits(targetBalance, token.decimals)}`);
    }
    
    // 6. Send LP tokens from pools
    console.log('\n6️⃣ Sending LP tokens from pools...');
    
    for (const shard of shards) {
      const shardContract = SAMMPool.attach(shard.address);
      const deployerLPBalance = await shardContract.balanceOf(deployer.address);
      
      if (deployerLPBalance > 0) {
        // Send half of LP tokens to target address
        const amountToSend = deployerLPBalance / 2n;
        
        console.log(`   Sending ${ethers.formatEther(amountToSend)} LP tokens from ${shard.name}...`);
        
        const transferTx = await shardContract.transfer(TARGET_ADDRESS, amountToSend);
        await transferTx.wait();
        
        const targetLPBalance = await shardContract.balanceOf(TARGET_ADDRESS);
        console.log(`   ✅ LP tokens sent. Target balance: ${ethers.formatEther(targetLPBalance)}`);
      }
    }
    
    // 7. Send ETH for gas
    console.log('\n7️⃣ Sending ETH for gas...');
    const ethAmount = ethers.parseEther('10.0'); // 10 ETH
    const ethTx = await deployer.sendTransaction({
      to: TARGET_ADDRESS,
      value: ethAmount
    });
    await ethTx.wait();
    
    const targetEthBalance = await ethers.provider.getBalance(TARGET_ADDRESS);
    console.log(`✅ ETH sent. Target balance: ${ethers.formatEther(targetEthBalance)}`);
    
    // 8. Save deployment data
    console.log('\n8️⃣ Saving deployment data...');
    
    const deploymentData = {
      network: 'Hardhat Local',
      chainId: 31337,
      timestamp: new Date().toISOString(),
      deployer: deployer.address,
      sammCoreFeature: 'Multiple shards per token pair',
      contracts: {
        factory: factoryAddress,
        tokens: [
          { symbol: 'USDC', address: usdcAddress },
          { symbol: 'USDT', address: usdtAddress },
          { symbol: 'DAI', address: daiAddress }
        ],
        shards: shards
      },
      multiShardStats: {
        totalShards: shards.length,
        usdcUsdtShards: shards.filter(s => s.pairName === 'USDC/USDT').length,
        usdcDaiShards: shards.filter(s => s.pairName === 'USDC/DAI').length,
        demonstratesMultiShardArchitecture: true
      },
      testResults: {
        allShardsInitialized: true,
        tokensDistributed: true,
        lpTokensDistributed: true,
        targetAddress: TARGET_ADDRESS
      }
    };
    
    const deploymentPath = path.join(__dirname, '..', 'deployment-data', `local-hardhat-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));
    
    console.log(`✅ Deployment data saved: ${deploymentPath}`);
    
    // 9. Final summary
    console.log('\n📊 Final balances for', TARGET_ADDRESS);
    console.log('='.repeat(50));
    
    const ethBalance = await ethers.provider.getBalance(TARGET_ADDRESS);
    console.log(`ETH: ${ethers.formatEther(ethBalance)}`);
    
    for (const token of tokens) {
      const balance = await token.contract.balanceOf(TARGET_ADDRESS);
      console.log(`${token.symbol}: ${ethers.formatUnits(balance, token.decimals)}`);
    }
    
    console.log('\nLP Tokens:');
    for (const shard of shards) {
      const shardContract = SAMMPool.attach(shard.address);
      const balance = await shardContract.balanceOf(TARGET_ADDRESS);
      console.log(`${shard.name}: ${ethers.formatEther(balance)}`);
    }
    
    console.log('\n🎉 Local deployment complete!');
    console.log('✅ All contracts deployed and tokens distributed');
    console.log('🧪 Ready for cross-pool router property tests');
    
    return deploymentData;
    
  } catch (error) {
    console.error('❌ Deployment failed:', error);
    throw error;
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { main };