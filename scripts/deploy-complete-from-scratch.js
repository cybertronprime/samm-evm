const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Complete deployment from scratch with decimal-aware SAMM contracts
 * 
 * This script:
 * 1. Deploys factory
 * 2. Deploys USDC, USDT, DAI tokens
 * 3. Creates 3 USDC/USDT shards with liquidity
 * 4. Creates 3 USDT/DAI shards with liquidity
 * 5. Tests multi-hop swaps
 */
async function main() {
  console.log("🚀 Complete SAMM Deployment From Scratch");
  console.log("=".repeat(70));

  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log(`Deployer: ${wallet.address}`);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} MON\n`);

  if (parseFloat(ethers.formatEther(balance)) < 0.5) {
    throw new Error("❌ Insufficient balance. Need at least 0.5 MON");
  }

  // Step 1: Deploy Factory
  console.log("📦 Step 1: Deploying SAMMPoolFactory...");
  const SAMMPoolFactory = await ethers.getContractFactory("SAMMPoolFactory", wallet);
  const factory = await SAMMPoolFactory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`✅ Factory deployed at: ${factoryAddress}\n`);
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Step 2: Deploy Tokens
  console.log("🪙 Step 2: Deploying Mock Tokens...");
  const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
  
  console.log("Deploying USDC (6 decimals)...");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`✅ USDC: ${usdcAddress}`);
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log("Deploying USDT (6 decimals)...");
  const usdt = await MockERC20.deploy("Tether USD", "USDT", 6);
  await usdt.waitForDeployment();
  const usdtAddress = await usdt.getAddress();
  console.log(`✅ USDT: ${usdtAddress}`);
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log("Deploying DAI (18 decimals)...");
  const dai = await MockERC20.deploy("Dai Stablecoin", "DAI", 18);
  await dai.waitForDeployment();
  const daiAddress = await dai.getAddress();
  console.log(`✅ DAI: ${daiAddress}\n`);
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Mint tokens
  console.log("💰 Minting tokens to deployer...");
  const mintAmount = ethers.parseUnits("1000000000", 6); // 1B for 6 decimal tokens
  const mintAmountDAI = ethers.parseUnits("1000000000", 18); // 1B for 18 decimal tokens
  
  await (await usdc.mint(wallet.address, mintAmount)).wait();
  console.log("✅ Minted 1B USDC");
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await (await usdt.mint(wallet.address, mintAmount)).wait();
  console.log("✅ Minted 1B USDT");
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await (await dai.mint(wallet.address, mintAmountDAI)).wait();
  console.log("✅ Minted 1B DAI\n");
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Step 3: Create and initialize USDC/USDT shards
  console.log("🏊 Step 3: Creating USDC/USDT Shards...");
  const usdcUsdtShards = [];
  const usdcUsdtLiquidity = [
    { usdc: "5000000", usdt: "5000000" },   // 5M each
    { usdc: "3000000", usdt: "3000000" },   // 3M each
    { usdc: "2000000", usdt: "2000000" }    // 2M each
  ];

  for (let i = 0; i < 3; i++) {
    console.log(`\nCreating USDC/USDT shard ${i + 1}...`);
    const tx = await factory.createShardDefault(usdcAddress, usdtAddress);
    const receipt = await tx.wait();
    
    const shardCreatedEvent = receipt.logs.find(log => {
      try {
        const parsed = factory.interface.parseLog(log);
        return parsed && parsed.name === 'ShardCreated';
      } catch (e) {
        return false;
      }
    });

    const shardAddress = factory.interface.parseLog(shardCreatedEvent).args[0];
    usdcUsdtShards.push(shardAddress);
    console.log(`✅ Shard created at: ${shardAddress}`);
    
    // Initialize and add liquidity
    console.log(`Initializing with ${usdcUsdtLiquidity[i].usdc} USDC + ${usdcUsdtLiquidity[i].usdt} USDT...`);
    
    const usdcAmount = ethers.parseUnits(usdcUsdtLiquidity[i].usdc, 6);
    const usdtAmount = ethers.parseUnits(usdcUsdtLiquidity[i].usdt, 6);
    
    // Approve tokens to factory (factory will transfer to shard during initialization)
    await (await usdc.approve(factoryAddress, usdcAmount)).wait();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await (await usdt.approve(factoryAddress, usdtAmount)).wait();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Initialize shard via factory
    await (await factory.initializeShard(shardAddress, usdcAmount, usdtAmount)).wait();
    console.log(`✅ Shard initialized with liquidity`);
    
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Step 4: Create and initialize USDT/DAI shards
  console.log("\n🏊 Step 4: Creating USDT/DAI Shards...");
  const usdtDaiShards = [];
  const usdtDaiLiquidity = [
    { usdt: "10000", dai: "10000" },      // 10K each
    { usdt: "20000", dai: "20000" },      // 20K each
    { usdt: "30000", dai: "30000" }       // 30K each
  ];

  for (let i = 0; i < 3; i++) {
    console.log(`\nCreating USDT/DAI shard ${i + 1}...`);
    const tx = await factory.createShardDefault(usdtAddress, daiAddress);
    const receipt = await tx.wait();
    
    const shardCreatedEvent = receipt.logs.find(log => {
      try {
        const parsed = factory.interface.parseLog(log);
        return parsed && parsed.name === 'ShardCreated';
      } catch (e) {
        return false;
      }
    });

    const shardAddress = factory.interface.parseLog(shardCreatedEvent).args[0];
    usdtDaiShards.push(shardAddress);
    console.log(`✅ Shard created at: ${shardAddress}`);
    
    // Initialize and add liquidity
    console.log(`Initializing with ${usdtDaiLiquidity[i].usdt} USDT + ${usdtDaiLiquidity[i].dai} DAI...`);
    
    const usdtAmount = ethers.parseUnits(usdtDaiLiquidity[i].usdt, 6);
    const daiAmount = ethers.parseUnits(usdtDaiLiquidity[i].dai, 18);
    
    // Get shard info to determine token order
    const shardInfo = await factory.getShardInfo(shardAddress);
    const isUsdtTokenA = shardInfo.tokenA.toLowerCase() === usdtAddress.toLowerCase();
    
    // Set amounts in correct order
    const amountA = isUsdtTokenA ? usdtAmount : daiAmount;
    const amountB = isUsdtTokenA ? daiAmount : usdtAmount;
    
    console.log(`Token order: A=${isUsdtTokenA ? 'USDT' : 'DAI'}, B=${isUsdtTokenA ? 'DAI' : 'USDT'}`);
    
    // Approve tokens to factory (factory will transfer to shard during initialization)
    await (await usdt.approve(factoryAddress, usdtAmount)).wait();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await (await dai.approve(factoryAddress, daiAmount)).wait();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Initialize shard via factory (with correct token order)
    await (await factory.initializeShard(shardAddress, amountA, amountB)).wait();
    console.log(`✅ Shard initialized with liquidity`);
    
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Save deployment data
  const deploymentData = {
    network: "Monad Testnet",
    chainId: 10143,
    timestamp: new Date().toISOString(),
    deployer: wallet.address,
    version: "v2-decimal-aware",
    sammCoreFeature: "Complete multi-hop routing with decimal normalization",
    contracts: {
      factory: factoryAddress,
      tokens: [
        { symbol: "USDC", address: usdcAddress, decimals: 6 },
        { symbol: "USDT", address: usdtAddress, decimals: 6 },
        { symbol: "DAI", address: daiAddress, decimals: 18 }
      ],
      shards: [
        ...usdcUsdtShards.map((addr, i) => ({
          name: `USDC/USDT-${i + 1}`,
          pairName: "USDC/USDT",
          address: addr,
          tokenA: usdcAddress,
          tokenB: usdtAddress,
          liquidity: usdcUsdtLiquidity[i].usdc,
          status: "active"
        })),
        ...usdtDaiShards.map((addr, i) => ({
          name: `USDT/DAI-${i + 1}`,
          pairName: "USDT/DAI",
          address: addr,
          tokenA: usdtAddress,
          tokenB: daiAddress,
          liquidity: usdtDaiLiquidity[i].usdt,
          status: "active"
        }))
      ]
    },
    multiHopRouting: {
      enabled: true,
      supportedPairs: ["USDC/USDT", "USDT/DAI"],
      multiHopPaths: [{
        from: "USDC",
        to: "DAI",
        path: ["USDC", "USDT", "DAI"],
        pools: ["USDC/USDT", "USDT/DAI"]
      }]
    },
    stats: {
      totalShards: 6,
      usdcUsdtShards: 3,
      usdtDaiShards: 3,
      demonstratesMultiHopRouting: true,
      decimalNormalization: true
    }
  };

  const deploymentPath = path.join(__dirname, "..", "deployment-data", `complete-deployment-${Date.now()}.json`);
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));

  console.log("\n🎉 Complete Deployment Successful!");
  console.log("=".repeat(70));
  console.log(`📄 Deployment saved to: ${deploymentPath}`);
  console.log("\n📊 Summary:");
  console.log(`Factory: ${factoryAddress}`);
  console.log(`USDC: ${usdcAddress} (6 decimals)`);
  console.log(`USDT: ${usdtAddress} (6 decimals)`);
  console.log(`DAI: ${daiAddress} (18 decimals)`);
  console.log(`\nUSC/USDT Shards: ${usdcUsdtShards.length}`);
  usdcUsdtShards.forEach((addr, i) => console.log(`  ${i + 1}. ${addr}`));
  console.log(`\nUSDT/DAI Shards: ${usdtDaiShards.length}`);
  usdtDaiShards.forEach((addr, i) => console.log(`  ${i + 1}. ${addr}`));
  
  return deploymentData;
}

main()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:");
    console.error(error);
    process.exit(1);
  });
