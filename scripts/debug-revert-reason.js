require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("ethers");

async function debugRevertReason() {
  console.log("🔍 Debugging Exact Revert Reason");
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
    
    // Use the newly created shard
    const factoryAddress = ethers.getAddress("0x1888FF2446f2542cbb399eD179F4d6d966268C1F");
    const shardAddress = ethers.getAddress("0x42A88f388cc3C1f6ACBeB4d753A9B778c82a632E");
    const tokenAAddress = ethers.getAddress("0x60CB213FCd1616FbBD44319Eb11A35d5671E692e");
    const tokenBAddress = ethers.getAddress("0x3f256051aEd4bEc7947Bac441B0A581260132006");
    
    console.log(`Factory: ${factoryAddress}`);
    console.log(`Shard: ${shardAddress}`);
    
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
    
    // Check all preconditions
    console.log("\n🔍 Checking all preconditions...");
    
    // 1. Factory ownership
    const factoryOwner = await factory.owner();
    console.log(`1. Factory Owner: ${factoryOwner}`);
    console.log(`   Is Deployer Owner: ${factoryOwner.toLowerCase() === wallet.address.toLowerCase()}`);
    
    // 2. Shard info
    const shardInfo = await factory.getShardInfo(shardAddress);
    console.log(`2. Shard Creator: ${shardInfo.creator}`);
    console.log(`   Is Active: ${shardInfo.isActive}`);
    console.log(`   Token A: ${shardInfo.tokenA}`);
    console.log(`   Token B: ${shardInfo.tokenB}`);
    
    // 3. Authorization check
    const isCreator = shardInfo.creator.toLowerCase() === wallet.address.toLowerCase();
    const isOwner = factoryOwner.toLowerCase() === wallet.address.toLowerCase();
    console.log(`3. Authorization: Creator=${isCreator}, Owner=${isOwner}, Should Pass=${isCreator || isOwner}`);
    
    // 4. Shard state
    try {
      const [reserveA, reserveB] = await shard.getReserves();
      console.log(`4. Current Reserves: A=${ethers.formatEther(reserveA)}, B=${ethers.formatEther(reserveB)}`);
      
      // Check if already initialized by trying to call a function that requires initialization
      try {
        await shard.calculateSwapSAMM(ethers.parseEther("1"), shardInfo.tokenA, shardInfo.tokenB);
        console.log(`   Shard appears to be initialized (calculateSwapSAMM works)`);
      } catch (error) {
        if (error.message.includes("not initialized")) {
          console.log(`   Shard is NOT initialized (calculateSwapSAMM fails with 'not initialized')`);
        } else {
          console.log(`   Shard state unclear: ${error.message}`);
        }
      }
    } catch (error) {
      console.log(`4. Error getting reserves: ${error.message}`);
    }
    
    // 5. Token balances and approvals
    const tokenA = new ethers.Contract(shardInfo.tokenA, mockERC20Artifact.abi, wallet);
    const tokenB = new ethers.Contract(shardInfo.tokenB, mockERC20Artifact.abi, wallet);
    
    const balanceA = await tokenA.balanceOf(wallet.address);
    const balanceB = await tokenB.balanceOf(wallet.address);
    const allowanceA = await tokenA.allowance(wallet.address, factoryAddress);
    const allowanceB = await tokenB.allowance(wallet.address, factoryAddress);
    
    console.log(`5. Token Balances: A=${ethers.formatEther(balanceA)}, B=${ethers.formatEther(balanceB)}`);
    console.log(`   Token Allowances: A=${ethers.formatEther(allowanceA)}, B=${ethers.formatEther(allowanceB)}`);
    
    const liquidityAmount = ethers.parseEther("10");
    const hasEnoughBalance = balanceA >= liquidityAmount && balanceB >= liquidityAmount;
    const hasEnoughAllowance = allowanceA >= liquidityAmount && allowanceB >= liquidityAmount;
    
    console.log(`   Has Enough Balance: ${hasEnoughBalance}`);
    console.log(`   Has Enough Allowance: ${hasEnoughAllowance}`);
    
    // If we don't have enough allowance, approve
    if (!hasEnoughAllowance) {
      console.log("\n🔧 Setting up approvals...");
      
      if (allowanceA < liquidityAmount) {
        const approveTxA = await tokenA.approve(factoryAddress, liquidityAmount);
        await approveTxA.wait(1);
        console.log("✅ Token A approved");
      }
      
      if (allowanceB < liquidityAmount) {
        const approveTxB = await tokenB.approve(factoryAddress, liquidityAmount);
        await approveTxB.wait(1);
        console.log("✅ Token B approved");
      }
    }
    
    // Now try to call initializeShard with detailed error handling
    console.log("\n🧪 Testing initializeShard call...");
    
    try {
      // First, try to estimate gas to see if it would revert
      console.log("Estimating gas...");
      const gasEstimate = await factory.initializeShard.estimateGas(
        shardAddress,
        liquidityAmount,
        liquidityAmount
      );
      console.log(`✅ Gas estimate successful: ${gasEstimate}`);
      
      // If gas estimation works, the call should work too
      console.log("Executing initializeShard...");
      const initTx = await factory.initializeShard(
        shardAddress,
        liquidityAmount,
        liquidityAmount,
        {
          gasLimit: gasEstimate * 2n // Use 2x the estimate
        }
      );
      
      console.log(`⏳ Transaction: ${initTx.hash}`);
      const receipt = await initTx.wait(1);
      console.log(`✅ SUCCESS! Gas used: ${receipt.gasUsed}`);
      
      // Verify the result
      const [finalReserveA, finalReserveB] = await shard.getReserves();
      console.log(`Final Reserves: A=${ethers.formatEther(finalReserveA)}, B=${ethers.formatEther(finalReserveB)}`);
      
    } catch (error) {
      console.log(`❌ initializeShard failed: ${error.message}`);
      
      if (error.reason) {
        console.log(`Revert reason: ${error.reason}`);
      }
      
      if (error.code === 'CALL_EXCEPTION' && error.data) {
        console.log(`Error data: ${error.data}`);
      }
      
      // Try to decode the revert reason manually
      if (error.receipt && error.receipt.status === 0) {
        console.log("Transaction was mined but reverted");
        console.log(`Gas used: ${error.receipt.gasUsed}`);
        
        // Try to get more details by calling the function statically
        try {
          console.log("Trying static call to get revert reason...");
          await factory.initializeShard.staticCall(
            shardAddress,
            liquidityAmount,
            liquidityAmount
          );
        } catch (staticError) {
          console.log(`Static call error: ${staticError.message}`);
          if (staticError.reason) {
            console.log(`Static call revert reason: ${staticError.reason}`);
          }
        }
      }
    }
    
  } catch (error) {
    console.error("❌ Debug failed:", error.message);
  }
}

debugRevertReason()
  .then(() => {
    console.log("\n✅ Revert reason debug completed");
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Debug failed:", error.message);
    process.exit(1);
  });