const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { 
  createProvider, 
  validateDeployerBalance, 
  getDeploymentParams,
  getChainConfig 
} = require("../config/deployment-config");

async function main() {
  console.log("🚀 Starting SAMM EVM Deployment to Monad Testnet");
  console.log("=".repeat(60));

  const networkName = "monad";
  const { provider, wallet, config } = createProvider(networkName);
  const deploymentParams = getDeploymentParams(networkName);

  console.log("📋 Deployment Details:");
  console.log(`Network: ${config.name} (Chain ID: ${config.chainId})`);
  console.log(`Deployer: ${wallet.address}`);
  
  // Validate balance before deployment
  console.log("\n💳 Validating deployer balance...");
  const balanceCheck = await validateDeployerBalance(provider, wallet.address, networkName);
  
  console.log(`Current Balance: ${balanceCheck.balanceEth} ${balanceCheck.nativeTokenSymbol}`);
  console.log(`Required Balance: ${balanceCheck.minRequiredEth} ${balanceCheck.nativeTokenSymbol}`);
  
  if (!balanceCheck.isValid) {
    throw new Error(`❌ Insufficient balance. Need ${balanceCheck.shortfallEth} more ${balanceCheck.nativeTokenSymbol}`);
  }
  console.log("✅ Balance sufficient for deployment");

  // Get network info
  const network = await provider.getNetwork();
  console.log(`\n🌐 Connected to ${config.name}`);
  console.log(`Chain ID: ${network.chainId}`);

  console.log("\n🔧 Deploying Contracts...");

  // Deploy SAMM Pool Factory
  console.log("\n1️⃣ Deploying SAMM Pool Factory...");
  const SAMMPoolFactory = await ethers.getContractFactory("SAMMPoolFactory", wallet);
  
  const factoryTx = await SAMMPoolFactory.deploy({
    gasLimit: deploymentParams.gasSettings.gasLimit,
    maxFeePerGas: deploymentParams.gasSettings.maxFeePerGas,
    maxPriorityFeePerGas: deploymentParams.gasSettings.maxPriorityFeePerGas
  });
  
  console.log(`⏳ Factory deployment transaction: ${factoryTx.deploymentTransaction().hash}`);
  const factory = await factoryTx.waitForDeployment();
  await factory.deploymentTransaction().wait(deploymentParams.confirmations);
  
  console.log(`✅ SAMM Factory deployed: ${await factory.getAddress()}`);

  // Deploy test tokens and create multiple shards
  console.log("\n2️⃣ Deploying test tokens and creating multiple shards...");
  
  const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
  
  console.log("Deploying test tokens...");
  const tokenA = await MockERC20.deploy("Monad Test Token A", "MTESTA", 18, {
    gasLimit: deploymentParams.gasSettings.gasLimit
  });
  await tokenA.waitForDeployment();
  
  const tokenB = await MockERC20.deploy("Monad Test Token B", "MTESTB", 18, {
    gasLimit: deploymentParams.gasSettings.gasLimit
  });
  await tokenB.waitForDeployment();
  
  const tokenAAddress = await tokenA.getAddress();
  const tokenBAddress = await tokenB.getAddress();
  
  console.log(`Test Token A: ${tokenAAddress}`);
  console.log(`Test Token B: ${tokenBAddress}`);

  // Create multiple shards for proper SAMM testing
  console.log("\n3️⃣ Creating multiple shards for comprehensive testing...");
  
  const shardAddresses = [];
  const shardNames = ["Initial Shard"];
  
  // Create first shard
  const createTx = await factory.createShardDefault(tokenAAddress, tokenBAddress, {
    gasLimit: deploymentParams.gasSettings.gasLimit
  });
  const receipt = await createTx.wait(deploymentParams.confirmations);
  
  const shardCreatedEvent = receipt.logs.find(
    log => log.fragment && log.fragment.name === "ShardCreated"
  );
  const shardAddress = shardCreatedEvent.args[0];
  shardAddresses.push(shardAddress);
  console.log(`✅ Initial Shard created: ${shardAddress}`);

  // Create 3 more shards (total of 4 shards)
  for (let i = 1; i < 4; i++) {
    console.log(`Creating shard ${i + 1}...`);
    const createTx = await factory.createShardDefault(tokenAAddress, tokenBAddress, {
      gasLimit: deploymentParams.gasSettings.gasLimit
    });
    
    const receipt = await createTx.wait(deploymentParams.confirmations);
    const shardCreatedEvent = receipt.logs.find(
      log => log.fragment && log.fragment.name === "ShardCreated"
    );
    
    const newShardAddress = shardCreatedEvent.args[0];
    shardAddresses.push(newShardAddress);
    shardNames.push(`Shard ${i + 1}`);
    console.log(`✅ Shard ${i + 1} created: ${newShardAddress}`);
  }
  
  console.log(`✅ Created ${shardAddresses.length} shards total`);
  
  // Initialize all shards with different liquidity amounts
  console.log("\n4️⃣ Initializing shards with different liquidity levels...");
  
  // Mint tokens to deployer
  const mintAmount = ethers.parseEther("1000000");
  console.log("Minting test tokens...");
  await tokenA.mint(wallet.address, mintAmount);
  await tokenB.mint(wallet.address, mintAmount);
  
  const liquidityAmounts = [
    ethers.parseEther("5000"),   // Smallest shard
    ethers.parseEther("10000"),  // Medium shard 1
    ethers.parseEther("15000"),  // Medium shard 2  
    ethers.parseEther("20000")   // Largest shard
  ];
  
  const SAMMPoolContract = await ethers.getContractFactory("SAMMPool");
  const initializedShards = [];
  
  for (let i = 0; i < shardAddresses.length; i++) {
    console.log(`Initializing ${shardNames[i]} with ${ethers.formatEther(liquidityAmounts[i])} tokens each...`);
    
    const shardContract = SAMMPoolContract.attach(shardAddresses[i]);
    
    // Approve tokens for shard
    await tokenA.approve(shardAddresses[i], mintAmount);
    await tokenB.approve(shardAddresses[i], mintAmount);
    
    // Initialize the shard with default fee parameters
    const initTx = await shardContract.initialize(
      tokenAAddress,
      tokenBAddress,
      liquidityAmounts[i],
      liquidityAmounts[i],
      25,    // tradeFeeNumerator (0.25%)
      10000, // tradeFeeDenominator
      10,    // ownerFeeNumerator (0.1%)
      10000, // ownerFeeDenominator
      {
        gasLimit: deploymentParams.gasSettings.gasLimit
      }
    );
    await initTx.wait(deploymentParams.confirmations);
    
    initializedShards.push({
      address: shardAddresses[i],
      name: shardNames[i],
      liquidityA: liquidityAmounts[i],
      liquidityB: liquidityAmounts[i],
      contract: shardContract
    });
    
    console.log(`✅ ${shardNames[i]} initialized`);
  }
  
  console.log(`✅ All ${initializedShards.length} shards initialized with varying liquidity levels`);

  // Now verify SAMM parameters on all shards
  console.log("\n5️⃣ Verifying SAMM parameters on all shards...");
  
  let verifiedParams = null;
  for (let i = 0; i < initializedShards.length; i++) {
    const shard = initializedShards[i];
    console.log(`Checking ${shard.name}...`);
    
    const [beta1, rmin, rmax, c] = await shard.contract.getSAMMParams();
    const sammParams = {
      beta1: Number(beta1),
      rmin: Number(rmin),
      rmax: Number(rmax),
      c: Number(c)
    };
    
    // Store the first verified params for deployment info
    if (!verifiedParams) {
      verifiedParams = sammParams;
    }
    
    // Verify parameters match expected values
    const paramsMatch = 
      sammParams.beta1 === deploymentParams.sammParameters.beta1 &&
      sammParams.rmin === deploymentParams.sammParameters.rmin &&
      sammParams.rmax === deploymentParams.sammParameters.rmax &&
      sammParams.c === deploymentParams.sammParameters.c;

    if (!paramsMatch) {
      throw new Error(`❌ SAMM parameters do not match expected values on ${shard.name}`);
    }
    
    console.log(`✅ ${shard.name}: β1=${sammParams.beta1}, rmin=${sammParams.rmin}, rmax=${sammParams.rmax}, c=${sammParams.c}`);
  }
  
  console.log("✅ All SAMM parameters verified successfully on all shards");

  // Save deployment info
  const deploymentInfo = {
    network: config.name,
    networkName: networkName,
    chainId: Number(network.chainId),
    deployer: wallet.address,
    timestamp: new Date().toISOString(),
    contracts: {
      factory: await factory.getAddress(),
      testTokenA: await tokenA.getAddress(),
      testTokenB: await tokenB.getAddress(),
      testShard: shardAddresses[0] // Use first shard address
    },
    shards: initializedShards.map(shard => ({
      address: shard.address,
      name: shard.name,
      liquidityA: shard.liquidityA.toString(),
      liquidityB: shard.liquidityB.toString()
    })),
    sammParameters: verifiedParams,
    gasUsed: {
      factory: factoryTx.deploymentTransaction().gasLimit,
      tokenA: tokenA.deploymentTransaction().gasLimit,
      tokenB: tokenB.deploymentTransaction().gasLimit,
      shardCreation: createTx.gasLimit
    },
    balanceInfo: {
      initialBalance: balanceCheck.balanceEth,
      minRequired: balanceCheck.minRequiredEth,
      nativeToken: balanceCheck.nativeTokenSymbol
    }
  };

  const deploymentPath = path.join(__dirname, "..", "deployments", `monad-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));

  console.log("\n🎉 Monad Testnet Deployment Complete!");
  console.log("=".repeat(60));
  console.log(`📄 Deployment info saved to: ${deploymentPath}`);
  console.log("\n📋 Contract Addresses:");
  console.log(`Factory: ${await factory.getAddress()}`);
  console.log(`Test Token A: ${await tokenA.getAddress()}`);
  console.log(`Test Token B: ${await tokenB.getAddress()}`);
  console.log(`Shards Created: ${shardAddresses.length}`);
  shardAddresses.forEach((addr, i) => {
    console.log(`  Shard ${i + 1}: ${addr}`);
  });
  
  if (config.blockExplorer) {
    console.log("\n🔗 Block Explorer Links:");
    console.log(`Factory: ${config.blockExplorer}/address/${await factory.getAddress()}`);
    console.log(`First Shard: ${config.blockExplorer}/address/${shardAddresses[0]}`);
  }

  return deploymentInfo;
}

main()
  .then((deploymentInfo) => {
    console.log("\n✅ Monad testnet deployment script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Monad testnet deployment failed:");
    console.error(error);
    process.exit(1);
  });