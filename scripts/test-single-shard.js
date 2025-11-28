require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("hardhat");
const { createProvider } = require("../config/deployment-config");

async function testSingleShard() {
  console.log("🧪 Testing Single SAMM Shard Initialization");
  console.log("=".repeat(50));

  try {
    const { provider, wallet } = createProvider("risechain");
    
    // Use the first shard from deployment
    const tokenAAddress = "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e";
    const tokenBAddress = "0x3f256051aEd4bEc7947Bac441B0A5812601320063";
    const shardAddress = "0xF4d727cFB4C6976833BCA7bfDB2e1554dcc5eD92";
    
    console.log("📋 Testing addresses:");
    console.log(`Token A: ${tokenAAddress}`);
    console.log(`Token B: ${tokenBAddress}`);
    console.log(`Shard: ${shardAddress}`);
    console.log(`Deployer: ${wallet.address}`);
    
    // Check ETH balance
    const ethBalance = await provider.getBalance(wallet.address);
    console.log(`\n💰 ETH balance: ${ethers.formatEther(ethBalance)} ETH`);
    
    // Get contract instances
    const SAMMPool = await ethers.getContractFactory("SAMMPool");
    const shard = SAMMPool.attach(shardAddress);
    
    const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
    const tokenA = MockERC20.attach(tokenAAddress);
    const tokenB = MockERC20.attach(tokenBAddress);
    
    // Check shard basic info
    console.log("\n🔍 Checking shard info...");
    try {
      const tokenAFromShard = await shard.tokenA();
      const tokenBFromShard = await shard.tokenB();
      console.log(`Shard Token A: ${tokenAFromShard}`);
      console.log(`Shard Token B: ${tokenBFromShard}`);
      
      const owner = await shard.owner();
      console.log(`Shard Owner: ${owner}`);
      console.log(`Is deployer owner: ${owner.toLowerCase() === wallet.address.toLowerCase()}`);
      
      const initialized = await shard.initialized();
      console.log(`Initialized: ${initialized}`);
      
      if (initialized) {
        console.log("✅ Shard is already initialized!");
        const [reserveA, reserveB] = await shard.getReserves();
        console.log(`Reserve A: ${ethers.formatEther(reserveA)}`);
        console.log(`Reserve B: ${ethers.formatEther(reserveB)}`);
        return;
      }
      
    } catch (error) {
      console.log(`❌ Error checking shard info: ${error.message}`);
      return;
    }
    
    // Check token balances
    console.log("\n💰 Checking token balances...");
    try {
      const balanceA = await tokenA.balanceOf(wallet.address);
      const balanceB = await tokenB.balanceOf(wallet.address);
      console.log(`Token A balance: ${ethers.formatEther(balanceA)}`);
      console.log(`Token B balance: ${ethers.formatEther(balanceB)}`);
      
      // Mint tokens if needed
      if (balanceA === 0n) {
        console.log("Minting Token A...");
        const mintTx = await tokenA.mint(wallet.address, ethers.parseEther("1000"));
        await mintTx.wait(1);
        console.log("✅ Token A minted");
      }
      
      if (balanceB === 0n) {
        console.log("Minting Token B...");
        const mintTx = await tokenB.mint(wallet.address, ethers.parseEther("1000"));
        await mintTx.wait(1);
        console.log("✅ Token B minted");
      }
      
    } catch (error) {
      console.log(`❌ Error with tokens: ${error.message}`);
      return;
    }
    
    // Test initialization
    console.log("\n🚀 Testing initialization...");
    try {
      const testAmount = ethers.parseEther("10");
      
      // Approve tokens
      console.log("Approving tokens...");
      const approveTxA = await tokenA.approve(shardAddress, testAmount);
      await approveTxA.wait(1);
      console.log("✅ Token A approved");
      
      const approveTxB = await tokenB.approve(shardAddress, testAmount);
      await approveTxB.wait(1);
      console.log("✅ Token B approved");
      
      // Initialize
      console.log("Initializing shard...");
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
          gasLimit: 2000000
        }
      );
      
      console.log(`⏳ Transaction: ${initTx.hash}`);
      const receipt = await initTx.wait(1);
      console.log(`✅ Initialization successful! Gas: ${receipt.gasUsed}`);
      
      // Verify
      const initialized = await shard.initialized();
      console.log(`✅ Verified initialized: ${initialized}`);
      
      if (initialized) {
        const [reserveA, reserveB] = await shard.getReserves();
        console.log(`Reserve A: ${ethers.formatEther(reserveA)}`);
        console.log(`Reserve B: ${ethers.formatEther(reserveB)}`);
        
        // Get SAMM parameters
        const [beta1, rmin, rmax, c] = await shard.getSAMMParams();
        console.log(`\n📊 SAMM Parameters:`);
        console.log(`β1: ${beta1}`);
        console.log(`rmin: ${rmin}`);
        console.log(`rmax: ${rmax}`);
        console.log(`c: ${c}`);
        
        // Test a swap
        console.log("\n🔄 Testing swap...");
        const swapAmount = ethers.parseEther("1");
        const maxAmountIn = ethers.parseEther("10");
        
        const swapResult = await shard.calculateSwapSAMM(
          swapAmount,
          tokenAAddress,
          tokenBAddress
        );
        
        console.log(`Swap ${ethers.formatEther(swapAmount)} Token B:`);
        console.log(`Amount In: ${ethers.formatEther(swapResult.amountIn)} Token A`);
        console.log(`Trade Fee: ${ethers.formatEther(swapResult.tradeFee)} Token A`);
        
        const swapTx = await shard.swapSAMM(
          swapAmount,
          maxAmountIn,
          tokenAAddress,
          tokenBAddress,
          wallet.address,
          { gasLimit: 1000000 }
        );
        await swapTx.wait(1);
        console.log("✅ Swap successful!");
        
        const [finalReserveA, finalReserveB] = await shard.getReserves();
        console.log(`Final Reserve A: ${ethers.formatEther(finalReserveA)}`);
        console.log(`Final Reserve B: ${ethers.formatEther(finalReserveB)}`);
      }
      
    } catch (error) {
      console.log(`❌ Initialization failed: ${error.message}`);
      
      if (error.receipt) {
        console.log(`Gas used: ${error.receipt.gasUsed}`);
        console.log(`Status: ${error.receipt.status}`);
      }
      
      if (error.reason) {
        console.log(`Reason: ${error.reason}`);
      }
    }
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

testSingleShard()
  .then(() => {
    console.log("\n✅ Single shard test completed");
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Test failed:", error.message);
    process.exit(1);
  });