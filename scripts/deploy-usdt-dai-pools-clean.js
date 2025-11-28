const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Deploy USDT/DAI pools with 3 shards on Monad Testnet
 * 
 * This script:
 * 1. Uses existing factory and tokens (no new deployments)
 * 2. Creates 3 USDT/DAI shards
 * 3. Initializes each shard with liquidity
 * 4. Saves deployment data
 */
async function main() {
  console.log("🚀 Deploying USDT/DAI Pools with 3 Shards");
  console.log("=".repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log("📋 Deployment Details:");
  console.log(`Network: Monad Testnet`);
  console.log(`Deployer: ${wallet.address}`);
  
  // Check balance
  const balance = await provider.getBalance(wallet.address);
  const balanceEth = ethers.formatEther(balance);
  console.log(`Balance: ${balanceEth} MON`);
  
  if (parseFloat(balanceEth) < 0.1) {
    throw new Error(`❌ Insufficient balance. Need at least 0.1 MON`);
  }

  // Get network info
  const network = await provider.getNetwork();
  console.log(`Chain ID: ${network.chainId}\n`);

  // Load existing deployment to get addresses
  const existingDeploymentPath = path.join(__dirname, "..", "deployment-data", "monad-multi-shard-1764330063991.json");
  const existingDeployment = JSON.parse(fs.readFileSync(existingDeploymentPath, "utf8"));
  
  const factoryAddress = existingDeployment.contracts.factory;
  const usdtAddress = existingDeployment.contracts.tokens.find(t => t.symbol === "USDT").address;
  const daiAddress = existingDeployment.contracts.tokens.find(t => t.symbol === "DAI").address;

  console.log("📍 Using Existing Contracts:");
  console.log(`Factory: ${factoryAddress}`);
  console.log(`USDT: ${usdtAddress}`);
  console.log(`DAI: ${daiAddress}\n`);

  // Get contract instances
  const factory = await ethers.getContractAt("SAMMPoolFactory", factoryAddress, wallet);
  const usdt = await ethers.getContractAt("MockERC20", usdtAddress, wallet);
  const dai = await ethers.getContractAt("MockERC20", daiAddress, wallet);

  // Check token balances
  const usdtBalance = await usdt.balanceOf(wallet.address);
  const daiBalance = await dai.balanceOf(wallet.address);
  console.log("💰 Token Balances:");
  console.log(`USDT: ${ethers.formatUnits(usdtBalance, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiBalance, 18)}\n`);

  // Create 3 USDT/DAI shards
  console.log("🏊 Creating 3 USDT/DAI Shards...");
  const usdtDaiShards = [];
  
  for (let i = 0; i < 3; i++) {
    console.log(`\nCreating shard ${i + 1}...`);
    
    const tx = await factory.createShardDefault(usdtAddress, daiAddress);
    console.log(`Transaction sent: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    
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
      const shardAddress = parsed.args[0];
      usdtDaiShards.push(shardAddress);
      console.log(`✅ Shard ${i + 1} created at: ${shardAddress}`);
    } else {
      throw new Error(`Failed to find ShardCreated event for shard ${i + 1}`);
    }
    
    // Wait between shard creations
    if (i < 2) {
      console.log("Waiting 2 seconds before next shard...");
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log("\n💧 Adding Liquidity to All Shards...");
  
  // Liquidity amounts for each shard (USDT has 6 decimals, DAI has 18)
  const liquidityAmounts = [
    { usdt: "100", dai: "100" },     // Shard 1: 100 each
    { usdt: "500", dai: "500" },     // Shard 2: 500 each
    { usdt: "1000", dai: "1000" }    // Shard 3: 1000 each
  ];
  
  for (let i = 0; i < usdtDaiShards.length; i++) {
    console.log(`\n💧 Adding liquidity to shard ${i + 1}...`);
    
    const pool = await ethers.getContractAt("SAMMPool", usdtDaiShards[i], wallet);
    const usdtAmount = ethers.parseUnits(liquidityAmounts[i].usdt, 6);
    const daiAmount = ethers.parseUnits(liquidityAmounts[i].dai, 18);
    
    console.log(`Amounts: ${liquidityAmounts[i].usdt} USDT + ${liquidityAmounts[i].dai} DAI`);
    
    // Approve USDT
    console.log("Approving USDT...");
    const approveTx1 = await usdt.approve(usdtDaiShards[i], usdtAmount);
    await approveTx1.wait();
    console.log("✅ USDT approved");
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Approve DAI
    console.log("Approving DAI...");
    const approveTx2 = await dai.approve(usdtDaiShards[i], daiAmount);
    await approveTx2.wait();
    console.log("✅ DAI approved");
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Add liquidity
    console.log("Adding liquidity...");
    const addLiqTx = await pool.addLiquidity(
      usdtAmount,
      daiAmount,
      0, // amountAMin
      0, // amountBMin
      wallet.address
    );
    const addLiqReceipt = await addLiqTx.wait();
    console.log(`✅ Liquidity added in block ${addLiqReceipt.blockNumber}`);
    
    // Verify reserves
    const reserves = await pool.getReserves();
    console.log(`Reserves: ${ethers.formatUnits(reserves[0], 6)} USDT, ${ethers.formatUnits(reserves[1], 18)} DAI`);
    
    if (i < 2) {
      console.log("Waiting 3 seconds before next shard...");
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Save deployment data
  const deploymentData = {
    network: "Monad Testnet",
    chainId: Number(network.chainId),
    timestamp: new Date().toISOString(),
    deployer: wallet.address,
    feature: "USDT/DAI pools with 3 shards",
    contracts: {
      factory: factoryAddress,
      tokens: [
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
        {
          name: "USDT/DAI-1",
          pairName: "USDT/DAI",
          address: usdtDaiShards[0],
          tokenA: usdtAddress,
          tokenB: daiAddress,
          liquidity: "100.0"
        },
        {
          name: "USDT/DAI-2",
          pairName: "USDT/DAI",
          address: usdtDaiShards[1],
          tokenA: usdtAddress,
          tokenB: daiAddress,
          liquidity: "500.0"
        },
        {
          name: "USDT/DAI-3",
          pairName: "USDT/DAI",
          address: usdtDaiShards[2],
          tokenA: usdtAddress,
          tokenB: daiAddress,
          liquidity: "1000.0"
        }
      ]
    },
    stats: {
      totalShards: 3,
      totalLiquidity: "1600.0"
    }
  };

  const deploymentPath = path.join(__dirname, "..", "deployment-data", `usdt-dai-pools-${Date.now()}.json`);
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));

  console.log("\n🎉 USDT/DAI Pools Deployment Completed!");
  console.log("=".repeat(60));
  console.log(`📄 Deployment saved to: ${deploymentPath}`);
  console.log("\n🔗 Summary:");
  console.log(`- Network: Monad Testnet (Chain ID: ${network.chainId})`);
  console.log(`- Factory: ${factoryAddress}`);
  console.log(`- USDT: ${usdtAddress}`);
  console.log(`- DAI: ${daiAddress}`);
  console.log(`- Total Shards: 3`);
  console.log("\n📊 Shards:");
  usdtDaiShards.forEach((shard, i) => {
    console.log(`  ${i + 1}. ${shard} (${liquidityAmounts[i].usdt} USDT + ${liquidityAmounts[i].dai} DAI)`);
  });
  console.log("\n✅ All shards created and initialized successfully!");

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
