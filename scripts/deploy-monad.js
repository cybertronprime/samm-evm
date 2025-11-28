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

  // Verify SAMM parameters are correctly set
  console.log("\n2️⃣ Verifying SAMM Parameters...");
  
  // Create a test shard to verify parameters
  console.log("Creating test shard for parameter verification...");
  
  // For Monad, we'll need to use actual token addresses or deploy test tokens
  // For now, let's deploy minimal test tokens
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
  
  console.log(`Test Token A: ${await tokenA.getAddress()}`);
  console.log(`Test Token B: ${await tokenB.getAddress()}`);

  // Create test shard
  const createTx = await factory.createShardDefault(
    await tokenA.getAddress(),
    await tokenB.getAddress(),
    {
      gasLimit: deploymentParams.gasSettings.gasLimit
    }
  );
  const receipt = await createTx.wait(deploymentParams.confirmations);
  
  // Extract shard address from events
  const shardCreatedEvent = receipt.logs.find(
    log => log.fragment && log.fragment.name === "ShardCreated"
  );
  const shardAddress = shardCreatedEvent.args[0];
  console.log(`✅ Test Shard created: ${shardAddress}`);

  // Verify SAMM parameters
  const SAMMPool = await ethers.getContractFactory("SAMMPool");
  const shard = SAMMPool.attach(shardAddress);
  
  const [beta1, rmin, rmax, c] = await shard.getSAMMParams();
  console.log(`✅ SAMM Parameters Verified:`);
  console.log(`   β1: ${beta1} (expected: ${deploymentParams.sammParameters.beta1})`);
  console.log(`   rmin: ${rmin} (expected: ${deploymentParams.sammParameters.rmin})`);
  console.log(`   rmax: ${rmax} (expected: ${deploymentParams.sammParameters.rmax})`);
  console.log(`   c: ${c} (expected: ${deploymentParams.sammParameters.c})`);

  // Verify parameters match expected values
  const paramsMatch = 
    Number(beta1) === deploymentParams.sammParameters.beta1 &&
    Number(rmin) === deploymentParams.sammParameters.rmin &&
    Number(rmax) === deploymentParams.sammParameters.rmax &&
    Number(c) === deploymentParams.sammParameters.c;

  if (!paramsMatch) {
    throw new Error("❌ SAMM parameters do not match expected values");
  }

  console.log("✅ All SAMM parameters verified successfully");

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
      testShard: shardAddress
    },
    sammParameters: {
      beta1: Number(beta1),
      rmin: Number(rmin),
      rmax: Number(rmax),
      c: Number(c)
    },
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
  console.log(`Test Shard: ${shardAddress}`);
  
  if (config.blockExplorer) {
    console.log("\n🔗 Block Explorer Links:");
    console.log(`Factory: ${config.blockExplorer}/address/${await factory.getAddress()}`);
    console.log(`Test Shard: ${config.blockExplorer}/address/${shardAddress}`);
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