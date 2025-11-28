const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Starting SAMM EVM Deployment to Monad Testnet");
  console.log("=".repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet("9387e097a14f64f865d10cc50835d3b16c3683f2e2cebd518b2456260f1e59ad", provider);

  console.log("📋 Deployment Details:");
  console.log(`Network: Monad Testnet (Chain ID: 10143)`);
  console.log(`Deployer: ${wallet.address}`);
  
  // Check balance
  const balance = await provider.getBalance(wallet.address);
  const balanceEth = ethers.formatEther(balance);
  console.log(`Current Balance: ${balanceEth} MON`);
  
  if (parseFloat(balanceEth) < 0.5) {
    throw new Error(`❌ Insufficient balance. Need at least 0.5 MON`);
  }
  console.log("✅ Balance sufficient for deployment");

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

  console.log("\n🪙 Deploying mock tokens...");
  
  // Deploy tokens with proper nonce management
  const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
  
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`✅ USDC deployed at: ${usdcAddress}`);
  
  const usdt = await MockERC20.deploy("Tether USD", "USDT", 6);
  await usdt.waitForDeployment();
  const usdtAddress = await usdt.getAddress();
  console.log(`✅ USDT deployed at: ${usdtAddress}`);
  
  const dai = await MockERC20.deploy("Dai Stablecoin", "DAI", 18);
  await dai.waitForDeployment();
  const daiAddress = await dai.getAddress();
  console.log(`✅ DAI deployed at: ${daiAddress}`);

  console.log("\n💰 Minting tokens to deployer...");
  
  // Mint tokens with delays to avoid nonce issues
  await usdc.mint(wallet.address, ethers.parseUnits("1000000", 6));
  console.log("✅ Minted 1000000 USDC to deployer");
  
  await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
  
  await usdt.mint(wallet.address, ethers.parseUnits("1000000", 6));
  console.log("✅ Minted 1000000 USDT to deployer");
  
  await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
  
  await dai.mint(wallet.address, ethers.parseUnits("1000000", 18));
  console.log("✅ Minted 1000000 DAI to deployer");

  console.log("\n🏊 Creating and initializing pools...");
  
  // Create USDC/USDT pool with 3 shards (matching RiseChain structure)
  console.log("📊 Creating USDC/USDT pool with 3 shards...");
  const usdcUsdtShards = [];
  
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between shards
    
    const tx = await factory.createShardDefault(usdcAddress, usdtAddress);
    const receipt = await tx.wait();
    
    // Find the ShardCreated event
    const shardCreatedEvent = receipt.logs.find(log => {
      try {
        const parsed = factory.interface.parseLog(log);
        return parsed && parsed.name === 'ShardCreated';
      } catch (e) {
        return false;
      }
    });
    
    if (shardCreatedEvent) {
      const parsed = factory.interface.parseLog(shardCreatedEvent);
      const shardAddress = parsed.args[0]; // Shard address
      usdcUsdtShards.push(shardAddress);
      console.log(`✅ Shard ${i} created at: ${shardAddress}`);
    }
  }
  
  // Create USDC/DAI pool with 2 shards (matching RiseChain structure)
  console.log("📊 Creating USDC/DAI pool with 2 shards...");
  const usdcDaiShards = [];
  
  for (let i = 0; i < 2; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between shards
    
    const tx = await factory.createShardDefault(usdcAddress, daiAddress);
    const receipt = await tx.wait();
    
    // Find the ShardCreated event
    const shardCreatedEvent = receipt.logs.find(log => {
      try {
        const parsed = factory.interface.parseLog(log);
        return parsed && parsed.name === 'ShardCreated';
      } catch (e) {
        return false;
      }
    });
    
    if (shardCreatedEvent) {
      const parsed = factory.interface.parseLog(shardCreatedEvent);
      const shardAddress = parsed.args[0]; // Shard address
      usdcDaiShards.push(shardAddress);
      console.log(`✅ Shard ${i} created at: ${shardAddress}`);
    }
  }

  console.log("\n💧 Adding initial liquidity to all shards...");
  
  const SAMMPool = await ethers.getContractFactory("SAMMPool");
  
  // Add liquidity to USDC/USDT shards with different amounts (matching RiseChain structure)
  const usdcUsdtLiquidityAmounts = [
    { usdc: "100", usdt: "100" },   // Shard 1: 100 each
    { usdc: "500", usdt: "500" },   // Shard 2: 500 each  
    { usdc: "1000", usdt: "1000" }  // Shard 3: 1000 each
  ];
  
  for (let i = 0; i < usdcUsdtShards.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay
    
    const pool = SAMMPool.attach(usdcUsdtShards[i]);
    const amount0 = ethers.parseUnits(usdcUsdtLiquidityAmounts[i].usdc, 6);
    const amount1 = ethers.parseUnits(usdcUsdtLiquidityAmounts[i].usdt, 6);
    
    // Approve tokens with longer delays
    await usdc.approve(usdcUsdtShards[i], amount0);
    await new Promise(resolve => setTimeout(resolve, 2000));
    await usdt.approve(usdcUsdtShards[i], amount1);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Add liquidity
    await pool.addLiquidity(amount0, amount1, 0, 0, wallet.address, Math.floor(Date.now() / 1000) + 3600);
    console.log(`✅ Added liquidity to USDC/USDT shard ${i + 1}: ${usdcUsdtLiquidityAmounts[i].usdc} USDC + ${usdcUsdtLiquidityAmounts[i].usdt} USDT`);
  }
  
  // Add liquidity to USDC/DAI shards with different amounts (matching RiseChain structure)
  const usdcDaiLiquidityAmounts = [
    { usdc: "200", dai: "200" },   // Shard 1: 200 each
    { usdc: "800", dai: "800" }    // Shard 2: 800 each
  ];
  
  for (let i = 0; i < usdcDaiShards.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay
    
    const pool = SAMMPool.attach(usdcDaiShards[i]);
    const amount0 = ethers.parseUnits(usdcDaiLiquidityAmounts[i].usdc, 6);
    const amount1 = ethers.parseUnits(usdcDaiLiquidityAmounts[i].dai, 18);
    
    // Approve tokens with longer delays
    await usdc.approve(usdcDaiShards[i], amount0);
    await new Promise(resolve => setTimeout(resolve, 2000));
    await dai.approve(usdcDaiShards[i], amount1);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Add liquidity
    await pool.addLiquidity(amount0, amount1, 0, 0, wallet.address, Math.floor(Date.now() / 1000) + 3600);
    console.log(`✅ Added liquidity to USDC/DAI shard ${i + 1}: ${usdcDaiLiquidityAmounts[i].usdc} USDC + ${usdcDaiLiquidityAmounts[i].dai} DAI`);
  }

  // Save deployment data (matching RiseChain structure)
  const deploymentData = {
    network: "Monad Testnet",
    chainId: Number(network.chainId),
    timestamp: new Date().toISOString(),
    deployer: wallet.address,
    sammCoreFeature: "Multiple shards per token pair",
    contracts: {
      factory: factoryAddress,
      tokens: [
        {
          symbol: "USDC",
          address: usdcAddress
        },
        {
          symbol: "USDT", 
          address: usdtAddress
        },
        {
          symbol: "DAI",
          address: daiAddress
        }
      ],
      shards: [
        // USDC/USDT shards
        {
          name: "USDC/USDT-1",
          pairName: "USDC/USDT",
          address: usdcUsdtShards[0],
          tokenA: usdcAddress,
          tokenB: usdtAddress,
          liquidity: "100.0"
        },
        {
          name: "USDC/USDT-2", 
          pairName: "USDC/USDT",
          address: usdcUsdtShards[1],
          tokenA: usdcAddress,
          tokenB: usdtAddress,
          liquidity: "500.0"
        },
        {
          name: "USDC/USDT-3",
          pairName: "USDC/USDT", 
          address: usdcUsdtShards[2],
          tokenA: usdcAddress,
          tokenB: usdtAddress,
          liquidity: "1000.0"
        },
        // USDC/DAI shards
        {
          name: "USDC/DAI-1",
          pairName: "USDC/DAI",
          address: usdcDaiShards[0],
          tokenA: usdcAddress,
          tokenB: daiAddress,
          liquidity: "200.0"
        },
        {
          name: "USDC/DAI-2",
          pairName: "USDC/DAI",
          address: usdcDaiShards[1], 
          tokenA: usdcAddress,
          tokenB: daiAddress,
          liquidity: "800.0"
        }
      ]
    },
    multiShardStats: {
      totalShards: 5,
      usdcUsdtShards: 3,
      usdcDaiShards: 2,
      demonstratesMultiShardArchitecture: true
    }
  };

  const deploymentPath = path.join(__dirname, "..", "deployment-data", `monad-multi-shard-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));

  console.log("\n🎉 Monad testnet deployment completed successfully!");
  console.log(`📄 Deployment saved to: ${deploymentPath}`);
  console.log("\n🔗 Deployment Summary:");
  console.log(`- Network: Monad Testnet (Chain ID: ${network.chainId})`);
  console.log(`- Factory: ${factoryAddress}`);
  console.log(`- USDC: ${usdcAddress}`);
  console.log(`- USDT: ${usdtAddress}`);
  console.log(`- DAI: ${daiAddress}`);
  console.log(`- Total Shards: ${usdcUsdtShards.length + usdcDaiShards.length} (${usdcUsdtShards.length} USDC/USDT + ${usdcDaiShards.length} USDC/DAI)`);
  console.log(`- Pools: USDC/USDT (3 shards), USDC/DAI (2 shards)`);
  console.log("✅ All contracts deployed and initialized successfully!");

  return deploymentData;
}

main()
  .then(() => {
    console.log("\n✅ Deployment completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });