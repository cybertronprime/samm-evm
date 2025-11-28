require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("hardhat");
const { createProvider } = require("../config/deployment-config");

async function diagnoseInitialization() {
  console.log("🔍 Diagnosing SAMM Initialization Issues");
  console.log("=".repeat(50));

  try {
    const { provider, wallet } = createProvider("risechain");
    
    // Latest deployment addresses from the output
    const factoryAddress = "0x1888FF2446f2542cbb399eD179F4d6d966268C1F";
    const tokenAAddress = "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e";
    const tokenBAddress = "0x3f256051aEd4bEc7947Bac441B0A5812601320063";
    const shardAddress = "0xF4d727cFB4C6976833BCA7bfDB2e1554dcc5eD92";
    
    console.log("📋 Latest deployment addresses:");
    console.log(`Factory: ${factoryAddress}`);
    console.log(`Token A: ${tokenAAddress}`);
    console.log(`Token B: ${tokenBAddress}`);
    console.log(`Shard: ${shardAddress}`);
    
    // Check current ETH balance
    const ethBalance = await provider.getBalance(wallet.address);
    console.log(`\n💰 Current ETH balance: ${ethers.formatEther(ethBalance)} ETH`);
    
    // Check if contracts exist
    const shardCode = await provider.getCode(shardAddress);
    console.log(`\n🔍 Shard deployed: ${shardCode !== "0x" ? "✅ YES" : "❌ NO"}`);
    
    if (shardCode === "0x") {
      console.log("❌ Shard not deployed, cannot proceed with initialization");
      return;
    }
    
    // Get contract instances
    const SAMMPool = await ethers.getContractFactory("SAMMPool");
    const shard = SAMMPool.attach(shardAddress);
    
    const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
    const tokenA = MockERC20.attach(tokenAAddress);
    const tokenB = MockERC20.attach(tokenBAddress);
    
    // Check shard initialization status
    console.log("\n📊 Checking shard status...");
    try {
      const initialized = await shard.initialized();
      console.log(`Shard initialized: ${initialized ? "✅ YES" : "❌ NO"}`);
      
      if (initialized) {
        console.log("✅ Shard is already initialized!");
        const [reserveA, reserveB] = await shard.getReserves();
        console.log(`Reserve A: ${ethers.formatEther(reserveA)} tokens`);
        console.log(`Reserve B: ${ethers.formatEther(reserveB)} tokens`);
        return;
      }
    } catch (error) {
      console.log(`❌ Error checking initialization status: ${error.message}`);
    }
    
    // Check token balances
    console.log("\n💰 Checking token balances...");
    try {
      const balanceA = await tokenA.balanceOf(wallet.address);
      const balanceB = await tokenB.balanceOf(wallet.address);
      console.log(`Deployer Token A balance: ${ethers.formatEther(balanceA)}`);
      console.log(`Deployer Token B balance: ${ethers.formatEther(balanceB)}`);
      
      if (balanceA === 0n || balanceB === 0n) {
        console.log("⚠️  No tokens minted yet - need to mint first");
      }
    } catch (error) {
      console.log(`❌ Error checking token balances: ${error.message}`);
    }
    
    // Check token allowances
    console.log("\n🔐 Checking token allowances...");
    try {
      const allowanceA = await tokenA.allowance(wallet.address, shardAddress);
      const allowanceB = await tokenB.allowance(wallet.address, shardAddress);
      console.log(`Token A allowance to shard: ${ethers.formatEther(allowanceA)}`);
      console.log(`Token B allowance to shard: ${ethers.formatEther(allowanceB)}`);
    } catch (error) {
      console.log(`❌ Error checking allowances: ${error.message}`);
    }
    
    // Check shard owner
    console.log("\n👤 Checking shard ownership...");
    try {
      const owner = await shard.owner();
      console.log(`Shard owner: ${owner}`);
      console.log(`Deployer address: ${wallet.address}`);
      console.log(`Is deployer owner: ${owner.toLowerCase() === wallet.address.toLowerCase() ? "✅ YES" : "❌ NO"}`);
    } catch (error) {
      console.log(`❌ Error checking owner: ${error.message}`);
    }
    
    // Try a simple initialization with minimal amounts
    console.log("\n🧪 Testing initialization with minimal amounts...");
    try {
      // First mint some tokens if needed
      const balanceA = await tokenA.balanceOf(wallet.address);
      if (balanceA === 0n) {
        console.log("   Minting test tokens...");
        const mintAmount = ethers.parseEther("1000");
        await tokenA.mint(wallet.address, mintAmount);
        await tokenB.mint(wallet.address, mintAmount);
        console.log("   ✅ Tokens minted");
      }
      
      // Approve tokens
      const testAmount = ethers.parseEther("10");
      console.log("   Approving tokens...");
      await tokenA.approve(shardAddress, testAmount);
      await tokenB.approve(shardAddress, testAmount);
      console.log("   ✅ Tokens approved");
      
      // Try initialization
      console.log("   Attempting initialization...");
      const initTx = await shard.initialize(
        tokenAAddress,
        tokenBAddress,
        testAmount,
        testAmount,
        25,    // tradeFeeNumerator (0.25%)
        10000, // tradeFeeDenominator
        10,    // ownerFeeNumerator (0.1%)
        10000, // ownerFeeDenominator
        {
          gasLimit: 2000000 // Lower gas limit for testing
        }
      );
      
      console.log(`   ⏳ Transaction hash: ${initTx.hash}`);
      const receipt = await initTx.wait(1);
      console.log(`   ✅ Initialization successful! Gas used: ${receipt.gasUsed}`);
      
      // Verify initialization
      const initialized = await shard.initialized();
      console.log(`   ✅ Shard now initialized: ${initialized}`);
      
      if (initialized) {
        const [reserveA, reserveB] = await shard.getReserves();
        console.log(`   Reserve A: ${ethers.formatEther(reserveA)} tokens`);
        console.log(`   Reserve B: ${ethers.formatEther(reserveB)} tokens`);
      }
      
    } catch (error) {
      console.log(`   ❌ Initialization failed: ${error.message}`);
      
      // Try to get more details about the error
      if (error.receipt) {
        console.log(`   Gas used: ${error.receipt.gasUsed}`);
        console.log(`   Status: ${error.receipt.status}`);
      }
      
      // Check if it's a revert with reason
      if (error.reason) {
        console.log(`   Revert reason: ${error.reason}`);
      }
    }
    
  } catch (error) {
    console.error("❌ Diagnosis failed:", error.message);
  }
}

diagnoseInitialization()
  .then(() => {
    console.log("\n✅ Diagnosis completed");
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Diagnosis failed:", error.message);
    process.exit(1);
  });