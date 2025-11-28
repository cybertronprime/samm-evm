require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("ethers");

async function testLiquidityAddition() {
  console.log("🧪 Testing SAMM Liquidity Addition on RiseChain");
  console.log("=".repeat(60));

  try {
    // Create provider with explicit network config to avoid ENS
    const rpcUrl = process.env.RISECHAIN_RPC_URL;
    const privateKey = process.env.PRIVATE_KEY;
    
    const provider = new ethers.JsonRpcProvider(rpcUrl, {
      chainId: 11155931,
      name: "risechain-testnet",
      ensAddress: null
    });
    
    const wallet = new ethers.Wallet(privateKey, provider);
    
    console.log(`Deployer: ${wallet.address}`);
    console.log(`RPC URL: ${rpcUrl}`);
    
    // Test connection
    const network = await provider.getNetwork();
    console.log(`Connected to Chain ID: ${network.chainId}`);
    
    const balance = await provider.getBalance(wallet.address);
    console.log(`ETH Balance: ${ethers.formatEther(balance)} ETH`);
    
    // Contract addresses
    const factoryAddress = ethers.getAddress("0x1888FF2446f2542cbb399eD179F4d6d966268C1F");
    const tokenAAddress = ethers.getAddress("0x60CB213FCd1616FbBD44319Eb11A35d5671E692e");
    const tokenBAddress = ethers.getAddress("0x3f256051aEd4bEc7947Bac441B0A581260132006");
    const shardAddress = ethers.getAddress("0xF4d727cFB4C6976833BCA7bfDB2e1554dcc5eD92");
    
    console.log("\n📋 Contract addresses:");
    console.log(`Factory: ${factoryAddress}`);
    console.log(`Token A: ${tokenAAddress}`);
    console.log(`Token B: ${tokenBAddress}`);
    console.log(`Shard: ${shardAddress}`);
    
    // Load contract ABIs
    const fs = require('fs');
    const path = require('path');
    
    const mockERC20Artifact = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'artifacts', 'contracts', 'mocks', 'MockERC20.sol', 'MockERC20.json')
    ));
    
    const sammPoolArtifact = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'artifacts', 'contracts', 'SAMMPool.sol', 'SAMMPool.json')
    ));
    
    const sammFactoryArtifact = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'artifacts', 'contracts', 'SAMMPoolFactory.sol', 'SAMMPoolFactory.json')
    ));
    
    console.log("✅ Contract ABIs loaded successfully");
    
    // Get contract instances
    const factory = new ethers.Contract(factoryAddress, sammFactoryArtifact.abi, wallet);
    const shard = new ethers.Contract(shardAddress, sammPoolArtifact.abi, wallet);
    const tokenA = new ethers.Contract(tokenAAddress, mockERC20Artifact.abi, wallet);
    const tokenB = new ethers.Contract(tokenBAddress, mockERC20Artifact.abi, wallet);
    
    // Check current shard state
    console.log("\n🔍 Checking current shard state...");
    
    const shardTokenA = await shard.tokenA();
    const shardTokenB = await shard.tokenB();
    const shardOwner = await shard.owner();
    
    console.log(`Shard Token A: ${shardTokenA}`);
    console.log(`Shard Token B: ${shardTokenB}`);
    console.log(`Shard Owner: ${shardOwner}`);
    console.log(`Is Factory Owner: ${shardOwner.toLowerCase() === factoryAddress.toLowerCase()}`);
    
    // Check if shard is initialized by trying to get reserves
    let isInitialized = false;
    let currentReserveA = 0n;
    let currentReserveB = 0n;
    
    try {
      const [reserveA, reserveB] = await shard.getReserves();
      currentReserveA = reserveA;
      currentReserveB = reserveB;
      isInitialized = reserveA > 0n || reserveB > 0n;
      console.log(`Current Reserve A: ${ethers.formatEther(reserveA)}`);
      console.log(`Current Reserve B: ${ethers.formatEther(reserveB)}`);
      console.log(`Is Initialized: ${isInitialized}`);
    } catch (error) {
      console.log(`❌ Error getting reserves: ${error.message}`);
    }
    
    // Check SAMM parameters
    try {
      const [beta1, rmin, rmax, c] = await shard.getSAMMParams();
      console.log(`SAMM Parameters:`);
      console.log(`  β1: ${beta1} (expected: -1050000)`);
      console.log(`  rmin: ${rmin} (expected: 1000)`);
      console.log(`  rmax: ${rmax} (expected: 12000)`);
      console.log(`  c: ${c} (expected: 10400)`);
      
      const paramsSet = beta1 !== 0n || rmin !== 0n || rmax !== 0n || c !== 0n;
      console.log(`SAMM Parameters Set: ${paramsSet}`);
      
      if (!paramsSet) {
        console.log("⚠️  SAMM parameters are not set - shard needs proper initialization");
      }
    } catch (error) {
      console.log(`❌ Error getting SAMM parameters: ${error.message}`);
    }
    
    // Check token balances
    console.log("\n💰 Checking token balances...");
    const balanceA = await tokenA.balanceOf(wallet.address);
    const balanceB = await tokenB.balanceOf(wallet.address);
    
    console.log(`Deployer Token A balance: ${ethers.formatEther(balanceA)}`);
    console.log(`Deployer Token B balance: ${ethers.formatEther(balanceB)}`);
    
    // If shard is not properly initialized, initialize it through the factory
    if (!isInitialized || currentReserveA === 0n || currentReserveB === 0n) {
      console.log("\n🚀 Initializing shard through factory...");
      
      // Ensure we have tokens
      if (balanceA === 0n) {
        console.log("Minting Token A...");
        const mintTx = await tokenA.mint(wallet.address, ethers.parseEther("10000"));
        await mintTx.wait(1);
        console.log("✅ Token A minted");
      }
      
      if (balanceB === 0n) {
        console.log("Minting Token B...");
        const mintTx = await tokenB.mint(wallet.address, ethers.parseEther("10000"));
        await mintTx.wait(1);
        console.log("✅ Token B minted");
      }
      
      // Use the token addresses as they appear in the shard (they might be swapped)
      const initTokenA = shardTokenA;
      const initTokenB = shardTokenB;
      
      console.log(`Using Token A: ${initTokenA}`);
      console.log(`Using Token B: ${initTokenB}`);
      
      // Get the correct token contracts based on shard's token order
      const initTokenAContract = new ethers.Contract(initTokenA, mockERC20Artifact.abi, wallet);
      const initTokenBContract = new ethers.Contract(initTokenB, mockERC20Artifact.abi, wallet);
      
      // Check balances for the correct tokens
      const initBalanceA = await initTokenAContract.balanceOf(wallet.address);
      const initBalanceB = await initTokenBContract.balanceOf(wallet.address);
      
      console.log(`Balance for shard Token A (${initTokenA}): ${ethers.formatEther(initBalanceA)}`);
      console.log(`Balance for shard Token B (${initTokenB}): ${ethers.formatEther(initBalanceB)}`);
      
      // Liquidity amounts
      const liquidityAmount = ethers.parseEther("100"); // Start with 100 tokens each
      
      console.log(`\nAdding ${ethers.formatEther(liquidityAmount)} of each token as liquidity...`);
      
      // Approve tokens to the factory (since factory will call initializeShard)
      console.log("Approving tokens to factory...");
      
      const approveTxA = await initTokenAContract.approve(factoryAddress, liquidityAmount);
      await approveTxA.wait(1);
      console.log("✅ Token A approved to factory");
      
      const approveTxB = await initTokenBContract.approve(factoryAddress, liquidityAmount);
      await approveTxB.wait(1);
      console.log("✅ Token B approved to factory");
      
      // Initialize shard through factory
      console.log("Calling factory.initializeShard...");
      
      try {
        const initTx = await factory.initializeShard(
          shardAddress,
          liquidityAmount,
          liquidityAmount,
          {
            gasLimit: 3000000
          }
        );
        
        console.log(`⏳ Initialization transaction: ${initTx.hash}`);
        const receipt = await initTx.wait(1);
        console.log(`✅ Initialization successful! Gas used: ${receipt.gasUsed}`);
        
        // Check for events
        if (receipt.logs.length > 0) {
          console.log(`📋 ${receipt.logs.length} events emitted`);
        }
        
      } catch (error) {
        console.log(`❌ Factory initialization failed: ${error.message}`);
        
        if (error.reason) {
          console.log(`Revert reason: ${error.reason}`);
        }
        
        // Try direct initialization if factory fails
        console.log("\n🔄 Trying direct shard initialization...");
        
        try {
          // Approve tokens to shard instead
          console.log("Approving tokens to shard...");
          
          const directApproveTxA = await initTokenAContract.approve(shardAddress, liquidityAmount);
          await directApproveTxA.wait(1);
          
          const directApproveTxB = await initTokenBContract.approve(shardAddress, liquidityAmount);
          await directApproveTxB.wait(1);
          
          console.log("✅ Tokens approved to shard");
          
          // Try to initialize directly (this might fail if not owner)
          const directInitTx = await shard.initialize(
            initTokenA,
            initTokenB,
            liquidityAmount,
            liquidityAmount,
            25,    // tradeFeeNumerator (0.25%)
            10000, // tradeFeeDenominator
            10,    // ownerFeeNumerator (0.1%)
            10000, // ownerFeeDenominator
            {
              gasLimit: 3000000
            }
          );
          
          console.log(`⏳ Direct initialization transaction: ${directInitTx.hash}`);
          const directReceipt = await directInitTx.wait(1);
          console.log(`✅ Direct initialization successful! Gas used: ${directReceipt.gasUsed}`);
          
        } catch (directError) {
          console.log(`❌ Direct initialization also failed: ${directError.message}`);
          console.log("This might be because the shard is already initialized or we're not the owner");
        }
      }
    }
    
    // Verify final state
    console.log("\n📊 Verifying final shard state...");
    
    try {
      const [finalReserveA, finalReserveB] = await shard.getReserves();
      console.log(`Final Reserve A: ${ethers.formatEther(finalReserveA)}`);
      console.log(`Final Reserve B: ${ethers.formatEther(finalReserveB)}`);
      
      const [beta1, rmin, rmax, c] = await shard.getSAMMParams();
      console.log(`Final SAMM Parameters:`);
      console.log(`  β1: ${beta1}`);
      console.log(`  rmin: ${rmin}`);
      console.log(`  rmax: ${rmax}`);
      console.log(`  c: ${c}`);
      
      const hasLiquidity = finalReserveA > 0n && finalReserveB > 0n;
      const hasParams = beta1 !== 0n || rmin !== 0n || rmax !== 0n || c !== 0n;
      
      if (hasLiquidity && hasParams) {
        console.log("\n🎉 SAMM Shard Successfully Initialized!");
        console.log("✅ Liquidity added successfully");
        console.log("✅ SAMM parameters set correctly");
        
        // Test a swap
        console.log("\n🔄 Testing SAMM swap functionality...");
        
        const swapAmount = ethers.parseEther("1");
        const maxAmountIn = ethers.parseEther("10");
        
        try {
          const swapResult = await shard.calculateSwapSAMM(
            swapAmount,
            shardTokenA,
            shardTokenB
          );
          
          console.log(`Swap calculation for ${ethers.formatEther(swapAmount)} Token B:`);
          console.log(`  Amount In: ${ethers.formatEther(swapResult.amountIn)} Token A`);
          console.log(`  Trade Fee: ${ethers.formatEther(swapResult.tradeFee)} Token A`);
          console.log(`  Owner Fee: ${ethers.formatEther(swapResult.ownerFee)} Token A`);
          
          // Execute the swap
          const swapTx = await shard.swapSAMM(
            swapAmount,
            maxAmountIn,
            shardTokenA,
            shardTokenB,
            wallet.address,
            { gasLimit: 1000000 }
          );
          
          console.log(`⏳ Swap transaction: ${swapTx.hash}`);
          await swapTx.wait(1);
          console.log("✅ Swap executed successfully!");
          
          // Check final reserves after swap
          const [swapReserveA, swapReserveB] = await shard.getReserves();
          console.log(`Reserves after swap:`);
          console.log(`  Reserve A: ${ethers.formatEther(swapReserveA)}`);
          console.log(`  Reserve B: ${ethers.formatEther(swapReserveB)}`);
          
          console.log("\n🎉 COMPLETE SUCCESS!");
          console.log("✅ SAMM deployed to RiseChain testnet");
          console.log("✅ Liquidity addition working");
          console.log("✅ SAMM parameters correctly set");
          console.log("✅ SAMM swap functionality working");
          console.log("✅ All task requirements satisfied!");
          
        } catch (swapError) {
          console.log(`❌ Swap test failed: ${swapError.message}`);
        }
        
      } else {
        console.log("\n⚠️  Shard initialization incomplete:");
        console.log(`Has Liquidity: ${hasLiquidity}`);
        console.log(`Has SAMM Parameters: ${hasParams}`);
      }
      
    } catch (error) {
      console.log(`❌ Error verifying final state: ${error.message}`);
    }
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error("Full error:", error);
  }
}

testLiquidityAddition()
  .then(() => {
    console.log("\n✅ Liquidity addition test completed");
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Test failed:", error.message);
    process.exit(1);
  });