require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("hardhat");
const { createProvider } = require("../config/deployment-config");

async function diagnoseAllShards() {
  console.log("🔍 Diagnosing All SAMM Shards on RiseChain");
  console.log("=".repeat(60));

  try {
    const { provider, wallet } = createProvider("risechain");
    
    // Latest deployment addresses from the output
    const factoryAddress = "0x1888FF2446f2542cbb399eD179F4d6d966268C1F";
    const tokenAAddress = "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e";
    const tokenBAddress = "0x3f256051aEd4bEc7947Bac441B0A5812601320063";
    
    console.log("📋 Latest deployment addresses:");
    console.log(`Factory: ${factoryAddress}`);
    console.log(`Token A: ${tokenAAddress}`);
    console.log(`Token B: ${tokenBAddress}`);
    
    // Check current ETH balance
    const ethBalance = await provider.getBalance(wallet.address);
    console.log(`\n💰 Current ETH balance: ${ethers.formatEther(ethBalance)} ETH`);
    
    // Check if factory exists
    const factoryCode = await provider.getCode(factoryAddress);
    console.log(`\n🔍 Factory deployed: ${factoryCode !== "0x" ? "✅ YES" : "❌ NO"}`);
    
    if (factoryCode === "0x") {
      console.log("❌ Factory not deployed, cannot proceed");
      return;
    }
    
    // Get factory contract
    const SAMMPoolFactory = await ethers.getContractFactory("SAMMPoolFactory");
    const factory = SAMMPoolFactory.attach(factoryAddress);
    
    // Get all shards for the token pair
    console.log("\n📊 Getting all shards from factory...");
    try {
      const shards = await factory.getShardsForPair(tokenAAddress, tokenBAddress);
      console.log(`Found ${shards.length} shards for token pair`);
      
      if (shards.length === 0) {
        console.log("❌ No shards found for this token pair");
        return;
      }
      
      // Check each shard
      for (let i = 0; i < shards.length; i++) {
        const shardAddress = shards[i];
        console.log(`\n🔍 Checking Shard ${i + 1}: ${shardAddress}`);
        
        // Check if shard contract exists
        const shardCode = await provider.getCode(shardAddress);
        console.log(`   Contract deployed: ${shardCode !== "0x" ? "✅ YES" : "❌ NO"}`);
        
        if (shardCode === "0x") {
          console.log("   ❌ Shard contract not found");
          continue;
        }
        
        // Get shard contract
        const SAMMPool = await ethers.getContractFactory("SAMMPool");
        const shard = SAMMPool.attach(shardAddress);
        
        try {
          // Check basic contract info
          const tokenA = await shard.tokenA();
          const tokenB = await shard.tokenB();
          console.log(`   Token A: ${tokenA}`);
          console.log(`   Token B: ${tokenB}`);
          
          // Check if initialized
          const initialized = await shard.initialized();
          console.log(`   Initialized: ${initialized ? "✅ YES" : "❌ NO"}`);
          
          if (initialized) {
            const [reserveA, reserveB] = await shard.getReserves();
            console.log(`   Reserve A: ${ethers.formatEther(reserveA)} tokens`);
            console.log(`   Reserve B: ${ethers.formatEther(reserveB)} tokens`);
            
            // Check SAMM parameters
            const [beta1, rmin, rmax, c] = await shard.getSAMMParams();
            console.log(`   SAMM Parameters:`);
            console.log(`     β1: ${beta1}`);
            console.log(`     rmin: ${rmin}`);
            console.log(`     rmax: ${rmax}`);
            console.log(`     c: ${c}`);
          } else {
            console.log("   ⚠️  Shard not initialized - can initialize this one");
            
            // Check owner
            const owner = await shard.owner();
            console.log(`   Owner: ${owner}`);
            console.log(`   Is deployer owner: ${owner.toLowerCase() === wallet.address.toLowerCase() ? "✅ YES" : "❌ NO"}`);
          }
          
        } catch (error) {
          console.log(`   ❌ Error checking shard: ${error.message}`);
        }
      }
      
      // Find first uninitialized shard to test with
      console.log("\n🧪 Looking for uninitialized shard to test...");
      let targetShard = null;
      
      for (let i = 0; i < shards.length; i++) {
        const shardAddress = shards[i];
        const shardCode = await provider.getCode(shardAddress);
        
        if (shardCode !== "0x") {
          const SAMMPool = await ethers.getContractFactory("SAMMPool");
          const shard = SAMMPool.attach(shardAddress);
          
          try {
            const initialized = await shard.initialized();
            if (!initialized) {
              targetShard = { address: shardAddress, contract: shard };
              console.log(`Found uninitialized shard: ${shardAddress}`);
              break;
            }
          } catch (error) {
            console.log(`Error checking shard ${shardAddress}: ${error.message}`);
          }
        }
      }
      
      if (!targetShard) {
        console.log("✅ All shards are already initialized!");
        return;
      }
      
      // Test initialization on the target shard
      console.log(`\n🚀 Testing initialization on shard: ${targetShard.address}`);
      
      // Get token contracts
      const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
      const tokenA = MockERC20.attach(tokenAAddress);
      const tokenB = MockERC20.attach(tokenBAddress);
      
      // Check token balances
      console.log("   Checking token balances...");
      const balanceA = await tokenA.balanceOf(wallet.address);
      const balanceB = await tokenB.balanceOf(wallet.address);
      console.log(`   Token A balance: ${ethers.formatEther(balanceA)}`);
      console.log(`   Token B balance: ${ethers.formatEther(balanceB)}`);
      
      // Mint tokens if needed
      if (balanceA === 0n || balanceB === 0n) {
        console.log("   Minting tokens...");
        const mintAmount = ethers.parseEther("1000");
        
        if (balanceA === 0n) {
          const mintTxA = await tokenA.mint(wallet.address, mintAmount);
          await mintTxA.wait(1);
          console.log("   ✅ Token A minted");
        }
        
        if (balanceB === 0n) {
          const mintTxB = await tokenB.mint(wallet.address, mintAmount);
          await mintTxB.wait(1);
          console.log("   ✅ Token B minted");
        }
      }
      
      // Approve tokens
      const testAmount = ethers.parseEther("10");
      console.log("   Approving tokens...");
      
      const approveTxA = await tokenA.approve(targetShard.address, testAmount);
      await approveTxA.wait(1);
      
      const approveTxB = await tokenB.approve(targetShard.address, testAmount);
      await approveTxB.wait(1);
      console.log("   ✅ Tokens approved");
      
      // Initialize the shard
      console.log("   Initializing shard...");
      const initTx = await targetShard.contract.initialize(
        tokenAAddress,
        tokenBAddress,
        testAmount,
        testAmount,
        25,    // tradeFeeNumerator (0.25%)
        10000, // tradeFeeDenominator
        10,    // ownerFeeNumerator (0.1%)
        10000, // ownerFeeDenominator
        {
          gasLimit: 2000000
        }
      );
      
      console.log(`   ⏳ Transaction hash: ${initTx.hash}`);
      const receipt = await initTx.wait(1);
      console.log(`   ✅ Initialization successful! Gas used: ${receipt.gasUsed}`);
      
      // Verify initialization
      const initialized = await targetShard.contract.initialized();
      console.log(`   ✅ Shard now initialized: ${initialized}`);
      
      if (initialized) {
        const [reserveA, reserveB] = await targetShard.contract.getReserves();
        console.log(`   Reserve A: ${ethers.formatEther(reserveA)} tokens`);
        console.log(`   Reserve B: ${ethers.formatEther(reserveB)} tokens`);
        
        // Test a small swap
        console.log("\n🔄 Testing SAMM swap...");
        const swapAmount = ethers.parseEther("1");
        const maxAmountIn = ethers.parseEther("10");
        
        // Calculate expected swap result
        const swapResult = await targetShard.contract.calculateSwapSAMM(
          swapAmount,
          tokenAAddress,
          tokenBAddress
        );
        
        console.log(`   Swap ${ethers.formatEther(swapAmount)} Token B:`);
        console.log(`   Amount In: ${ethers.formatEther(swapResult.amountIn)} Token A`);
        console.log(`   Trade Fee: ${ethers.formatEther(swapResult.tradeFee)} Token A`);
        console.log(`   Owner Fee: ${ethers.formatEther(swapResult.ownerFee)} Token A`);
        
        // Execute the swap
        const swapTx = await targetShard.contract.swapSAMM(
          swapAmount,
          maxAmountIn,
          tokenAAddress,
          tokenBAddress,
          wallet.address,
          {
            gasLimit: 1000000
          }
        );
        await swapTx.wait(1);
        console.log("   ✅ Test swap executed successfully");
        
        // Get final reserves
        const [finalReserveA, finalReserveB] = await targetShard.contract.getReserves();
        console.log(`   Final Reserve A: ${ethers.formatEther(finalReserveA)}`);
        console.log(`   Final Reserve B: ${ethers.formatEther(finalReserveB)}`);
      }
      
    } catch (error) {
      console.log(`❌ Error getting shards: ${error.message}`);
      
      // If factory method fails, try the hardcoded addresses from deployment output
      console.log("\n🔄 Trying hardcoded shard addresses...");
      const hardcodedShards = [
        "0xF4d727cFB4C6976833BCA7bfDB2e1554dcc5eD92",
        "0x9Fa78607d2602A014Edb84e8D612BA72F231DBE3", 
        "0xf304b46da668a5E889E898157d609E95EdC8baa7",
        "0x8d58e82C5379af5222EBFb50b16a0f17e2181C37"
      ];
      
      for (let i = 0; i < hardcodedShards.length; i++) {
        const shardAddress = hardcodedShards[i];
        console.log(`\n🔍 Checking Hardcoded Shard ${i + 1}: ${shardAddress}`);
        
        const shardCode = await provider.getCode(shardAddress);
        console.log(`   Contract deployed: ${shardCode !== "0x" ? "✅ YES" : "❌ NO"}`);
        
        if (shardCode !== "0x") {
          console.log(`   ✅ Found deployed shard at ${shardAddress}`);
        }
      }
    }
    
  } catch (error) {
    console.error("❌ Diagnosis failed:", error.message);
  }
}

diagnoseAllShards()
  .then(() => {
    console.log("\n✅ Complete diagnosis finished");
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Diagnosis failed:", error.message);
    process.exit(1);
  });