const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { 
  createProvider, 
  validateDeployerBalance, 
  getDeploymentParams 
} = require("../config/deployment-config");

/**
 * Comprehensive end-to-end test for Sepolia deployment
 */
async function testSepoliaEndToEnd() {
  console.log("🧪 SAMM Sepolia End-to-End Test");
  console.log("=".repeat(60));

  const networkName = "sepolia";
  const testResults = {
    networkName,
    timestamp: new Date().toISOString(),
    tests: {},
    overall: false,
    deploymentInfo: null
  };

  try {
    // Test 1: Environment and connectivity
    console.log("\n1️⃣ Testing environment and connectivity...");
    const { provider, wallet, config } = createProvider(networkName);
    const network = await provider.getNetwork();
    
    console.log(`✅ Connected to ${config.name} (Chain ID: ${network.chainId})`);
    console.log(`✅ Deployer wallet: ${wallet.address}`);
    
    testResults.tests.connectivity = {
      passed: true,
      chainId: Number(network.chainId),
      deployer: wallet.address
    };

    // Test 2: Balance validation
    console.log("\n2️⃣ Validating deployer balance...");
    const balanceCheck = await validateDeployerBalance(provider, wallet.address, networkName);
    
    if (!balanceCheck.isValid) {
      throw new Error(`Insufficient balance: ${balanceCheck.balanceEth} ETH (need ${balanceCheck.minRequiredEth} ETH)`);
    }
    
    console.log(`✅ Balance sufficient: ${balanceCheck.balanceEth} ETH`);
    testResults.tests.balance = {
      passed: true,
      balance: balanceCheck.balanceEth,
      required: balanceCheck.minRequiredEth
    };

    // Test 3: Contract deployment
    console.log("\n3️⃣ Deploying SAMM contracts...");
    
    // Deploy factory
    const SAMMPoolFactory = await ethers.getContractFactory("SAMMPoolFactory", wallet);
    const factory = await SAMMPoolFactory.deploy();
    await factory.waitForDeployment();
    
    const factoryAddress = await factory.getAddress();
    console.log(`✅ SAMM Factory deployed: ${factoryAddress}`);
    
    // Deploy test tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
    
    const tokenA = await MockERC20.deploy("Sepolia Test Token A", "SEPA", 18);
    await tokenA.waitForDeployment();
    
    const tokenB = await MockERC20.deploy("Sepolia Test Token B", "SEPB", 18);
    await tokenB.waitForDeployment();
    
    const tokenAAddress = await tokenA.getAddress();
    const tokenBAddress = await tokenB.getAddress();
    
    console.log(`✅ Test Token A: ${tokenAAddress}`);
    console.log(`✅ Test Token B: ${tokenBAddress}`);
    
    testResults.tests.deployment = {
      passed: true,
      contracts: {
        factory: factoryAddress,
        tokenA: tokenAAddress,
        tokenB: tokenBAddress
      }
    };

    // Test 4: Shard creation
    console.log("\n4️⃣ Creating and testing shard...");
    
    const createTx = await factory.createShardDefault(tokenAAddress, tokenBAddress);
    const receipt = await createTx.wait();
    
    const shardCreatedEvent = receipt.logs.find(
      log => log.fragment && log.fragment.name === "ShardCreated"
    );
    const shardAddress = shardCreatedEvent.args[0];
    
    console.log(`✅ Shard created: ${shardAddress}`);
    
    // Get shard contract
    const SAMMPool = await ethers.getContractFactory("SAMMPool");
    const shard = SAMMPool.attach(shardAddress);
    
    testResults.tests.shardCreation = {
      passed: true,
      shardAddress: shardAddress
    };

    // Test 5: SAMM parameter verification
    console.log("\n5️⃣ Verifying SAMM parameters...");
    
    const [beta1, rmin, rmax, c] = await shard.getSAMMParams();
    const deploymentParams = getDeploymentParams(networkName);
    
    const expectedParams = deploymentParams.sammParameters;
    const actualParams = {
      beta1: Number(beta1),
      rmin: Number(rmin),
      rmax: Number(rmax),
      c: Number(c)
    };
    
    console.log(`✅ SAMM Parameters:`);
    console.log(`   β1: ${actualParams.beta1} (expected: ${expectedParams.beta1})`);
    console.log(`   rmin: ${actualParams.rmin} (expected: ${expectedParams.rmin})`);
    console.log(`   rmax: ${actualParams.rmax} (expected: ${expectedParams.rmax})`);
    console.log(`   c: ${actualParams.c} (expected: ${expectedParams.c})`);
    
    const paramsMatch = 
      actualParams.beta1 === expectedParams.beta1 &&
      actualParams.rmin === expectedParams.rmin &&
      actualParams.rmax === expectedParams.rmax &&
      actualParams.c === expectedParams.c;
    
    if (!paramsMatch) {
      throw new Error("SAMM parameters do not match expected values");
    }
    
    console.log("✅ All SAMM parameters verified");
    testResults.tests.sammParameters = {
      passed: true,
      expected: expectedParams,
      actual: actualParams
    };

    // Test 6: Token minting and approval
    console.log("\n6️⃣ Minting tokens and setting up liquidity...");
    
    const mintAmount = ethers.parseEther("100000");
    await tokenA.mint(wallet.address, mintAmount);
    await tokenB.mint(wallet.address, mintAmount);
    
    console.log(`✅ Minted ${ethers.formatEther(mintAmount)} tokens each`);
    
    // Approve tokens for shard
    await tokenA.approve(shardAddress, mintAmount);
    await tokenB.approve(shardAddress, mintAmount);
    
    console.log("✅ Tokens approved for shard");
    
    testResults.tests.tokenSetup = {
      passed: true,
      mintAmount: ethers.formatEther(mintAmount)
    };

    // Test 7: Liquidity addition
    console.log("\n7️⃣ Adding initial liquidity...");
    
    const liquidityAmount = ethers.parseEther("1000");
    const initTx = await factory.initializeShard(
      shardAddress,
      liquidityAmount,
      liquidityAmount
    );
    await initTx.wait();
    
    console.log(`✅ Added ${ethers.formatEther(liquidityAmount)} tokens liquidity`);
    
    // Verify reserves
    const [reserveA, reserveB] = await shard.getReserves();
    console.log(`✅ Pool reserves: ${ethers.formatEther(reserveA)} A, ${ethers.formatEther(reserveB)} B`);
    
    testResults.tests.liquidityAddition = {
      passed: true,
      liquidityAmount: ethers.formatEther(liquidityAmount),
      reserves: {
        tokenA: ethers.formatEther(reserveA),
        tokenB: ethers.formatEther(reserveB)
      }
    };

    // Test 8: SAMM swap calculation
    console.log("\n8️⃣ Testing SAMM swap calculations...");
    
    const swapAmount = ethers.parseEther("10");
    const swapResult = await shard.calculateSwapSAMM(
      swapAmount,
      tokenAAddress,
      tokenBAddress
    );
    
    console.log(`📊 Swap calculation (${ethers.formatEther(swapAmount)} Token B):`);
    console.log(`   Amount In: ${ethers.formatEther(swapResult.amountIn)} Token A`);
    console.log(`   Trade Fee: ${ethers.formatEther(swapResult.tradeFee)} Token A`);
    console.log(`   Owner Fee: ${ethers.formatEther(swapResult.ownerFee)} Token A`);
    
    // Verify fee calculation is reasonable
    const feePercentage = (Number(swapResult.tradeFee) / Number(swapResult.amountIn)) * 100;
    if (feePercentage < 0.1 || feePercentage > 5) {
      throw new Error(`Unreasonable fee percentage: ${feePercentage.toFixed(4)}%`);
    }
    
    console.log(`✅ Fee percentage: ${feePercentage.toFixed(4)}% (reasonable)`);
    
    testResults.tests.swapCalculation = {
      passed: true,
      swapAmount: ethers.formatEther(swapAmount),
      amountIn: ethers.formatEther(swapResult.amountIn),
      tradeFee: ethers.formatEther(swapResult.tradeFee),
      ownerFee: ethers.formatEther(swapResult.ownerFee),
      feePercentage: feePercentage
    };

    // Test 9: Actual swap execution
    console.log("\n9️⃣ Executing actual swap...");
    
    const maxAmountIn = ethers.parseEther("100");
    const balanceABefore = await tokenA.balanceOf(wallet.address);
    const balanceBBefore = await tokenB.balanceOf(wallet.address);
    
    const swapTx = await shard.swapSAMM(
      swapAmount,
      maxAmountIn,
      tokenAAddress,
      tokenBAddress,
      wallet.address
    );
    await swapTx.wait();
    
    const balanceAAfter = await tokenA.balanceOf(wallet.address);
    const balanceBAfter = await tokenB.balanceOf(wallet.address);
    
    const actualAmountIn = balanceABefore - balanceAAfter;
    const actualAmountOut = balanceBAfter - balanceBBefore;
    
    console.log(`✅ Swap executed successfully`);
    console.log(`   Actual Amount In: ${ethers.formatEther(actualAmountIn)} Token A`);
    console.log(`   Actual Amount Out: ${ethers.formatEther(actualAmountOut)} Token B`);
    
    // Verify swap amounts are close to calculated
    const amountInDiff = Math.abs(Number(actualAmountIn) - Number(swapResult.amountIn));
    const amountOutDiff = Math.abs(Number(actualAmountOut) - Number(swapAmount));
    
    if (amountInDiff > Number(ethers.parseEther("0.01")) || amountOutDiff > Number(ethers.parseEther("0.01"))) {
      throw new Error("Swap amounts differ significantly from calculations");
    }
    
    console.log("✅ Swap amounts match calculations");
    
    testResults.tests.swapExecution = {
      passed: true,
      expectedAmountIn: ethers.formatEther(swapResult.amountIn),
      actualAmountIn: ethers.formatEther(actualAmountIn),
      expectedAmountOut: ethers.formatEther(swapAmount),
      actualAmountOut: ethers.formatEther(actualAmountOut)
    };

    // Test 10: Pool state after swap
    console.log("\n🔟 Verifying pool state after swap...");
    
    const [newReserveA, newReserveB] = await shard.getReserves();
    console.log(`✅ New reserves: ${ethers.formatEther(newReserveA)} A, ${ethers.formatEther(newReserveB)} B`);
    
    // Verify reserves changed appropriately
    const reserveAChange = Number(reserveA) - Number(newReserveA);
    const reserveBChange = Number(newReserveB) - Number(reserveB);
    
    if (Math.abs(reserveAChange - Number(actualAmountIn)) > Number(ethers.parseEther("0.01"))) {
      throw new Error("Reserve A change doesn't match swap amount");
    }
    
    if (Math.abs(reserveBChange - Number(actualAmountOut)) > Number(ethers.parseEther("0.01"))) {
      throw new Error("Reserve B change doesn't match swap amount");
    }
    
    console.log("✅ Pool reserves updated correctly");
    
    testResults.tests.poolState = {
      passed: true,
      initialReserves: {
        tokenA: ethers.formatEther(reserveA),
        tokenB: ethers.formatEther(reserveB)
      },
      finalReserves: {
        tokenA: ethers.formatEther(newReserveA),
        tokenB: ethers.formatEther(newReserveB)
      }
    };

    // Save deployment info for future use
    testResults.deploymentInfo = {
      network: config.name,
      chainId: Number(network.chainId),
      deployer: wallet.address,
      contracts: {
        factory: factoryAddress,
        tokenA: tokenAAddress,
        tokenB: tokenBAddress,
        testShard: shardAddress
      },
      sammParameters: actualParams
    };

    testResults.overall = true;
    
    console.log("\n🎉 ALL TESTS PASSED!");
    console.log("=".repeat(60));
    console.log("✅ Sepolia end-to-end test completed successfully");
    console.log("\n📋 Deployment Summary:");
    console.log(`Factory: ${factoryAddress}`);
    console.log(`Test Shard: ${shardAddress}`);
    console.log(`Block Explorer: https://sepolia.etherscan.io/address/${factoryAddress}`);

  } catch (error) {
    testResults.overall = false;
    testResults.error = error.message;
    
    console.error("\n❌ TEST FAILED:");
    console.error(error.message);
    throw error;
  }

  // Save test results
  const resultsPath = path.join(__dirname, "..", "test-results", `sepolia-e2e-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
  fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
  
  console.log(`\n📄 Test results saved to: ${resultsPath}`);
  
  return testResults;
}

// CLI execution
async function main() {
  try {
    const results = await testSepoliaEndToEnd();
    
    if (results.overall) {
      console.log("\n🚀 Ready to proceed with other testnets!");
      process.exit(0);
    } else {
      console.log("\n⚠️ Fix issues before proceeding to other networks");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n💥 End-to-end test failed:", error.message);
    process.exit(1);
  }
}

// Export for use in other scripts
module.exports = {
  testSepoliaEndToEnd
};

// Run if called directly
if (require.main === module) {
  main();
}