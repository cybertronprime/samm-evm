require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("ethers");

async function debugInitializationDetailed() {
  console.log("🔍 Detailed Initialization Debug");
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
    
    // Use the latest deployed contracts
    const factoryAddress = "0x436b683A68a008327713908f8162Abb5D9bA01E1";
    const shardAddress = "0x13507C6C85AFF40841b494Aca40ab7AB977552Ee";
    const tokenAAddress = "0x1f246208838B710dC11eB11153Db842d81Fe2fB9";
    const tokenBAddress = "0x1Cffc00D08aA1382CC5b52E12B001D934DC04AA4";
    
    console.log(`Factory: ${factoryAddress}`);
    console.log(`Shard: ${shardAddress}`);
    console.log(`Token A: ${tokenAAddress}`);
    console.log(`Token B: ${tokenBAddress}`);
    
    // Load ABIs
    const fs = require('fs');
    const path = require('path');
    
    const sammFactoryArtifact = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'artifacts', 'contracts', 'SAMMPoolFactory.sol', 'SAMMPoolFactory.json')
    ));
    
    const sammPoolArtifact = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'artifacts', 'contracts', 'SAMMPool.sol', 'SAMMPool.json')
    ));
    
    const mockERC20Artifact = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'artifacts', 'contracts', 'mocks', 'MockERC20.sol', 'MockERC20.json')
    ));
    
    const factory = new ethers.Contract(factoryAddress, sammFactoryArtifact.abi, wallet);
    const shard = new ethers.Contract(shardAddress, sammPoolArtifact.abi, wallet);
    const tokenA = new ethers.Contract(tokenAAddress, mockERC20Artifact.abi, wallet);
    const tokenB = new ethers.Contract(tokenBAddress, mockERC20Artifact.abi, wallet);
    
    // Check all ownership and authorization
    console.log("\n🔍 Checking ownership and authorization...");
    
    const factoryOwner = await factory.owner();
    const shardOwner = await shard.owner();
    const shardInfo = await factory.getShardInfo(shardAddress);
    
    console.log(`Factory Owner: ${factoryOwner}`);
    console.log(`Shard Owner: ${shardOwner}`);
    console.log(`Shard Creator: ${shardInfo.creator}`);
    console.log(`Deployer: ${wallet.address}`);
    
    console.log(`\nAuthorization checks:`);
    console.log(`  Is Deployer Factory Owner: ${factoryOwner.toLowerCase() === wallet.address.toLowerCase()}`);
    console.log(`  Is Factory Shard Owner: ${shardOwner.toLowerCase() === factoryAddress.toLowerCase()}`);
    console.log(`  Is Deployer Shard Creator: ${shardInfo.creator.toLowerCase() === wallet.address.toLowerCase()}`);
    
    // Check shard state
    console.log("\n🔍 Checking shard state...");
    
    try {
      const [reserveA, reserveB] = await shard.getReserves();
      console.log(`Current Reserves: A=${ethers.formatEther(reserveA)}, B=${ethers.formatEther(reserveB)}`);
    } catch (error) {
      console.log(`Error getting reserves: ${error.message}`);
    }
    
    try {
      const initialized = await shard.initialized();
      console.log(`Is Initialized: ${initialized}`);
    } catch (error) {
      console.log(`Error checking initialized: ${error.message}`);
    }
    
    // Check token balances and allowances
    console.log("\n🔍 Checking token setup...");
    
    const balanceA = await tokenA.balanceOf(wallet.address);
    const balanceB = await tokenB.balanceOf(wallet.address);
    const allowanceA = await tokenA.allowance(wallet.address, factoryAddress);
    const allowanceB = await tokenB.allowance(wallet.address, factoryAddress);
    
    console.log(`Token Balances: A=${ethers.formatEther(balanceA)}, B=${ethers.formatEther(balanceB)}`);
    console.log(`Token Allowances: A=${ethers.formatEther(allowanceA)}, B=${ethers.formatEther(allowanceB)}`);
    
    const liquidityAmount = ethers.parseEther("10");
    
    // Ensure we have enough allowance
    if (allowanceA < liquidityAmount) {
      console.log("Approving Token A...");
      const approveTxA = await tokenA.approve(factoryAddress, liquidityAmount);
      await approveTxA.wait(1);
      console.log("✅ Token A approved");
    }
    
    if (allowanceB < liquidityAmount) {
      console.log("Approving Token B...");
      const approveTxB = await tokenB.approve(factoryAddress, liquidityAmount);
      await approveTxB.wait(1);
      console.log("✅ Token B approved");
    }
    
    // Try to call initializeShard with detailed error handling
    console.log("\n🧪 Testing initializeShard call...");
    
    try {
      // First try static call to see what would happen
      console.log("Trying static call...");
      const staticResult = await factory.initializeShard.staticCall(
        shardAddress,
        liquidityAmount,
        liquidityAmount
      );
      console.log(`✅ Static call successful, would return: ${staticResult}`);
      
      // If static call works, try the actual call
      console.log("Executing actual call...");
      const initTx = await factory.initializeShard(
        shardAddress,
        liquidityAmount,
        liquidityAmount,
        {
          gasLimit: 3000000
        }
      );
      
      console.log(`⏳ Transaction: ${initTx.hash}`);
      const receipt = await initTx.wait(1);
      console.log(`✅ SUCCESS! Gas used: ${receipt.gasUsed}`);
      
    } catch (error) {
      console.log(`❌ initializeShard failed: ${error.message}`);
      
      if (error.reason) {
        console.log(`Revert reason: ${error.reason}`);
      }
      
      if (error.code === 'CALL_EXCEPTION' && error.data) {
        console.log(`Error data: ${error.data}`);
        
        // Try to decode the error
        try {
          const errorInterface = new ethers.Interface([
            "error SAMMPool: already initialized()",
            "error SAMMPool: insufficient initial liquidity()",
            "error SAMMPool: invalid trade fee()",
            "error SAMMPool: invalid owner fee()",
            "error Ownable: caller is not the owner()"
          ]);
          
          const decodedError = errorInterface.parseError(error.data);
          console.log(`Decoded error: ${decodedError.name}`);
        } catch (decodeError) {
          console.log("Could not decode error");
        }
      }
      
      // Try calling the shard's initialize function directly
      console.log("\n🧪 Testing direct shard initialization...");
      
      try {
        // Check if we can call initialize directly on the shard
        const directResult = await shard.initialize.staticCall(
          tokenAAddress,
          tokenBAddress,
          liquidityAmount,
          liquidityAmount,
          25,    // trade fee numerator
          10000, // trade fee denominator
          5,     // owner fee numerator
          10000  // owner fee denominator
        );
        console.log(`✅ Direct shard initialize static call successful: ${directResult}`);
        
      } catch (directError) {
        console.log(`❌ Direct shard initialize failed: ${directError.message}`);
        if (directError.reason) {
          console.log(`Direct revert reason: ${directError.reason}`);
        }
      }
    }
    
  } catch (error) {
    console.error("❌ Debug failed:", error.message);
  }
}

debugInitializationDetailed()
  .then(() => {
    console.log("\n✅ Detailed debug completed");
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Debug failed:", error.message);
    process.exit(1);
  });