const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Starting SAMM EVM Production Deployment to Monad Testnet");
  console.log("=".repeat(70));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet("9387e097a14f64f865d10cc50835d3b16c3683f2e2cebd518b2456260f1e59ad", provider);
  const testingAddress = "0x0fb795cfc581666932abafe438bd3ce6702da69c"; // Testing address

  console.log("📋 Deployment Details:");
  console.log(`Network: Monad Testnet (Chain ID: 10143)`);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Testing Address: ${testingAddress}`);
  
  // Check balance
  const balance = await provider.getBalance(wallet.address);
  const balanceEth = ethers.formatEther(balance);
  console.log(`Current Balance: ${balanceEth} MON`);
  
  if (parseFloat(balanceEth) < 1.0) {
    throw new Error(`❌ Insufficient balance. Need at least 1.0 MON for production deployment`);
  }
  console.log("✅ Balance sufficient for production deployment");

  // Get network info
  const network = await provider.getNetwork();
  console.log(`\n🌐 Connected to Monad Testnet`);
  console.log(`Chain ID: ${network.chainId}`);

  console.log("\n🏭 Deploying SAMMPoolFactory...");
  
  // Deploy factory
  const SAMMPoolFactory = await ethers.getContractFactory("SAMMPoolFactory", wallet);
  const factory = await SAMMPoolFactory.deploy();
  await factory.waitForDeployment();
  
  const factoryAddress = await factory.getAddress();
  console.log(`✅ SAMMPoolFactory deployed at: ${factoryAddress}`);

  console.log("\n🪙 Deploying production-grade mock tokens...");
  
  // Deploy tokens with proper nonce management
  const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
  
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`✅ USDC deployed at: ${usdcAddress}`);
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const usdt = await MockERC20.deploy("Tether USD", "USDT", 6);
  await usdt.waitForDeployment();
  const usdtAddress = await usdt.getAddress();
  console.log(`✅ USDT deployed at: ${usdtAddress}`);
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const dai = await MockERC20.deploy("Dai Stablecoin", "DAI", 18);
  await dai.waitForDeployment();
  const daiAddress = await dai.getAddress();
  console.log(`✅ DAI deployed at: ${daiAddress}`);

  console.log("\n💰 Minting large amounts of tokens for production testing...");
  
  // Mint 100 million tokens to deployer (production-scale amounts)
  const usdcMintAmount = ethers.parseUnits("100000000", 6); // 100M USDC
  const usdtMintAmount = ethers.parseUnits("100000000", 6); // 100M USDT  
  const daiMintAmount = ethers.parseUnits("100000000", 18); // 100M DAI
  
  await usdc.mint(wallet.address, usdcMintAmount);
  console.log("✅ Minted 100,000,000 USDC to deployer");
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await usdt.mint(wallet.address, usdtMintAmount);
  console.log("✅ Minted 100,000,000 USDT to deployer");
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await dai.mint(wallet.address, daiMintAmount);
  console.log("✅ Minted 100,000,000 DAI to deployer");

  console.log("\n🎁 Minting tokens for testing address...");
  
  // Mint 10 million tokens to testing address
  const testUsdcAmount = ethers.parseUnits("10000000", 6); // 10M USDC
  const testUsdtAmount = ethers.parseUnits("10000000", 6); // 10M USDT
  const testDaiAmount = ethers.parseUnits("10000000", 18); // 10M DAI
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await usdc.mint(testingAddress, testUsdcAmount);
  console.log(`✅ Minted 10,000,000 USDC to testing address: ${testingAddress}`);
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await usdt.mint(testingAddress, testUsdtAmount);
  console.log(`✅ Minted 10,000,000 USDT to testing address: ${testingAddress}`);
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await dai.mint(testingAddress, testDaiAmount);
  console.log(`✅ Minted 10,000,000 DAI to testing address: ${testingAddress}`);

  console.log("\n🏊 Creating production-scale pools with high liquidity...");
  
  // Create USDC/USDT pool with 5 shards
  console.log("📊 Creating USDC/USDT pool with 5 shards...");
  const usdcUsdtShards = [];
  
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between shards
    
    const tx = await factory.createPool(usdcAddress, usdtAddress, 1);
    const receipt = await tx.wait();
    
    // Find the PoolCreated event
    const poolCreatedEvent = receipt.logs.find(log => {
      try {
        const parsed = factory.interface.parseLog(log);
        return parsed && parsed.name === 'PoolCreated';
      } catch (e) {
        return false;
      }
    });
    
    if (poolCreatedEvent) {
      const parsed = factory.interface.parseLog(poolCreatedEvent);
      const shardAddress = parsed.args[2][0]; // First shard address
      usdcUsdtShards.push(shardAddress);
      console.log(`✅ USDC/USDT Shard ${i + 1} created at: ${shardAddress}`);
    }
  }
  
  // Create USDC/DAI pool with 5 shards
  console.log("📊 Creating USDC/DAI pool with 5 shards...");
  const usdcDaiShards = [];
  
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between shards
    
    const tx = await factory.createPool(usdcAddress, daiAddress, 1);
    const receipt = await tx.wait();
    
    // Find the PoolCreated event
    const poolCreatedEvent = receipt.logs.find(log => {
      try {
        const parsed = factory.interface.parseLog(log);
        return parsed && parsed.name === 'PoolCreated';
      } catch (e) {
        return false;
      }
    });
    
    if (poolCreatedEvent) {
      const parsed = factory.interface.parseLog(poolCreatedEvent);
      const shardAddress = parsed.args[2][0]; // First shard address
      usdcDaiShards.push(shardAddress);
      console.log(`✅ USDC/DAI Shard ${i + 1} created at: ${shardAddress}`);
    }
  }

  console.log("\n💧 Adding massive liquidity to all shards for production testing...");
  
  const SAMMPool = await ethers.getContractFactory("SAMMPool");
  
  // Liquidity amounts for each shard (varying sizes for realistic testing)
  const liquidityLevels = [
    { usdc: "5000000", usdt: "5000000", dai: "5000000" },    // 5M each - Large shard
    { usdc: "3000000", usdt: "3000000", dai: "3000000" },    // 3M each - Medium-large shard
    { usdc: "2000000", usdt: "2000000", dai: "2000000" },    // 2M each - Medium shard
    { usdc: "1000000", usdt: "1000000", dai: "1000000" },    // 1M each - Small-medium shard
    { usdc: "500000", usdt: "500000", dai: "500000" }        // 500K each - Small shard
  ];
  
  // Add liquidity to USDC/USDT shards
  console.log("💰 Adding liquidity to USDC/USDT shards...");
  for (let i = 0; i < usdcUsdtShards.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
    
    const pool = SAMMPool.attach(usdcUsdtShards[i]);
    const amount0 = ethers.parseUnits(liquidityLevels[i].usdc, 6); // USDC
    const amount1 = ethers.parseUnits(liquidityLevels[i].usdt, 6); // USDT
    
    console.log(`  Adding ${liquidityLevels[i].usdc} USDC + ${liquidityLevels[i].usdt} USDT to shard ${i + 1}...`);
    
    // Approve tokens
    await usdc.approve(usdcUsdtShards[i], amount0);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await usdt.approve(usdcUsdtShards[i], amount1);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Add liquidity
    await pool.addLiquidity(amount0, amount1, 0, 0, wallet.address, Math.floor(Date.now() / 1000) + 3600);
    console.log(`✅ Added ${liquidityLevels[i].usdc} USDC + ${liquidityLevels[i].usdt} USDT to USDC/USDT shard ${i + 1}`);
  }
  
  // Add liquidity to USDC/DAI shards
  console.log("💰 Adding liquidity to USDC/DAI shards...");
  for (let i = 0; i < usdcDaiShards.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
    
    const pool = SAMMPool.attach(usdcDaiShards[i]);
    const amount0 = ethers.parseUnits(liquidityLevels[i].usdc, 6); // USDC
    const amount1 = ethers.parseUnits(liquidityLevels[i].dai, 18); // DAI
    
    console.log(`  Adding ${liquidityLevels[i].usdc} USDC + ${liquidityLevels[i].dai} DAI to shard ${i + 1}...`);
    
    // Approve tokens
    await usdc.approve(usdcDaiShards[i], amount0);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await dai.approve(usdcDaiShards[i], amount1);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Add liquidity
    await pool.addLiquidity(amount0, amount1, 0, 0, wallet.address, Math.floor(Date.now() / 1000) + 3600);
    console.log(`✅ Added ${liquidityLevels[i].usdc} USDC + ${liquidityLevels[i].dai} DAI to USDC/DAI shard ${i + 1}`);
  }

  console.log("\n📊 Verifying liquidity in all shards...");
  
  let totalLiquidityUSD = 0;
  
  // Check USDC/USDT shards
  for (let i = 0; i < usdcUsdtShards.length; i++) {
    const pool = SAMMPool.attach(usdcUsdtShards[i]);
    const reserves = await pool.getReserves();
    const reserve0 = ethers.formatUnits(reserves[0], 6);
    const reserve1 = ethers.formatUnits(reserves[1], 6);
    const liquidityValue = parseFloat(reserve0) + parseFloat(reserve1);
    totalLiquidityUSD += liquidityValue;
    console.log(`  USDC/USDT Shard ${i + 1}: ${reserve0} USDC + ${reserve1} USDT (~$${liquidityValue.toLocaleString()})`);
  }
  
  // Check USDC/DAI shards
  for (let i = 0; i < usdcDaiShards.length; i++) {
    const pool = SAMMPool.attach(usdcDaiShards[i]);
    const reserves = await pool.getReserves();
    const reserve0 = ethers.formatUnits(reserves[0], 6);
    const reserve1 = ethers.formatUnits(reserves[1], 18);
    const liquidityValue = parseFloat(reserve0) + parseFloat(reserve1);
    totalLiquidityUSD += liquidityValue;
    console.log(`  USDC/DAI Shard ${i + 1}: ${reserve0} USDC + ${reserve1} DAI (~$${liquidityValue.toLocaleString()})`);
  }
  
  console.log(`\n💎 Total Liquidity Deployed: ~$${totalLiquidityUSD.toLocaleString()}`);

  // Save comprehensive deployment data
  const deploymentData = {
    timestamp: Date.now(),
    network: "Monad Testnet",
    chainId: Number(network.chainId),
    deployer: wallet.address,
    testingAddress: testingAddress,
    factory: factoryAddress,
    tokens: {
      USDC: usdcAddress,
      USDT: usdtAddress,
      DAI: daiAddress
    },
    pools: {
      USDC_USDT: {
        shards: usdcUsdtShards.map((addr, i) => ({ 
          address: addr, 
          index: i,
          liquidityUSDC: liquidityLevels[i].usdc,
          liquidityUSDT: liquidityLevels[i].usdt
        }))
      },
      USDC_DAI: {
        shards: usdcDaiShards.map((addr, i) => ({ 
          address: addr, 
          index: i,
          liquidityUSDC: liquidityLevels[i].usdc,
          liquidityDAI: liquidityLevels[i].dai
        }))
      }
    },
    totalLiquidityUSD: totalLiquidityUSD,
    tokenBalances: {
      deployer: {
        USDC: "100000000",
        USDT: "100000000", 
        DAI: "100000000"
      },
      testingAddress: {
        USDC: "10000000",
        USDT: "10000000",
        DAI: "10000000"
      }
    }
  };

  const deploymentPath = path.join(__dirname, "..", "deployment-data", `monad-production-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));

  console.log("\n🎉 Monad Production Deployment Completed Successfully!");
  console.log("=".repeat(70));
  console.log(`📄 Deployment saved to: ${deploymentPath}`);
  console.log("\n🔗 Production Deployment Summary:");
  console.log(`- Network: Monad Testnet (Chain ID: ${network.chainId})`);
  console.log(`- Factory: ${factoryAddress}`);
  console.log(`- USDC: ${usdcAddress}`);
  console.log(`- USDT: ${usdtAddress}`);
  console.log(`- DAI: ${daiAddress}`);
  console.log(`- Total Shards: ${usdcUsdtShards.length + usdcDaiShards.length} (${usdcUsdtShards.length} per pool)`);
  console.log(`- Total Liquidity: ~$${totalLiquidityUSD.toLocaleString()}`);
  console.log(`- Pools: USDC/USDT, USDC/DAI`);
  console.log(`- Testing Address: ${testingAddress} (10M tokens each)`);
  console.log("✅ Production-scale deployment ready for comprehensive testing!");

  return deploymentData;
}

main()
  .then(() => {
    console.log("\n✅ Production deployment completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Production deployment failed:");
    console.error(error);
    process.exit(1);
  });