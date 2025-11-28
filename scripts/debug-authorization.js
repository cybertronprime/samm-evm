require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("ethers");

async function debugAuthorization() {
  console.log("🔍 Debugging Authorization Issues");
  console.log("=".repeat(50));

  try {
    const rpcUrl = process.env.RISECHAIN_RPC_URL;
    const privateKey = process.env.PRIVATE_KEY;
    
    const provider = new ethers.JsonRpcProvider(rpcUrl, {
      chainId: 11155931,
      name: "risechain-testnet",
      ensAddress: null
    });
    
    const wallet = new ethers.Wallet(privateKey, provider);
    
    console.log(`Deployer: ${wallet.address}`);
    
    // Contract addresses
    const factoryAddress = ethers.getAddress("0x1888FF2446f2542cbb399eD179F4d6d966268C1F");
    const shardAddress = ethers.getAddress("0xF4d727cFB4C6976833BCA7bfDB2e1554dcc5eD92");
    
    // Load ABIs
    const fs = require('fs');
    const path = require('path');
    
    const sammFactoryArtifact = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'artifacts', 'contracts', 'SAMMPoolFactory.sol', 'SAMMPoolFactory.json')
    ));
    
    const factory = new ethers.Contract(factoryAddress, sammFactoryArtifact.abi, wallet);
    
    console.log("\n🔍 Checking factory ownership...");
    
    try {
      const factoryOwner = await factory.owner();
      console.log(`Factory Owner: ${factoryOwner}`);
      console.log(`Is Deployer Factory Owner: ${factoryOwner.toLowerCase() === wallet.address.toLowerCase()}`);
    } catch (error) {
      console.log(`❌ Error getting factory owner: ${error.message}`);
    }
    
    console.log("\n🔍 Checking shard info...");
    
    try {
      const shardInfo = await factory.getShardInfo(shardAddress);
      console.log(`Shard Info:`);
      console.log(`  Token A: ${shardInfo.tokenA}`);
      console.log(`  Token B: ${shardInfo.tokenB}`);
      console.log(`  Shard Index: ${shardInfo.shardIndex}`);
      console.log(`  Is Active: ${shardInfo.isActive}`);
      console.log(`  Creator: ${shardInfo.creator}`);
      console.log(`  Created At: ${new Date(Number(shardInfo.createdAt) * 1000).toISOString()}`);
      console.log(`  Is Deployer Creator: ${shardInfo.creator.toLowerCase() === wallet.address.toLowerCase()}`);
      
      console.log(`\nFee Parameters:`);
      console.log(`  Trade Fee: ${shardInfo.feeParams.tradeFeeNumerator}/${shardInfo.feeParams.tradeFeeDenominator}`);
      console.log(`  Owner Fee: ${shardInfo.feeParams.ownerFeeNumerator}/${shardInfo.feeParams.ownerFeeDenominator}`);
      
      console.log(`\nSAMM Parameters:`);
      console.log(`  β1: ${shardInfo.sammParams.beta1}`);
      console.log(`  rmin: ${shardInfo.sammParams.rmin}`);
      console.log(`  rmax: ${shardInfo.sammParams.rmax}`);
      console.log(`  c: ${shardInfo.sammParams.c}`);
      
      // Check authorization
      const isAuthorized = shardInfo.creator.toLowerCase() === wallet.address.toLowerCase();
      console.log(`\n✅ Authorization Check: ${isAuthorized ? "AUTHORIZED" : "NOT AUTHORIZED"}`);
      
      if (!isAuthorized) {
        console.log("❌ Deployer is not the shard creator and not the factory owner");
        console.log("💡 This explains why initializeShard is failing");
      }
      
    } catch (error) {
      console.log(`❌ Error getting shard info: ${error.message}`);
    }
    
    // Check if there are other shards we can use
    console.log("\n🔍 Checking all shards...");
    
    try {
      const allShards = await factory.getAllShards();
      console.log(`Total shards: ${allShards.length}`);
      
      for (let i = 0; i < allShards.length; i++) {
        const shardAddr = allShards[i];
        console.log(`\nShard ${i + 1}: ${shardAddr}`);
        
        try {
          const info = await factory.getShardInfo(shardAddr);
          console.log(`  Creator: ${info.creator}`);
          console.log(`  Is Active: ${info.isActive}`);
          console.log(`  Is Deployer Creator: ${info.creator.toLowerCase() === wallet.address.toLowerCase()}`);
          
          if (info.creator.toLowerCase() === wallet.address.toLowerCase()) {
            console.log(`  ✅ This shard can be initialized by deployer!`);
          }
        } catch (error) {
          console.log(`  ❌ Error getting info: ${error.message}`);
        }
      }
    } catch (error) {
      console.log(`❌ Error getting all shards: ${error.message}`);
    }
    
  } catch (error) {
    console.error("❌ Debug failed:", error.message);
  }
}

debugAuthorization()
  .then(() => {
    console.log("\n✅ Authorization debug completed");
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Debug failed:", error.message);
    process.exit(1);
  });