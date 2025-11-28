require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("hardhat");
const { createProvider } = require("../config/deployment-config");

async function checkDeployment() {
  console.log("🔍 Checking RiseChain Deployment Status");
  console.log("=".repeat(50));

  try {
    const { provider, wallet } = createProvider("risechain");
    
    // These are the addresses from the last deployment attempt
    const factoryAddress = "0x1888FF2446f2542cbb399eD179F4d6d966268C1F";
    const tokenAAddress = "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e";
    const tokenBAddress = "0x3f256051aEd4bEc7947Bac441B0A581260132006";
    const shardAddresses = [
      "0xF4d727cFB4C6976833BCA7bfDB2e1554dcc5eD92", // Initial Shard
      "0x9Fa78607d2602A014Edb84e8D612BA72F231DBE3", // Shard 2
      "0xf304b46da668a5E889E898157d609E95EdC8baa7", // Shard 3
      "0x8d58e82C5379af5222EBFb50b16a0f17e2181C37"  // Shard 4
    ];
    
    console.log("📋 Checking deployed contracts:");
    console.log(`Factory: ${factoryAddress}`);
    console.log(`Token A: ${tokenAAddress}`);
    console.log(`Token B: ${tokenBAddress}`);
    console.log(`Shards (${shardAddresses.length} total):`);
    shardAddresses.forEach((addr, i) => {
      console.log(`  Shard ${i + 1}: ${addr}`);
    });
    
    // Check if contracts exist
    console.log("\n🔍 Verifying contract deployment...");
    
    const factoryCode = await provider.getCode(factoryAddress);
    console.log(`Factory deployed: ${factoryCode !== "0x" ? "✅ YES" : "❌ NO"}`);
    
    const tokenACode = await provider.getCode(tokenAAddress);
    console.log(`Token A deployed: ${tokenACode !== "0x" ? "✅ YES" : "❌ NO"}`);
    
    const tokenBCode = await provider.getCode(tokenBAddress);
    console.log(`Token B deployed: ${tokenBCode !== "0x" ? "✅ YES" : "❌ NO"}`);
    
    // Check all shards
    const shardStatuses = [];
    for (let i = 0; i < shardAddresses.length; i++) {
      const shardAddress = shardAddresses[i];
      const shardCode = await provider.getCode(shardAddress);
      const isDeployed = shardCode !== "0x";
      console.log(`Shard ${i + 1} deployed: ${isDeployed ? "✅ YES" : "❌ NO"}`);
      shardStatuses.push({ address: shardAddress, deployed: isDeployed });
    }
    
    // Check shard status for deployed shards
    console.log("\n📊 Checking shard status...");
    const SAMMPool = await ethers.getContractFactory("SAMMPool");
    
    for (let i = 0; i < shardStatuses.length; i++) {
      const shardStatus = shardStatuses[i];
      if (shardStatus.deployed) {
        console.log(`\n  Shard ${i + 1} (${shardStatus.address}):`);
        try {
          const shard = SAMMPool.attach(shardStatus.address);
          const initialized = await shard.initialized();
          console.log(`    Initialized: ${initialized ? "✅ YES" : "❌ NO"}`);
          
          if (initialized) {
            const [reserveA, reserveB] = await shard.getReserves();
            console.log(`    Reserve A: ${ethers.formatEther(reserveA)} tokens`);
            console.log(`    Reserve B: ${ethers.formatEther(reserveB)} tokens`);
            
            const [beta1, rmin, rmax, c] = await shard.getSAMMParams();
            console.log(`    SAMM Parameters: β1=${beta1}, rmin=${rmin}, rmax=${rmax}, c=${c}`);
          } else {
            console.log("    ⚠️  Shard exists but is not initialized");
          }
        } catch (error) {
          console.log(`    ❌ Error checking shard: ${error.message}`);
        }
      }
    }
    
    // Check token balances
    console.log("\n💰 Checking token balances...");
    if (tokenACode !== "0x" && tokenBCode !== "0x") {
      const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
      const tokenA = MockERC20.attach(tokenAAddress);
      const tokenB = MockERC20.attach(tokenBAddress);
      
      const balanceA = await tokenA.balanceOf(wallet.address);
      const balanceB = await tokenB.balanceOf(wallet.address);
      
      console.log(`Deployer Token A balance: ${ethers.formatEther(balanceA)}`);
      console.log(`Deployer Token B balance: ${ethers.formatEther(balanceB)}`);
    }
    
    // Check current ETH balance
    const ethBalance = await provider.getBalance(wallet.address);
    console.log(`\n💳 Current ETH balance: ${ethers.formatEther(ethBalance)} ETH`);
    
    const deployedShards = shardStatuses.filter(s => s.deployed);
    
    console.log("\n🎯 Next Steps:");
    console.log(`✅ ${deployedShards.length}/${shardAddresses.length} shards deployed successfully`);
    if (deployedShards.length >= 4) {
      console.log("1. Initialize remaining shards with different liquidity levels");
      console.log("2. Test c-smaller-better property across shards");
      console.log("3. Test smallest shard selection");
      console.log("4. Deploy router service for multi-shard routing");
    } else if (deployedShards.length > 0) {
      console.log("1. Complete shard deployment (need 4 total for proper testing)");
      console.log("2. Initialize shards with different liquidity levels");
    } else {
      console.log("1. Shard deployment failed - need to redeploy");
    }
    
    return {
      factoryDeployed: factoryCode !== "0x",
      tokenADeployed: tokenACode !== "0x",
      tokenBDeployed: tokenBCode !== "0x",
      shardsDeployed: deployedShards.length,
      totalShards: shardAddresses.length,
      addresses: {
        factory: factoryAddress,
        tokenA: tokenAAddress,
        tokenB: tokenBAddress,
        shards: shardAddresses
      }
    };
    
  } catch (error) {
    console.error("❌ Check failed:", error.message);
    return null;
  }
}

checkDeployment()
  .then(result => {
    if (result) {
      console.log("\n✅ Deployment check completed");
    }
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Check failed:", error.message);
    process.exit(1);
  });