require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("ethers");

async function debugSwapFailure() {
  console.log("🔍 Debugging Swap Failure");
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
    
    // Use the latest deployed contracts
    const shardAddress = "0x352e93935E98d2Eb18B0c705226c48c6a873A864";
    const tokenAAddress = "0x03E6C4f4d8869F89dFd92A34f79E9190F80F8db7";
    const tokenBAddress = "0x12CbF28E5ba4A4eABb574b3495f9b21C50fBf01E";
    
    console.log(`Shard: ${shardAddress}`);
    console.log(`Token A: ${tokenAAddress}`);
    console.log(`Token B: ${tokenBAddress}`);
    
    // Load ABIs
    const fs = require('fs');
    const path = require('path');
    
    const sammPoolArtifact = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'artifacts', 'contracts', 'SAMMPool.sol', 'SAMMPool.json')
    ));
    
    const mockERC20Artifact = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'artifacts', 'contracts', 'mocks', 'MockERC20.sol', 'MockERC20.json')
    ));
    
    const shard = new ethers.Contract(shardAddress, sammPoolArtifact.abi, wallet);
    const tokenA = new ethers.Contract(tokenAAddress, mockERC20Artifact.abi, wallet);
    const tokenB = new ethers.Contract(tokenBAddress, mockERC20Artifact.abi, wallet);
    
    // Check current state
    console.log("\n🔍 Checking current state...");
    
    const [reserveA, reserveB] = await shard.getReserves();
    console.log(`Reserves: A=${ethers.formatEther(reserveA)}, B=${ethers.formatEther(reserveB)}`);
    
    const shardTokenA = await shard.tokenA();
    const shardTokenB = await shard.tokenB();
    console.log(`Shard Token A: ${shardTokenA}`);
    console.log(`Shard Token B: ${shardTokenB}`);
    console.log(`Expected Token A: ${tokenAAddress}`);
    console.log(`Expected Token B: ${tokenBAddress}`);
    
    // Check token order - this might be the issue!
    const tokenAMatches = shardTokenA.toLowerCase() === tokenAAddress.toLowerCase();
    const tokenBMatches = shardTokenB.toLowerCase() === tokenBAddress.toLowerCase();
    
    console.log(`Token A matches: ${tokenAMatches}`);
    console.log(`Token B matches: ${tokenBMatches}`);
    
    if (!tokenAMatches || !tokenBMatches) {
      console.log("⚠️  TOKEN ORDER MISMATCH DETECTED!");
      console.log("The shard has different token order than expected.");
      
      // Determine correct order
      const actualTokenA = shardTokenA;
      const actualTokenB = shardTokenB;
      
      console.log(`Actual Token A: ${actualTokenA}`);
      console.log(`Actual Token B: ${actualTokenB}`);
      
      // Use correct tokens
      const correctTokenA = new ethers.Contract(actualTokenA, mockERC20Artifact.abi, wallet);
      const correctTokenB = new ethers.Contract(actualTokenB, mockERC20Artifact.abi, wallet);
      
      // Test swap with correct token order
      console.log("\n🔄 Testing swap with correct token order...");
      
      const swapAmount = ethers.parseEther("1");
      const maxAmountIn = ethers.parseEther("10");
      
      try {
        const swapResult = await shard.calculateSwapSAMM(
          swapAmount,
          actualTokenA,
          actualTokenB
        );
        
        console.log(`Swap calculation for ${ethers.formatEther(swapAmount)} Token B:`);
        console.log(`  Amount In: ${ethers.formatEther(swapResult.amountIn)} Token A`);
        console.log(`  Trade Fee: ${ethers.formatEther(swapResult.tradeFee)} Token A`);
        console.log(`  Owner Fee: ${ethers.formatEther(swapResult.ownerFee)} Token A`);
        
        // Check token balances
        const balanceA = await correctTokenA.balanceOf(wallet.address);
        const balanceB = await correctTokenB.balanceOf(wallet.address);
        const allowanceA = await correctTokenA.allowance(wallet.address, shardAddress);
        
        console.log(`Token balances: A=${ethers.formatEther(balanceA)}, B=${ethers.formatEther(balanceB)}`);
        console.log(`Token A allowance: ${ethers.formatEther(allowanceA)}`);
        
        // Approve if needed
        if (allowanceA < swapResult.amountIn) {
          console.log("Approving Token A for swap...");
          const approveTx = await correctTokenA.approve(shardAddress, swapResult.amountIn);
          await approveTx.wait(1);
          console.log("✅ Token A approved");
        }
        
        // Try the swap
        console.log("Executing swap...");
        const swapTx = await shard.swapSAMM(
          swapAmount,
          maxAmountIn,
          actualTokenA,
          actualTokenB,
          wallet.address,
          { gasLimit: 1000000 }
        );
        
        console.log(`⏳ Swap transaction: ${swapTx.hash}`);
        await swapTx.wait(1);
        console.log("✅ Swap executed successfully!");
        
        // Check final reserves
        const [finalReserveA, finalReserveB] = await shard.getReserves();
        console.log(`Final reserves: A=${ethers.formatEther(finalReserveA)}, B=${ethers.formatEther(finalReserveB)}`);
        
      } catch (swapError) {
        console.log(`❌ Swap failed: ${swapError.message}`);
        if (swapError.reason) {
          console.log(`Revert reason: ${swapError.reason}`);
        }
      }
    }
    
    // Also test with original order to see what happens
    console.log("\n🧪 Testing with original order for comparison...");
    
    const swapAmount = ethers.parseEther("1");
    
    try {
      const swapResult = await shard.calculateSwapSAMM(
        swapAmount,
        tokenAAddress,
        tokenBAddress
      );
      
      console.log("✅ Original order calculation works");
      console.log(`Amount In: ${ethers.formatEther(swapResult.amountIn)}`);
      
    } catch (calcError) {
      console.log(`❌ Original order calculation failed: ${calcError.message}`);
    }
    
  } catch (error) {
    console.error("❌ Debug failed:", error.message);
  }
}

debugSwapFailure()
  .then(() => {
    console.log("\n✅ Swap debug completed");
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Debug failed:", error.message);
    process.exit(1);
  });