require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("ethers");

async function checkShardOwner() {
  console.log("🔍 Checking Shard Ownership");
  console.log("=".repeat(40));

  try {
    const rpcUrl = process.env.RISECHAIN_RPC_URL;
    const privateKey = process.env.PRIVATE_KEY;
    
    const provider = new ethers.JsonRpcProvider(rpcUrl, {
      chainId: 11155931,
      name: "risechain-testnet",
      ensAddress: null
    });
    
    const wallet = new ethers.Wallet(privateKey, provider);
    
    const shardAddress = ethers.getAddress("0x42A88f388cc3C1f6ACBeB4d753A9B778c82a632E");
    const factoryAddress = ethers.getAddress("0x1888FF2446f2542cbb399eD179F4d6d966268C1F");
    
    console.log(`Deployer: ${wallet.address}`);
    console.log(`Factory: ${factoryAddress}`);
    console.log(`Shard: ${shardAddress}`);
    
    // Load ABI
    const fs = require('fs');
    const path = require('path');
    
    const sammPoolArtifact = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'artifacts', 'contracts', 'SAMMPool.sol', 'SAMMPool.json')
    ));
    
    const shard = new ethers.Contract(shardAddress, sammPoolArtifact.abi, wallet);
    
    // Check shard owner
    const shardOwner = await shard.owner();
    console.log(`\nShard Owner: ${shardOwner}`);
    console.log(`Is Factory Owner: ${shardOwner.toLowerCase() === factoryAddress.toLowerCase()}`);
    console.log(`Is Deployer Owner: ${shardOwner.toLowerCase() === wallet.address.toLowerCase()}`);
    
    // Check if shard has an initialized flag we can read
    try {
      // Try to call a method that requires initialization to see if it's initialized
      const tokenA = await shard.tokenA();
      const tokenB = await shard.tokenB();
      console.log(`\nShard Token A: ${tokenA}`);
      console.log(`Shard Token B: ${tokenB}`);
      
      // Try to get reserves (this might fail if not initialized)
      try {
        const [reserveA, reserveB] = await shard.getReserves();
        console.log(`Reserves: A=${ethers.formatEther(reserveA)}, B=${ethers.formatEther(reserveB)}`);
        
        if (reserveA > 0n || reserveB > 0n) {
          console.log("✅ Shard appears to be initialized (has reserves)");
        } else {
          console.log("⚠️  Shard has zero reserves but getReserves() works");
        }
      } catch (reserveError) {
        console.log(`❌ getReserves() failed: ${reserveError.message}`);
      }
      
      // Try to call getSAMMParams
      try {
        const [beta1, rmin, rmax, c] = await shard.getSAMMParams();
        console.log(`SAMM Params: β1=${beta1}, rmin=${rmin}, rmax=${rmax}, c=${c}`);
        
        if (beta1 !== 0n || rmin !== 0n || rmax !== 0n || c !== 0n) {
          console.log("✅ Shard has SAMM parameters set");
        } else {
          console.log("⚠️  Shard has zero SAMM parameters");
        }
      } catch (paramsError) {
        console.log(`❌ getSAMMParams() failed: ${paramsError.message}`);
      }
      
    } catch (error) {
      console.log(`❌ Error checking shard state: ${error.message}`);
    }
    
  } catch (error) {
    console.error("❌ Check failed:", error.message);
  }
}

checkShardOwner()
  .then(() => {
    console.log("\n✅ Shard owner check completed");
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Check failed:", error.message);
    process.exit(1);
  });