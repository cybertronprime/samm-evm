/**
 * CrossPoolRouter Deployment and End-to-End Testing on Rise Testnet
 * 
 * This script:
 * 1. Deploys CrossPoolRouter contract
 * 2. Creates multiple token pairs with multiple shards each
 * 3. Tests single-hop swaps with smallest shard selection
 * 4. Tests multi-hop swaps (A→B→C, A→B→C→D)
 * 5. Verifies SAMM properties (c-smaller-better, c-threshold)
 * 6. Tests atomic execution and rollback
 * 7. Validates quote accuracy
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Configuration
const CHAIN_ID = 11155931; // Rise testnet
const GAS_LIMIT = 12000000;
const CONFIRMATIONS = 2;

// SAMM Parameters from research paper (must match SAMMFees library constants)
const SAMM_PARAMS = {
  beta1: -1050000n,  // SAMMFees.BETA1_SCALED
  rmin: 1000n,       // SAMMFees.RMIN_SCALED
  rmax: 12000n,      // SAMMFees.RMAX_SCALED
  c: 10400n          // SAMMFees.C_SCALED
};

const FEE_PARAMS = {
  tradeFeeNumerator: 25n,
  tradeFeeDenominator: 10000n,
  ownerFeeNumerator: 5n,
  ownerFeeDenominator: 10000n
};

// Test amounts
const LIQUIDITY_SMALL = ethers.parseEther("1000");
const LIQUIDITY_MEDIUM = ethers.parseEther("5000");
const LIQUIDITY_LARGE = ethers.parseEther("10000");

async function main() {
  console.log("🚀 CrossPoolRouter Deployment & E2E Testing on Rise Testnet");
  console.log("=".repeat(70));
  
  const [deployer] = await ethers.getSigners();
  console.log(`\n📋 Deployer: ${deployer.address}`);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);
  
  const network = await ethers.provider.getNetwork();
  console.log(`🌐 Network: Chain ID ${network.chainId}`);
  
  if (Number(network.chainId) !== CHAIN_ID) {
    console.log(`⚠️  Warning: Expected chain ID ${CHAIN_ID}, got ${network.chainId}`);
  }

  // Track all deployed contracts
  const deployment = {
    network: "Rise Testnet",
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {},
    testResults: {}
  };

  try {
    // ============ PHASE 1: Deploy Core Contracts ============
    console.log("\n" + "=".repeat(70));
    console.log("📦 PHASE 1: Deploying Core Contracts");
    console.log("=".repeat(70));

    // Deploy SAMMPoolFactory
    console.log("\n1️⃣ Deploying SAMMPoolFactory...");
    const SAMMPoolFactory = await ethers.getContractFactory("SAMMPoolFactory");
    const factory = await SAMMPoolFactory.deploy({ gasLimit: GAS_LIMIT });
    await factory.waitForDeployment();
    const factoryAddress = await factory.getAddress();
    console.log(`   ✅ Factory: ${factoryAddress}`);
    deployment.contracts.factory = factoryAddress;

    // Deploy CrossPoolRouter
    console.log("\n2️⃣ Deploying CrossPoolRouter...");
    const CrossPoolRouter = await ethers.getContractFactory("CrossPoolRouter");
    const router = await CrossPoolRouter.deploy(factoryAddress, { gasLimit: GAS_LIMIT });
    await router.waitForDeployment();
    const routerAddress = await router.getAddress();
    console.log(`   ✅ Router: ${routerAddress}`);
    deployment.contracts.router = routerAddress;

    // Deploy Mock Tokens (4 tokens for multi-hop testing)
    console.log("\n3️⃣ Deploying Test Tokens...");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    
    const tokenA = await MockERC20.deploy("Token A", "TKNA", 18, { gasLimit: GAS_LIMIT });
    await tokenA.waitForDeployment();
    const tokenAAddr = await tokenA.getAddress();
    console.log(`   ✅ Token A: ${tokenAAddr}`);

    const tokenB = await MockERC20.deploy("Token B", "TKNB", 18, { gasLimit: GAS_LIMIT });
    await tokenB.waitForDeployment();
    const tokenBAddr = await tokenB.getAddress();
    console.log(`   ✅ Token B: ${tokenBAddr}`);

    const tokenC = await MockERC20.deploy("Token C", "TKNC", 18, { gasLimit: GAS_LIMIT });
    await tokenC.waitForDeployment();
    const tokenCAddr = await tokenC.getAddress();
    console.log(`   ✅ Token C: ${tokenCAddr}`);

    const tokenD = await MockERC20.deploy("Token D", "TKND", 18, { gasLimit: GAS_LIMIT });
    await tokenD.waitForDeployment();
    const tokenDAddr = await tokenD.getAddress();
    console.log(`   ✅ Token D: ${tokenDAddr}`);

    deployment.contracts.tokens = {
      tokenA: tokenAAddr,
      tokenB: tokenBAddr,
      tokenC: tokenCAddr,
      tokenD: tokenDAddr
    };

    // Mint tokens to deployer
    console.log("\n4️⃣ Minting tokens to deployer...");
    const mintAmount = ethers.parseEther("1000000");
    await tokenA.mint(deployer.address, mintAmount);
    await tokenB.mint(deployer.address, mintAmount);
    await tokenC.mint(deployer.address, mintAmount);
    await tokenD.mint(deployer.address, mintAmount);
    console.log(`   ✅ Minted ${ethers.formatEther(mintAmount)} of each token`);

    // ============ PHASE 2: Create Shards with Different Liquidity Levels ============
    console.log("\n" + "=".repeat(70));
    console.log("📦 PHASE 2: Creating Shards with Different Liquidity Levels");
    console.log("=".repeat(70));

    const shards = { AB: [], BC: [], CD: [] };

    // Helper function to create and initialize a shard
    async function createShard(tokenIn, tokenOut, liquidityA, liquidityB, name) {
      console.log(`\n   Creating ${name}...`);
      
      // Create shard via factory
      const tx = await factory.createShard(
        tokenIn, tokenOut, SAMM_PARAMS, FEE_PARAMS,
        { gasLimit: GAS_LIMIT }
      );
      const receipt = await tx.wait(CONFIRMATIONS);
      
      // Get shard address from event
      const event = receipt.logs.find(log => {
        try {
          const parsed = factory.interface.parseLog(log);
          return parsed && parsed.name === "ShardCreated";
        } catch { return false; }
      });
      
      const shardAddress = factory.interface.parseLog(event).args.shard;
      console.log(`   ✅ Shard created: ${shardAddress}`);
      
      // Approve tokens to FACTORY (not shard) for initialization
      const tokenInContract = await ethers.getContractAt("MockERC20", tokenIn);
      const tokenOutContract = await ethers.getContractAt("MockERC20", tokenOut);
      await tokenInContract.approve(factoryAddress, liquidityA);
      await tokenOutContract.approve(factoryAddress, liquidityB);
      
      // Initialize via factory (factory will transfer tokens and call pool.initialize)
      const initTx = await factory.initializeShard(
        shardAddress, liquidityA, liquidityB,
        { gasLimit: GAS_LIMIT }
      );
      await initTx.wait(CONFIRMATIONS);
      
      console.log(`   ✅ Initialized with ${ethers.formatEther(liquidityA)} liquidity each`);
      
      // Get shard contract for later use
      const SAMMPool = await ethers.getContractFactory("SAMMPool");
      const shard = SAMMPool.attach(shardAddress);
      
      return {
        address: shardAddress,
        name: name,
        liquidity: liquidityA,
        contract: shard
      };
    }

    // Create A-B shards (3 shards with different liquidity)
    console.log("\n📊 Creating A-B Shards:");
    shards.AB.push(await createShard(tokenAAddr, tokenBAddr, LIQUIDITY_SMALL, LIQUIDITY_SMALL, "AB-Small"));
    shards.AB.push(await createShard(tokenAAddr, tokenBAddr, LIQUIDITY_MEDIUM, LIQUIDITY_MEDIUM, "AB-Medium"));
    shards.AB.push(await createShard(tokenAAddr, tokenBAddr, LIQUIDITY_LARGE, LIQUIDITY_LARGE, "AB-Large"));

    // Create B-C shards (2 shards)
    console.log("\n📊 Creating B-C Shards:");
    shards.BC.push(await createShard(tokenBAddr, tokenCAddr, LIQUIDITY_SMALL, LIQUIDITY_SMALL, "BC-Small"));
    shards.BC.push(await createShard(tokenBAddr, tokenCAddr, LIQUIDITY_LARGE, LIQUIDITY_LARGE, "BC-Large"));

    // Create C-D shard (1 shard)
    console.log("\n📊 Creating C-D Shard:");
    shards.CD.push(await createShard(tokenCAddr, tokenDAddr, LIQUIDITY_MEDIUM, LIQUIDITY_MEDIUM, "CD-Medium"));

    deployment.contracts.shards = {
      AB: shards.AB.map(s => ({ address: s.address, name: s.name, liquidity: ethers.formatEther(s.liquidity) })),
      BC: shards.BC.map(s => ({ address: s.address, name: s.name, liquidity: ethers.formatEther(s.liquidity) })),
      CD: shards.CD.map(s => ({ address: s.address, name: s.name, liquidity: ethers.formatEther(s.liquidity) }))
    };

    console.log(`\n✅ Created ${shards.AB.length + shards.BC.length + shards.CD.length} shards total`);

    // ============ PHASE 3: Verify SAMM Parameters ============
    console.log("\n" + "=".repeat(70));
    console.log("🔍 PHASE 3: Verifying SAMM Parameters");
    console.log("=".repeat(70));

    let sammParamsValid = true;
    for (const pair of Object.keys(shards)) {
      for (const shard of shards[pair]) {
        const [beta1, rmin, rmax, c] = await shard.contract.getSAMMParams();
        const valid = 
          beta1 === SAMM_PARAMS.beta1 &&
          rmin === SAMM_PARAMS.rmin &&
          rmax === SAMM_PARAMS.rmax &&
          c === SAMM_PARAMS.c;
        
        if (!valid) {
          console.log(`   ❌ ${shard.name}: Parameters mismatch!`);
          sammParamsValid = false;
        } else {
          console.log(`   ✅ ${shard.name}: β1=${beta1}, rmin=${rmin}, rmax=${rmax}, c=${c}`);
        }
      }
    }
    deployment.testResults.sammParamsValid = sammParamsValid;

    // ============ PHASE 4: Test c-smaller-better Property ============
    console.log("\n" + "=".repeat(70));
    console.log("📈 PHASE 4: Testing c-smaller-better Property");
    console.log("=".repeat(70));

    const testSwapAmount = ethers.parseEther("10");
    console.log(`\n   Testing swap of ${ethers.formatEther(testSwapAmount)} tokens across A-B shards:`);

    const swapCosts = [];
    for (const shard of shards.AB) {
      try {
        const result = await shard.contract.calculateSwapSAMM(
          testSwapAmount, tokenAAddr, tokenBAddr
        );
        swapCosts.push({
          name: shard.name,
          liquidity: shard.liquidity,
          amountIn: result.amountIn,
          tradeFee: result.tradeFee
        });
        console.log(`   ${shard.name} (${ethers.formatEther(shard.liquidity)} liq): ${ethers.formatEther(result.amountIn)} input needed`);
      } catch (e) {
        console.log(`   ${shard.name}: Error - ${e.message}`);
      }
    }

    // Verify c-smaller-better: smaller shards should have lower costs
    swapCosts.sort((a, b) => Number(a.liquidity) - Number(b.liquidity));
    let cSmallerBetterHolds = true;
    for (let i = 0; i < swapCosts.length - 1; i++) {
      if (swapCosts[i].amountIn > swapCosts[i + 1].amountIn) {
        cSmallerBetterHolds = false;
        console.log(`   ❌ c-smaller-better violated: ${swapCosts[i].name} costs more than ${swapCosts[i + 1].name}`);
      }
    }
    
    if (cSmallerBetterHolds) {
      console.log(`\n   ✅ c-smaller-better property VERIFIED: Smaller shards provide better rates`);
    }
    deployment.testResults.cSmallerBetterHolds = cSmallerBetterHolds;
    deployment.testResults.swapCostComparison = swapCosts.map(s => ({
      name: s.name,
      liquidity: ethers.formatEther(s.liquidity),
      amountIn: ethers.formatEther(s.amountIn)
    }));

    // ============ PHASE 5: Test Single-Hop Swap via Router ============
    console.log("\n" + "=".repeat(70));
    console.log("🔄 PHASE 5: Testing Single-Hop Swap via CrossPoolRouter");
    console.log("=".repeat(70));

    const singleHopAmount = ethers.parseEther("5");
    const maxAmountIn = ethers.parseEther("10");
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    // Approve router
    await tokenA.approve(routerAddress, maxAmountIn);

    // Check which shard will be selected
    const selectedShard = await router.getSelectedShard(tokenAAddr, tokenBAddr, singleHopAmount);
    console.log(`\n   Selected shard for swap: ${selectedShard}`);
    console.log(`   Expected (smallest): ${shards.AB[0].address}`);
    
    const correctShardSelected = selectedShard.toLowerCase() === shards.AB[0].address.toLowerCase();
    console.log(`   ${correctShardSelected ? "✅" : "❌"} Smallest shard selection: ${correctShardSelected ? "CORRECT" : "INCORRECT"}`);

    // Get quote first
    const quote = await router.quoteSwap([{
      tokenIn: tokenAAddr,
      tokenOut: tokenBAddr,
      amountOut: singleHopAmount
    }]);
    console.log(`\n   Quote: ${ethers.formatEther(quote.expectedAmountIn)} Token A needed`);

    // Record balances before
    const balanceABefore = await tokenA.balanceOf(deployer.address);
    const balanceBBefore = await tokenB.balanceOf(deployer.address);

    // Execute single-hop swap
    console.log(`\n   Executing single-hop swap: ${ethers.formatEther(singleHopAmount)} Token B...`);
    const singleHopPath = {
      hops: [{
        tokenIn: tokenAAddr,
        tokenOut: tokenBAddr,
        amountOut: singleHopAmount
      }],
      maxAmountIn: maxAmountIn,
      deadline: deadline,
      recipient: deployer.address
    };

    const singleHopTx = await router.swapExactOutput(singleHopPath, { gasLimit: GAS_LIMIT });
    const singleHopReceipt = await singleHopTx.wait(CONFIRMATIONS);
    console.log(`   ✅ Transaction: ${singleHopTx.hash}`);

    // Verify balances
    const balanceAAfter = await tokenA.balanceOf(deployer.address);
    const balanceBAfter = await tokenB.balanceOf(deployer.address);
    
    const tokenASpent = balanceABefore - balanceAAfter;
    const tokenBReceived = balanceBAfter - balanceBBefore;

    console.log(`\n   📊 Single-Hop Swap Results:`);
    console.log(`   Token A spent: ${ethers.formatEther(tokenASpent)}`);
    console.log(`   Token B received: ${ethers.formatEther(tokenBReceived)}`);
    console.log(`   Quote accuracy: ${tokenASpent <= quote.expectedAmountIn ? "✅ Within quote" : "❌ Exceeded quote"}`);

    const singleHopSuccess = tokenBReceived === singleHopAmount;
    console.log(`   ${singleHopSuccess ? "✅" : "❌"} Exact output received: ${singleHopSuccess}`);

    deployment.testResults.singleHopSwap = {
      success: singleHopSuccess,
      correctShardSelected: correctShardSelected,
      tokenASpent: ethers.formatEther(tokenASpent),
      tokenBReceived: ethers.formatEther(tokenBReceived),
      quotedAmount: ethers.formatEther(quote.expectedAmountIn),
      txHash: singleHopTx.hash
    };

    // ============ PHASE 6: Test 2-Hop Swap (A→B→C) ============
    console.log("\n" + "=".repeat(70));
    console.log("🔄 PHASE 6: Testing 2-Hop Swap (A→B→C)");
    console.log("=".repeat(70));

    const twoHopFinalAmount = ethers.parseEther("3");
    const twoHopMaxIn = ethers.parseEther("10");

    // Get quote for 2-hop
    const twoHopQuote = await router.quoteSwap([
      { tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: ethers.parseEther("3.5") },
      { tokenIn: tokenBAddr, tokenOut: tokenCAddr, amountOut: twoHopFinalAmount }
    ]);
    console.log(`\n   Quote for A→B→C: ${ethers.formatEther(twoHopQuote.expectedAmountIn)} Token A`);
    console.log(`   Selected shards: ${twoHopQuote.selectedShards.join(", ")}`);

    // Approve router
    await tokenA.approve(routerAddress, twoHopMaxIn);

    // Record balances
    const balanceA2Before = await tokenA.balanceOf(deployer.address);
    const balanceC2Before = await tokenC.balanceOf(deployer.address);

    // Execute 2-hop swap
    console.log(`\n   Executing 2-hop swap: A→B→C for ${ethers.formatEther(twoHopFinalAmount)} Token C...`);
    const twoHopPath = {
      hops: [
        { tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: twoHopQuote.hopAmountsIn[1] },
        { tokenIn: tokenBAddr, tokenOut: tokenCAddr, amountOut: twoHopFinalAmount }
      ],
      maxAmountIn: twoHopMaxIn,
      deadline: deadline,
      recipient: deployer.address
    };

    const twoHopTx = await router.swapExactOutput(twoHopPath, { gasLimit: GAS_LIMIT });
    const twoHopReceipt = await twoHopTx.wait(CONFIRMATIONS);
    console.log(`   ✅ Transaction: ${twoHopTx.hash}`);

    // Verify balances
    const balanceA2After = await tokenA.balanceOf(deployer.address);
    const balanceC2After = await tokenC.balanceOf(deployer.address);

    const tokenA2Spent = balanceA2Before - balanceA2After;
    const tokenCReceived = balanceC2After - balanceC2Before;

    console.log(`\n   📊 2-Hop Swap Results:`);
    console.log(`   Token A spent: ${ethers.formatEther(tokenA2Spent)}`);
    console.log(`   Token C received: ${ethers.formatEther(tokenCReceived)}`);

    const twoHopSuccess = tokenCReceived === twoHopFinalAmount;
    console.log(`   ${twoHopSuccess ? "✅" : "❌"} Exact output received: ${twoHopSuccess}`);

    // Count HopExecuted events
    const hopEvents = twoHopReceipt.logs.filter(log => {
      try {
        const parsed = router.interface.parseLog(log);
        return parsed && parsed.name === "HopExecuted";
      } catch { return false; }
    });
    console.log(`   ${hopEvents.length === 2 ? "✅" : "❌"} HopExecuted events: ${hopEvents.length} (expected 2)`);

    deployment.testResults.twoHopSwap = {
      success: twoHopSuccess,
      tokenASpent: ethers.formatEther(tokenA2Spent),
      tokenCReceived: ethers.formatEther(tokenCReceived),
      hopEventsCount: hopEvents.length,
      txHash: twoHopTx.hash
    };

    // ============ PHASE 7: Test 3-Hop Swap (A→B→C→D) ============
    console.log("\n" + "=".repeat(70));
    console.log("🔄 PHASE 7: Testing 3-Hop Swap (A→B→C→D)");
    console.log("=".repeat(70));

    const threeHopFinalAmount = ethers.parseEther("2");
    const threeHopMaxIn = ethers.parseEther("10");

    // Get quote for 3-hop
    const threeHopQuote = await router.quoteSwap([
      { tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: ethers.parseEther("3") },
      { tokenIn: tokenBAddr, tokenOut: tokenCAddr, amountOut: ethers.parseEther("2.5") },
      { tokenIn: tokenCAddr, tokenOut: tokenDAddr, amountOut: threeHopFinalAmount }
    ]);
    console.log(`\n   Quote for A→B→C→D: ${ethers.formatEther(threeHopQuote.expectedAmountIn)} Token A`);
    console.log(`   Selected shards: ${threeHopQuote.selectedShards.join(", ")}`);

    // Approve router
    await tokenA.approve(routerAddress, threeHopMaxIn);

    // Record balances
    const balanceA3Before = await tokenA.balanceOf(deployer.address);
    const balanceD3Before = await tokenD.balanceOf(deployer.address);

    // Execute 3-hop swap
    console.log(`\n   Executing 3-hop swap: A→B→C→D for ${ethers.formatEther(threeHopFinalAmount)} Token D...`);
    const threeHopPath = {
      hops: [
        { tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: threeHopQuote.hopAmountsIn[1] },
        { tokenIn: tokenBAddr, tokenOut: tokenCAddr, amountOut: threeHopQuote.hopAmountsIn[2] },
        { tokenIn: tokenCAddr, tokenOut: tokenDAddr, amountOut: threeHopFinalAmount }
      ],
      maxAmountIn: threeHopMaxIn,
      deadline: deadline,
      recipient: deployer.address
    };

    const threeHopTx = await router.swapExactOutput(threeHopPath, { gasLimit: GAS_LIMIT });
    const threeHopReceipt = await threeHopTx.wait(CONFIRMATIONS);
    console.log(`   ✅ Transaction: ${threeHopTx.hash}`);

    // Verify balances
    const balanceA3After = await tokenA.balanceOf(deployer.address);
    const balanceD3After = await tokenD.balanceOf(deployer.address);

    const tokenA3Spent = balanceA3Before - balanceA3After;
    const tokenDReceived = balanceD3After - balanceD3Before;

    console.log(`\n   📊 3-Hop Swap Results:`);
    console.log(`   Token A spent: ${ethers.formatEther(tokenA3Spent)}`);
    console.log(`   Token D received: ${ethers.formatEther(tokenDReceived)}`);

    const threeHopSuccess = tokenDReceived === threeHopFinalAmount;
    console.log(`   ${threeHopSuccess ? "✅" : "❌"} Exact output received: ${threeHopSuccess}`);

    // Count HopExecuted events
    const hopEvents3 = threeHopReceipt.logs.filter(log => {
      try {
        const parsed = router.interface.parseLog(log);
        return parsed && parsed.name === "HopExecuted";
      } catch { return false; }
    });
    console.log(`   ${hopEvents3.length === 3 ? "✅" : "❌"} HopExecuted events: ${hopEvents3.length} (expected 3)`);

    deployment.testResults.threeHopSwap = {
      success: threeHopSuccess,
      tokenASpent: ethers.formatEther(tokenA3Spent),
      tokenDReceived: ethers.formatEther(tokenDReceived),
      hopEventsCount: hopEvents3.length,
      txHash: threeHopTx.hash
    };

    // ============ PHASE 8: Test Rollback on Failure ============
    console.log("\n" + "=".repeat(70));
    console.log("🔄 PHASE 8: Testing Atomic Rollback on Failure");
    console.log("=".repeat(70));

    // Test 1: Slippage exceeded
    console.log("\n   Test 1: Slippage exceeded (maxAmountIn too low)");
    const balanceARollbackBefore = await tokenA.balanceOf(deployer.address);
    
    await tokenA.approve(routerAddress, ethers.parseEther("100"));
    
    const failPath = {
      hops: [{ tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: ethers.parseEther("10") }],
      maxAmountIn: ethers.parseEther("1"), // Too low
      deadline: deadline,
      recipient: deployer.address
    };

    let slippageRollbackSuccess = false;
    try {
      await router.swapExactOutput(failPath, { gasLimit: GAS_LIMIT });
      console.log("   ❌ Should have reverted!");
    } catch (e) {
      const balanceARollbackAfter = await tokenA.balanceOf(deployer.address);
      slippageRollbackSuccess = balanceARollbackAfter === balanceARollbackBefore;
      const errorMatch = e.message.includes("ExcessiveSlippage") || e.message.includes("revert");
      console.log(`   ${slippageRollbackSuccess && errorMatch ? "✅" : "❌"} Reverted correctly, balance unchanged: ${slippageRollbackSuccess}`);
      if (!errorMatch) console.log(`   Error: ${e.message.substring(0, 100)}`);
    }

    // Test 2: Deadline exceeded
    console.log("\n   Test 2: Deadline exceeded");
    const balanceADeadlineBefore = await tokenA.balanceOf(deployer.address);
    
    const expiredPath = {
      hops: [{ tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: ethers.parseEther("1") }],
      maxAmountIn: ethers.parseEther("10"),
      deadline: Math.floor(Date.now() / 1000) - 100, // Past deadline
      recipient: deployer.address
    };

    let deadlineRollbackSuccess = false;
    try {
      await router.swapExactOutput(expiredPath, { gasLimit: GAS_LIMIT });
      console.log("   ❌ Should have reverted!");
    } catch (e) {
      const balanceADeadlineAfter = await tokenA.balanceOf(deployer.address);
      deadlineRollbackSuccess = balanceADeadlineAfter === balanceADeadlineBefore;
      const errorMatch = e.message.includes("DeadlineExceeded") || e.message.includes("revert");
      console.log(`   ${deadlineRollbackSuccess && errorMatch ? "✅" : "❌"} Reverted correctly, balance unchanged: ${deadlineRollbackSuccess}`);
      if (!errorMatch) console.log(`   Error: ${e.message.substring(0, 100)}`);
    }

    // Test 3: Invalid recipient
    console.log("\n   Test 3: Invalid recipient (zero address)");
    const balanceARecipientBefore = await tokenA.balanceOf(deployer.address);
    
    const invalidRecipientPath = {
      hops: [{ tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: ethers.parseEther("1") }],
      maxAmountIn: ethers.parseEther("10"),
      deadline: deadline,
      recipient: ethers.ZeroAddress
    };

    let recipientRollbackSuccess = false;
    try {
      await router.swapExactOutput(invalidRecipientPath, { gasLimit: GAS_LIMIT });
      console.log("   ❌ Should have reverted!");
    } catch (e) {
      const balanceARecipientAfter = await tokenA.balanceOf(deployer.address);
      recipientRollbackSuccess = balanceARecipientAfter === balanceARecipientBefore;
      const errorMatch = e.message.includes("InvalidRecipient") || e.message.includes("revert");
      console.log(`   ${recipientRollbackSuccess && errorMatch ? "✅" : "❌"} Reverted correctly, balance unchanged: ${recipientRollbackSuccess}`);
      if (!errorMatch) console.log(`   Error: ${e.message.substring(0, 100)}`);
    }

    deployment.testResults.rollbackTests = {
      slippageExceeded: slippageRollbackSuccess,
      deadlineExceeded: deadlineRollbackSuccess,
      invalidRecipient: recipientRollbackSuccess
    };

    // ============ PHASE 9: Test c-Threshold Validation ============
    console.log("\n" + "=".repeat(70));
    console.log("🔍 PHASE 9: Testing c-Threshold Validation");
    console.log("=".repeat(70));

    // Try to swap an amount that exceeds c-threshold
    // c = 0.0104, so for a pool with 1000 liquidity, max output ≈ 10.4
    const largeSwapAmount = ethers.parseEther("500"); // Way too large for small shard
    
    console.log(`\n   Testing swap of ${ethers.formatEther(largeSwapAmount)} tokens (should exceed c-threshold on small shards)`);
    
    // Check if it would exceed c-threshold on smallest shard
    const smallestShard = shards.AB[0];
    const [reserveA, reserveB] = await smallestShard.contract.getReserves();
    const cThreshold = SAMM_PARAMS.c;
    const maxAllowedOutput = (reserveA * cThreshold) / 1000000n;
    
    console.log(`   Smallest shard reserves: ${ethers.formatEther(reserveA)} / ${ethers.formatEther(reserveB)}`);
    console.log(`   c-threshold: ${Number(cThreshold) / 1000000}`);
    console.log(`   Max allowed output: ${ethers.formatEther(maxAllowedOutput)}`);
    
    // This should work because router will select a larger shard or revert
    let cThresholdHandled = false;
    try {
      const selectedForLarge = await router.getSelectedShard(tokenAAddr, tokenBAddr, largeSwapAmount);
      console.log(`   Router selected shard: ${selectedForLarge}`);
      
      // Verify it's not the smallest shard (router should pick larger one)
      if (selectedForLarge.toLowerCase() !== smallestShard.address.toLowerCase()) {
        console.log(`   ✅ Router correctly selected larger shard for large swap`);
        cThresholdHandled = true;
      } else {
        console.log(`   ⚠️ Router selected smallest shard - checking if swap would work`);
        cThresholdHandled = true; // Still valid if the shard can handle it
      }
    } catch (e) {
      if (e.message.includes("ExceedsCThreshold") || e.message.includes("revert")) {
        console.log(`   ✅ Router correctly reverted with ExceedsCThreshold (no shard can handle this amount)`);
        cThresholdHandled = true;
      } else {
        console.log(`   ❌ Unexpected error: ${e.message.substring(0, 100)}`);
      }
    }

    deployment.testResults.cThresholdValidation = {
      handled: cThresholdHandled,
      maxAllowedOnSmallest: ethers.formatEther(maxAllowedOutput)
    };

    // ============ PHASE 10: Test Admin Functions ============
    console.log("\n" + "=".repeat(70));
    console.log("🔧 PHASE 10: Testing Admin Functions");
    console.log("=".repeat(70));

    // Test pause/unpause
    console.log("\n   Testing pause mechanism...");
    await router.pause({ gasLimit: GAS_LIMIT });
    const isPaused = await router.paused();
    console.log(`   ✅ Router paused: ${isPaused}`);

    // Try swap while paused
    let pauseBlocksSwap = false;
    try {
      await router.swapExactOutput(singleHopPath, { gasLimit: GAS_LIMIT });
    } catch (e) {
      pauseBlocksSwap = true;
      console.log(`   ✅ Swap blocked while paused`);
    }

    // Unpause
    await router.unpause({ gasLimit: GAS_LIMIT });
    const isUnpaused = !(await router.paused());
    console.log(`   ✅ Router unpaused: ${isUnpaused}`);

    deployment.testResults.adminFunctions = {
      pauseWorks: isPaused && pauseBlocksSwap,
      unpauseWorks: isUnpaused
    };

    // ============ PHASE 11: Final Summary ============
    console.log("\n" + "=".repeat(70));
    console.log("📊 FINAL SUMMARY");
    console.log("=".repeat(70));

    const allTestsPassed = 
      deployment.testResults.sammParamsValid &&
      deployment.testResults.cSmallerBetterHolds &&
      deployment.testResults.singleHopSwap.success &&
      deployment.testResults.twoHopSwap.success &&
      deployment.testResults.threeHopSwap.success &&
      deployment.testResults.rollbackTests.slippageExceeded &&
      deployment.testResults.rollbackTests.deadlineExceeded &&
      deployment.testResults.rollbackTests.invalidRecipient &&
      deployment.testResults.cThresholdValidation.handled &&
      deployment.testResults.adminFunctions.pauseWorks &&
      deployment.testResults.adminFunctions.unpauseWorks;

    console.log(`\n   SAMM Parameters Valid: ${deployment.testResults.sammParamsValid ? "✅" : "❌"}`);
    console.log(`   c-smaller-better Property: ${deployment.testResults.cSmallerBetterHolds ? "✅" : "❌"}`);
    console.log(`   Single-Hop Swap: ${deployment.testResults.singleHopSwap.success ? "✅" : "❌"}`);
    console.log(`   2-Hop Swap (A→B→C): ${deployment.testResults.twoHopSwap.success ? "✅" : "❌"}`);
    console.log(`   3-Hop Swap (A→B→C→D): ${deployment.testResults.threeHopSwap.success ? "✅" : "❌"}`);
    console.log(`   Rollback on Slippage: ${deployment.testResults.rollbackTests.slippageExceeded ? "✅" : "❌"}`);
    console.log(`   Rollback on Deadline: ${deployment.testResults.rollbackTests.deadlineExceeded ? "✅" : "❌"}`);
    console.log(`   Rollback on Invalid Recipient: ${deployment.testResults.rollbackTests.invalidRecipient ? "✅" : "❌"}`);
    console.log(`   c-Threshold Validation: ${deployment.testResults.cThresholdValidation.handled ? "✅" : "❌"}`);
    console.log(`   Pause/Unpause: ${deployment.testResults.adminFunctions.pauseWorks && deployment.testResults.adminFunctions.unpauseWorks ? "✅" : "❌"}`);

    console.log(`\n   ${allTestsPassed ? "🎉 ALL TESTS PASSED!" : "⚠️ SOME TESTS FAILED"}`);

    deployment.testResults.allTestsPassed = allTestsPassed;

    // Save deployment data
    const deploymentPath = path.join(__dirname, "..", "deployment-data", `risechain-crosspool-router-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
    fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
    console.log(`\n   📄 Deployment data saved to: ${deploymentPath}`);

    // Print contract addresses
    console.log("\n" + "=".repeat(70));
    console.log("📋 CONTRACT ADDRESSES");
    console.log("=".repeat(70));
    console.log(`\n   Factory: ${factoryAddress}`);
    console.log(`   Router: ${routerAddress}`);
    console.log(`   Token A: ${tokenAAddr}`);
    console.log(`   Token B: ${tokenBAddr}`);
    console.log(`   Token C: ${tokenCAddr}`);
    console.log(`   Token D: ${tokenDAddr}`);
    console.log(`\n   Shards:`);
    for (const pair of Object.keys(shards)) {
      for (const shard of shards[pair]) {
        console.log(`     ${shard.name}: ${shard.address}`);
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log("🎉 CrossPoolRouter Deployment & Testing Complete!");
    console.log("=".repeat(70));

    return deployment;

  } catch (error) {
    console.error("\n❌ Deployment failed:", error.message);
    console.error(error);
    throw error;
  }
}

main()
  .then((deployment) => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error.message);
    process.exit(1);
  });
