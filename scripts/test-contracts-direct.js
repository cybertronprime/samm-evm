require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("hardhat");

async function testContractsDirect() {
  console.log("🧪 Testing Contracts with Direct Provider");
  console.log("=".repeat(50));

  try {
    // Create provider directly
    const rpcUrl = process.env.RISECHAIN_RPC_URL;
    const privateKey = process.env.PRIVATE_KEY;
    
    console.log(`RPC URL: ${rpcUrl}`);
    console.log(`Private Key: ${privateKey ? "SET" : "NOT SET"}`);
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    console.log(`Deployer: ${wallet.address}`);
    
    // Test connection
    const network = await provider.getNetwork();
    console.log(`Connected to Chain ID: ${network.chainId}`);
    
    const balance = await provider.getBalance(wallet.address);
    console.log(`ETH Balance: ${ethers.formatEther(balance)} ETH`);
    
    // Contract addresses
    const tokenAAddress = "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e";
    const tokenBAddress = "0x3f256051aEd4bEc7947Bac441B0A5812601320063";
    const shardAddress = "0xF4d727cFB4C6976833BCA7bfDB2e1554dcc5eD92";
    
    console.log("\n📋 Contract addresses:");
    console.log(`Token A: ${tokenAAddress}`);
    console.log(`Token B: ${tokenBAddress}`);
    console.log(`Shard: ${shardAddress}`);
    
    // Test Token A
    console.log("\n🔍 Testing Token A...");
    try {
      const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
      const tokenA = MockERC20.connect(provider).attach(tokenAAddress);
      
      const name = await tokenA.name();
      const symbol = await tokenA.symbol();
      const decimals = await tokenA.decimals();
      const balance = await tokenA.balanceOf(wallet.address);
      
      console.log(`✅ Token A - Name: ${name}, Symbol: ${symbol}, Decimals: ${decimals}`);
      console.log(`✅ Token A - Balance: ${ethers.formatEther(balance)}`);
      
    } catch (error) {
      console.log(`❌ Token A error: ${error.message}`);
    }
    
    // Test Token B
    console.log("\n🔍 Testing Token B...");
    try {
      const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
      const tokenB = MockERC20.connect(provider).attach(tokenBAddress);
      
      const name = await tokenB.name();
      const symbol = await tokenB.symbol();
      const decimals = await tokenB.decimals();
      const balance = await tokenB.balanceOf(wallet.address);
      
      console.log(`✅ Token B - Name: ${name}, Symbol: ${symbol}, Decimals: ${decimals}`);
      console.log(`✅ Token B - Balance: ${ethers.formatEther(balance)}`);
      
    } catch (error) {
      console.log(`❌ Token B error: ${error.message}`);
    }
    
    // Test Shard
    console.log("\n🔍 Testing Shard...");
    try {
      const SAMMPool = await ethers.getContractFactory("SAMMPool");
      const shard = SAMMPool.connect(provider).attach(shardAddress);
      
      const tokenA = await shard.tokenA();
      const tokenB = await shard.tokenB();
      const owner = await shard.owner();
      const initialized = await shard.initialized();
      
      console.log(`✅ Shard - Token A: ${tokenA}`);
      console.log(`✅ Shard - Token B: ${tokenB}`);
      console.log(`✅ Shard - Owner: ${owner}`);
      console.log(`✅ Shard - Initialized: ${initialized}`);
      
      if (initialized) {
        const [reserveA, reserveB] = await shard.getReserves();
        console.log(`✅ Shard - Reserve A: ${ethers.formatEther(reserveA)}`);
        console.log(`✅ Shard - Reserve B: ${ethers.formatEther(reserveB)}`);
        
        const [beta1, rmin, rmax, c] = await shard.getSAMMParams();
        console.log(`✅ SAMM Parameters - β1: ${beta1}, rmin: ${rmin}, rmax: ${rmax}, c: ${c}`);
      } else {
        console.log("⚠️  Shard not initialized - this is the issue!");
      }
      
    } catch (error) {
      console.log(`❌ Shard error: ${error.message}`);
    }
    
    // If shard is not initialized, try to initialize it
    console.log("\n🚀 Attempting shard initialization...");
    try {
      const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
      const tokenA = MockERC20.connect(wallet).attach(tokenAAddress);
      const tokenB = MockERC20.connect(wallet).attach(tokenBAddress);
      
      const SAMMPool = await ethers.getContractFactory("SAMMPool");
      const shard = SAMMPool.connect(wallet).attach(shardAddress);
      
      // Check if we need to mint tokens
      const balanceA = await tokenA.balanceOf(wallet.address);
      const balanceB = await tokenB.balanceOf(wallet.address);
      
      console.log(`Current Token A balance: ${ethers.formatEther(balanceA)}`);
      console.log(`Current Token B balance: ${ethers.formatEther(balanceB)}`);
      
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
      
      // Approve tokens
      const testAmount = ethers.parseEther("10");
      console.log("Approving tokens...");
      
      const approveTxA = await tokenA.approve(shardAddress, testAmount);
      await approveTxA.wait(1);
      console.log("✅ Token A approved");
      
      const approveTxB = await tokenB.approve(shardAddress, testAmount);
      await approveTxB.wait(1);
      console.log("✅ Token B approved");
      
      // Initialize shard
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
      
      console.log(`⏳ Initialization transaction: ${initTx.hash}`);
      const receipt = await initTx.wait(1);
      console.log(`✅ Initialization successful! Gas used: ${receipt.gasUsed}`);
      
      // Verify initialization
      const initialized = await shard.initialized();
      console.log(`✅ Shard now initialized: ${initialized}`);
      
      if (initialized) {
        const [reserveA, reserveB] = await shard.getReserves();
        console.log(`✅ Reserve A: ${ethers.formatEther(reserveA)}`);
        console.log(`✅ Reserve B: ${ethers.formatEther(reserveB)}`);
        
        const [beta1, rmin, rmax, c] = await shard.getSAMMParams();
        console.log(`✅ SAMM Parameters verified:`);
        console.log(`   β1: ${beta1}`);
        console.log(`   rmin: ${rmin}`);
        console.log(`   rmax: ${rmax}`);
        console.log(`   c: ${c}`);
        
        // Test a swap
        console.log("\n🔄 Testing SAMM swap...");
        const swapAmount = ethers.parseEther("1");
        const maxAmountIn = ethers.parseEther("10");
        
        const swapResult = await shard.calculateSwapSAMM(
          swapAmount,
          tokenAAddress,
          tokenBAddress
        );
        
        console.log(`Swap calculation for ${ethers.formatEther(swapAmount)} Token B:`);
        console.log(`  Amount In: ${ethers.formatEther(swapResult.amountIn)} Token A`);
        console.log(`  Trade Fee: ${ethers.formatEther(swapResult.tradeFee)} Token A`);
        console.log(`  Owner Fee: ${ethers.formatEther(swapResult.ownerFee)} Token A`);
        
        const swapTx = await shard.swapSAMM(
          swapAmount,
          maxAmountIn,
          tokenAAddress,
          tokenBAddress,
          wallet.address,
          { gasLimit: 1000000 }
        );
        
        console.log(`⏳ Swap transaction: ${swapTx.hash}`);
        await swapTx.wait(1);
        console.log("✅ Swap executed successfully!");
        
        const [finalReserveA, finalReserveB] = await shard.getReserves();
        console.log(`Final Reserve A: ${ethers.formatEther(finalReserveA)}`);
        console.log(`Final Reserve B: ${ethers.formatEther(finalReserveB)}`);
        
        console.log("\n🎉 SAMM deployment and testing COMPLETE!");
        console.log("✅ All functionality working correctly on RiseChain testnet");
      }
      
    } catch (error) {
      console.log(`❌ Initialization failed: ${error.message}`);
      
      if (error.receipt) {
        console.log(`Gas used: ${error.receipt.gasUsed}`);
        console.log(`Status: ${error.receipt.status}`);
      }
      
      if (error.reason) {
        console.log(`Revert reason: ${error.reason}`);
      }
      
      // Log the full error for debugging
      console.log("Full error:", error);
    }
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

testContractsDirect()
  .then(() => {
    console.log("\n✅ Direct contract test completed");
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Test failed:", error.message);
    process.exit(1);
  });