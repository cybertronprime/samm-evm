const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Starting SAMM EVM Deployment to Sepolia Testnet");
  console.log("=" .repeat(60));

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  
  console.log("📋 Deployment Details:");
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  
  if (balance < ethers.parseEther("0.1")) {
    throw new Error("❌ Insufficient ETH balance. Need at least 0.1 ETH for deployment.");
  }

  console.log("\n🔧 Deploying Contracts...");

  // Deploy Mock Tokens for testing
  console.log("\n1️⃣ Deploying Mock Tokens...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  
  const tokenA = await MockERC20.deploy("Test Token A", "TESTA", 18);
  await tokenA.waitForDeployment();
  console.log(`✅ Token A deployed: ${await tokenA.getAddress()}`);
  
  const tokenB = await MockERC20.deploy("Test Token B", "TESTB", 18);
  await tokenB.waitForDeployment();
  console.log(`✅ Token B deployed: ${await tokenB.getAddress()}`);

  // Deploy SAMM Pool Factory
  console.log("\n2️⃣ Deploying SAMM Pool Factory...");
  const SAMMPoolFactory = await ethers.getContractFactory("SAMMPoolFactory");
  const factory = await SAMMPoolFactory.deploy();
  await factory.waitForDeployment();
  console.log(`✅ SAMM Factory deployed: ${await factory.getAddress()}`);

  // Create a test shard
  console.log("\n3️⃣ Creating Test Shard...");
  const createTx = await factory.createShardDefault(
    await tokenA.getAddress(),
    await tokenB.getAddress()
  );
  const receipt = await createTx.wait();
  
  // Extract shard address from events
  const shardCreatedEvent = receipt.logs.find(
    log => log.fragment && log.fragment.name === "ShardCreated"
  );
  const shardAddress = shardCreatedEvent.args[0];
  console.log(`✅ Test Shard created: ${shardAddress}`);

  // Get the shard contract instance
  const SAMMPool = await ethers.getContractFactory("SAMMPool");
  const shard = SAMMPool.attach(shardAddress);

  // Mint tokens to deployer for testing
  console.log("\n4️⃣ Minting Test Tokens...");
  const mintAmount = ethers.parseEther("1000000");
  await tokenA.mint(deployer.address, mintAmount);
  await tokenB.mint(deployer.address, mintAmount);
  console.log(`✅ Minted ${ethers.formatEther(mintAmount)} tokens each`);

  // Approve tokens for shard
  console.log("\n5️⃣ Approving Tokens...");
  await tokenA.approve(shardAddress, mintAmount);
  await tokenB.approve(shardAddress, mintAmount);
  console.log("✅ Tokens approved for shard");

  // Initialize shard with liquidity
  console.log("\n6️⃣ Initializing Shard with Liquidity...");
  const liquidityAmount = ethers.parseEther("10000");
  const initTx = await factory.initializeShard(
    shardAddress,
    liquidityAmount,
    liquidityAmount
  );
  await initTx.wait();
  console.log(`✅ Shard initialized with ${ethers.formatEther(liquidityAmount)} tokens each`);

  // Verify SAMM parameters
  console.log("\n7️⃣ Verifying SAMM Parameters...");
  const [beta1, rmin, rmax, c] = await shard.getSAMMParams();
  console.log(`✅ SAMM Parameters:`);
  console.log(`   β1: ${beta1} (-1.05 * 1e6)`);
  console.log(`   rmin: ${rmin} (0.001 * 1e6)`);
  console.log(`   rmax: ${rmax} (0.012 * 1e6)`);
  console.log(`   c: ${c} (0.0104 * 1e6)`);

  // Test a small swap
  console.log("\n8️⃣ Testing SAMM Swap...");
  const swapAmount = ethers.parseEther("10");
  const maxAmountIn = ethers.parseEther("100");
  
  // Calculate expected swap result
  const swapResult = await shard.calculateSwapSAMM(
    swapAmount,
    await tokenA.getAddress(),
    await tokenB.getAddress()
  );
  
  console.log(`📊 Swap Calculation (${ethers.formatEther(swapAmount)} Token B):`);
  console.log(`   Amount In: ${ethers.formatEther(swapResult.amountIn)} Token A`);
  console.log(`   Trade Fee: ${ethers.formatEther(swapResult.tradeFee)} Token A`);
  console.log(`   Owner Fee: ${ethers.formatEther(swapResult.ownerFee)} Token A`);

  // Execute the swap
  const swapTx = await shard.swapSAMM(
    swapAmount,
    maxAmountIn,
    await tokenA.getAddress(),
    await tokenB.getAddress(),
    deployer.address
  );
  await swapTx.wait();
  console.log("✅ Test swap executed successfully");

  // Verify reserves after swap
  const [reserveA, reserveB] = await shard.getReserves();
  console.log(`📈 Pool Reserves After Swap:`);
  console.log(`   Token A: ${ethers.formatEther(reserveA)}`);
  console.log(`   Token B: ${ethers.formatEther(reserveB)}`);

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      factory: await factory.getAddress(),
      tokenA: await tokenA.getAddress(),
      tokenB: await tokenB.getAddress(),
      testShard: shardAddress
    },
    sammParameters: {
      beta1: Number(beta1),
      rmin: Number(rmin),
      rmax: Number(rmax),
      c: Number(c)
    },
    testResults: {
      swapAmount: ethers.formatEther(swapAmount),
      amountIn: ethers.formatEther(swapResult.amountIn),
      tradeFee: ethers.formatEther(swapResult.tradeFee),
      ownerFee: ethers.formatEther(swapResult.ownerFee),
      finalReserveA: ethers.formatEther(reserveA),
      finalReserveB: ethers.formatEther(reserveB)
    }
  };

  const deploymentPath = path.join(__dirname, "..", "deployments", `sepolia-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));

  console.log("\n🎉 Deployment Complete!");
  console.log("=" .repeat(60));
  console.log(`📄 Deployment info saved to: ${deploymentPath}`);
  console.log("\n📋 Contract Addresses:");
  console.log(`Factory: ${await factory.getAddress()}`);
  console.log(`Token A: ${await tokenA.getAddress()}`);
  console.log(`Token B: ${await tokenB.getAddress()}`);
  console.log(`Test Shard: ${shardAddress}`);
  
  console.log("\n🔗 Etherscan Links:");
  console.log(`Factory: https://sepolia.etherscan.io/address/${await factory.getAddress()}`);
  console.log(`Test Shard: https://sepolia.etherscan.io/address/${shardAddress}`);

  return deploymentInfo;
}

main()
  .then((deploymentInfo) => {
    console.log("\n✅ Deployment script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });