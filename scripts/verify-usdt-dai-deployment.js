const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Verify USDT/DAI pool deployment
 * Checks all shards and their state
 */
async function main() {
  console.log("🔍 Verifying USDT/DAI Pool Deployment");
  console.log("=".repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log(`Verifier: ${wallet.address}\n`);

  // Find the latest USDT/DAI deployment
  const deploymentDir = path.join(__dirname, "..", "deployment-data");
  const files = fs.readdirSync(deploymentDir);
  const usdtDaiFiles = files.filter(f => f.startsWith("usdt-dai-pools-"));
  
  if (usdtDaiFiles.length === 0) {
    console.log("❌ No USDT/DAI deployment found");
    return;
  }

  const latestFile = usdtDaiFiles.sort().reverse()[0];
  const deploymentPath = path.join(deploymentDir, latestFile);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  console.log(`📄 Deployment File: ${latestFile}`);
  console.log(`📅 Timestamp: ${deployment.timestamp}`);
  console.log(`🌐 Network: ${deployment.network}\n`);

  // Get contract instances
  const factory = await ethers.getContractAt("SAMMPoolFactory", deployment.contracts.factory, wallet);
  const usdt = await ethers.getContractAt("MockERC20", deployment.contracts.tokens[0].address, wallet);
  const dai = await ethers.getContractAt("MockERC20", deployment.contracts.tokens[1].address, wallet);

  console.log("📍 Contract Addresses:");
  console.log(`Factory: ${deployment.contracts.factory}`);
  console.log(`USDT: ${deployment.contracts.tokens[0].address}`);
  console.log(`DAI: ${deployment.contracts.tokens[1].address}\n`);

  // Verify each shard
  console.log("🔍 Verifying Shards:");
  console.log("=".repeat(60));

  for (let i = 0; i < deployment.contracts.shards.length; i++) {
    const shardData = deployment.contracts.shards[i];
    console.log(`\n📊 Shard ${i + 1}: ${shardData.name}`);
    console.log(`Address: ${shardData.address}`);
    
    try {
      const pool = await ethers.getContractAt("SAMMPool", shardData.address, wallet);
      
      // Check if initialized
      const reserves = await pool.getReserves();
      const isInitialized = reserves[0] > 0n && reserves[1] > 0n;
      
      console.log(`Status: ${isInitialized ? "✅ Initialized" : "❌ Not Initialized"}`);
      
      if (isInitialized) {
        // Get pool state
        const tokenA = await pool.tokenA();
        const tokenB = await pool.tokenB();
        const totalSupply = await pool.totalSupply();
        
        console.log(`Token A: ${tokenA === deployment.contracts.tokens[0].address ? "USDT ✅" : "❌ Mismatch"}`);
        console.log(`Token B: ${tokenB === deployment.contracts.tokens[1].address ? "DAI ✅" : "❌ Mismatch"}`);
        console.log(`Reserves: ${ethers.formatUnits(reserves[0], 6)} USDT, ${ethers.formatUnits(reserves[1], 18)} DAI`);
        console.log(`LP Supply: ${ethers.formatEther(totalSupply)}`);
        
        // Get SAMM parameters
        const sammParams = await pool.getSAMMParams();
        console.log(`SAMM Params:`);
        console.log(`  beta1: ${sammParams[0]}`);
        console.log(`  rmin: ${sammParams[1]}`);
        console.log(`  rmax: ${sammParams[2]}`);
        console.log(`  c: ${sammParams[3]}`);
        
        // Test a small swap calculation
        const testAmount = ethers.parseUnits("1", 6); // 1 USDT
        try {
          const swapResult = await pool.calculateSwapSAMM(
            testAmount,
            tokenA,
            tokenB
          );
          console.log(`Test Swap (1 USDT -> DAI):`);
          console.log(`  Input: ${ethers.formatUnits(swapResult.amountIn, 18)} DAI`);
          console.log(`  Output: ${ethers.formatUnits(swapResult.amountOut, 6)} USDT`);
          console.log(`  Trade Fee: ${ethers.formatUnits(swapResult.tradeFee, 18)} DAI`);
        } catch (e) {
          console.log(`Test Swap: ⚠️  ${e.message}`);
        }
      }
      
      // Check factory registration
      const shardInfo = await factory.getShardInfo(shardData.address);
      console.log(`Factory Registration: ${shardInfo.isActive ? "✅ Active" : "❌ Inactive"}`);
      
    } catch (error) {
      console.log(`❌ Error verifying shard: ${error.message}`);
    }
  }

  // Verify factory knows about all shards
  console.log("\n🏭 Factory Verification:");
  console.log("=".repeat(60));
  
  const usdtAddress = deployment.contracts.tokens[0].address;
  const daiAddress = deployment.contracts.tokens[1].address;
  
  const shardsFromFactory = await factory.getShardsForPair(usdtAddress, daiAddress);
  console.log(`Shards registered in factory: ${shardsFromFactory.length}`);
  console.log(`Shards in deployment: ${deployment.contracts.shards.length}`);
  
  if (shardsFromFactory.length === deployment.contracts.shards.length) {
    console.log("✅ All shards registered correctly");
    
    // Verify each address matches
    let allMatch = true;
    for (let i = 0; i < shardsFromFactory.length; i++) {
      const matches = deployment.contracts.shards.some(s => s.address === shardsFromFactory[i]);
      if (!matches) {
        console.log(`❌ Shard ${shardsFromFactory[i]} not found in deployment`);
        allMatch = false;
      }
    }
    
    if (allMatch) {
      console.log("✅ All shard addresses match");
    }
  } else {
    console.log("❌ Shard count mismatch");
  }

  console.log("\n🎉 Verification Complete!");
}

main()
  .then(() => {
    console.log("\n✅ Verification completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Verification failed:");
    console.error(error);
    process.exit(1);
  });
