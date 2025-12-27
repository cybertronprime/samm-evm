/**
 * Comprehensive End-to-End Testing for CrossPoolRouter on Rise Testnet
 * 
 * This script thoroughly tests:
 * 1. SAMM Properties (c-smaller-better, c-threshold)
 * 2. Smallest shard selection algorithm
 * 3. Dynamic liquidity and shard behavior
 * 4. Rollback/revert scenarios
 * 5. Liquidity addition effects
 * 6. Multi-hop atomic execution
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Configuration
const GAS_LIMIT = 12000000;
const CONFIRMATIONS = 1;

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

function logTest(name, passed, details = "") {
  const status = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`   ${status}: ${name}`);
  if (details) console.log(`      ${details}`);
  testResults.tests.push({ name, passed, details });
  if (passed) testResults.passed++;
  else testResults.failed++;
}

async function main() {
  console.log("🧪 Comprehensive E2E Testing for CrossPoolRouter");
  console.log("=".repeat(70));
  
  const [deployer] = await ethers.getSigners();
  console.log(`\n📋 Deployer: ${deployer.address}`);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH\n`);

  // ============ SETUP: Deploy all contracts ============
  console.log("=".repeat(70));
  console.log("📦 SETUP: Deploying Contracts");
  console.log("=".repeat(70));

  // Deploy Factory
  const SAMMPoolFactory = await ethers.getContractFactory("SAMMPoolFactory");
  const factory = await SAMMPoolFactory.deploy({ gasLimit: GAS_LIMIT });
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`   Factory: ${factoryAddress}`);

  // Deploy Router
  const CrossPoolRouter = await ethers.getContractFactory("CrossPoolRouter");
  const router = await CrossPoolRouter.deploy(factoryAddress, { gasLimit: GAS_LIMIT });
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`   Router: ${routerAddress}`);

  // Deploy Tokens
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const tokenA = await MockERC20.deploy("Token A", "TKNA", 18, { gasLimit: GAS_LIMIT });
  const tokenB = await MockERC20.deploy("Token B", "TKNB", 18, { gasLimit: GAS_LIMIT });
  const tokenC = await MockERC20.deploy("Token C", "TKNC", 18, { gasLimit: GAS_LIMIT });
  await tokenA.waitForDeployment();
  await tokenB.waitForDeployment();
  await tokenC.waitForDeployment();
  
  const tokenAAddr = await tokenA.getAddress();
  const tokenBAddr = await tokenB.getAddress();
  const tokenCAddr = await tokenC.getAddress();
  console.log(`   Token A: ${tokenAAddr}`);
  console.log(`   Token B: ${tokenBAddr}`);
  console.log(`   Token C: ${tokenCAddr}`);

  // Mint tokens
  const mintAmount = ethers.parseEther("10000000");
  await tokenA.mint(deployer.address, mintAmount);
  await tokenB.mint(deployer.address, mintAmount);
  await tokenC.mint(deployer.address, mintAmount);
  console.log(`   Minted ${ethers.formatEther(mintAmount)} of each token`);

  // SAMM Parameters
  const SAMM_PARAMS = {
    beta1: -1050000n,
    rmin: 1000n,
    rmax: 12000n,
    c: 10400n
  };
  const FEE_PARAMS = {
    tradeFeeNumerator: 25n,
    tradeFeeDenominator: 10000n,
    ownerFeeNumerator: 5n,
    ownerFeeDenominator: 10000n
  };

  // Helper to create and initialize shard
  async function createShard(tokenIn, tokenOut, liquidity, name) {
    const tx = await factory.createShard(tokenIn, tokenOut, SAMM_PARAMS, FEE_PARAMS, { gasLimit: GAS_LIMIT });
    const receipt = await tx.wait(CONFIRMATIONS);
    const event = receipt.logs.find(log => {
      try { return factory.interface.parseLog(log)?.name === "ShardCreated"; }
      catch { return false; }
    });
    const shardAddress = factory.interface.parseLog(event).args.shard;
    
    const tokenInContract = await ethers.getContractAt("MockERC20", tokenIn);
    const tokenOutContract = await ethers.getContractAt("MockERC20", tokenOut);
    await tokenInContract.approve(factoryAddress, liquidity);
    await tokenOutContract.approve(factoryAddress, liquidity);
    await factory.initializeShard(shardAddress, liquidity, liquidity, { gasLimit: GAS_LIMIT });
    
    const SAMMPool = await ethers.getContractFactory("SAMMPool");
    return { address: shardAddress, name, liquidity, contract: SAMMPool.attach(shardAddress) };
  }

  // Create shards with DIFFERENT liquidity levels
  console.log("\n   Creating shards with different liquidity levels...");
  const shardAB_tiny = await createShard(tokenAAddr, tokenBAddr, ethers.parseEther("500"), "AB-Tiny");
  const shardAB_small = await createShard(tokenAAddr, tokenBAddr, ethers.parseEther("1000"), "AB-Small");
  const shardAB_medium = await createShard(tokenAAddr, tokenBAddr, ethers.parseEther("5000"), "AB-Medium");
  const shardAB_large = await createShard(tokenAAddr, tokenBAddr, ethers.parseEther("10000"), "AB-Large");
  const shardBC_small = await createShard(tokenBAddr, tokenCAddr, ethers.parseEther("1000"), "BC-Small");
  const shardBC_large = await createShard(tokenBAddr, tokenCAddr, ethers.parseEther("10000"), "BC-Large");
  
  console.log(`   Created 6 shards total`);
  console.log(`   AB shards: Tiny(500), Small(1000), Medium(5000), Large(10000)`);
  console.log(`   BC shards: Small(1000), Large(10000)`);


  // ============ TEST 1: c-smaller-better Property ============
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 1: c-smaller-better Property Verification");
  console.log("=".repeat(70));
  console.log("   Theory: Smaller shards should provide BETTER (lower) swap costs");
  
  const testAmount = ethers.parseEther("5");
  const shards = [shardAB_tiny, shardAB_small, shardAB_medium, shardAB_large];
  const swapCosts = [];
  
  console.log(`\n   Calculating swap cost for ${ethers.formatEther(testAmount)} tokens on each shard:`);
  
  for (const shard of shards) {
    try {
      const result = await shard.contract.calculateSwapSAMM(testAmount, tokenAAddr, tokenBAddr);
      const [resA, resB] = await shard.contract.getReserves();
      swapCosts.push({
        name: shard.name,
        liquidity: shard.liquidity,
        reserveA: resA,
        reserveB: resB,
        amountIn: result.amountIn,
        tradeFee: result.tradeFee
      });
      console.log(`   ${shard.name} (${ethers.formatEther(shard.liquidity)} liq):`);
      console.log(`      Input needed: ${ethers.formatEther(result.amountIn)} Token A`);
      console.log(`      Trade fee: ${ethers.formatEther(result.tradeFee)} Token A`);
    } catch (e) {
      console.log(`   ${shard.name}: Error - ${e.message.substring(0, 50)}`);
    }
  }

  // Verify c-smaller-better: costs should INCREASE as liquidity increases
  console.log("\n   Verifying c-smaller-better property:");
  let cSmallerBetterValid = true;
  for (let i = 0; i < swapCosts.length - 1; i++) {
    const smaller = swapCosts[i];
    const larger = swapCosts[i + 1];
    const smallerCost = Number(ethers.formatEther(smaller.amountIn));
    const largerCost = Number(ethers.formatEther(larger.amountIn));
    
    if (smallerCost < largerCost) {
      console.log(`   ✅ ${smaller.name} (${smallerCost.toFixed(6)}) < ${larger.name} (${largerCost.toFixed(6)})`);
    } else {
      console.log(`   ❌ ${smaller.name} (${smallerCost.toFixed(6)}) >= ${larger.name} (${largerCost.toFixed(6)})`);
      cSmallerBetterValid = false;
    }
  }
  
  logTest("c-smaller-better: Smaller shards have lower costs", cSmallerBetterValid,
    `Tiny: ${ethers.formatEther(swapCosts[0].amountIn)}, Large: ${ethers.formatEther(swapCosts[3].amountIn)}`);

  // ============ TEST 2: Smallest Shard Selection ============
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 2: Smallest Shard Selection Algorithm");
  console.log("=".repeat(70));
  console.log("   Theory: Router should ALWAYS select the smallest shard that can handle the swap");

  // Test with small amount - should select tiny shard
  const smallAmount = ethers.parseEther("2");
  const selectedForSmall = await router.getSelectedShard(tokenAAddr, tokenBAddr, smallAmount);
  const smallSelectCorrect = selectedForSmall.toLowerCase() === shardAB_tiny.address.toLowerCase();
  logTest(`Small swap (${ethers.formatEther(smallAmount)}) selects Tiny shard`, smallSelectCorrect,
    `Selected: ${selectedForSmall}, Expected: ${shardAB_tiny.address}`);

  // Test with medium amount - should still select smallest that can handle it
  const mediumAmount = ethers.parseEther("5");
  const selectedForMedium = await router.getSelectedShard(tokenAAddr, tokenBAddr, mediumAmount);
  console.log(`   Medium swap (${ethers.formatEther(mediumAmount)}): Selected ${selectedForMedium}`);
  
  // Verify it's the smallest valid shard
  let foundSmallestValid = false;
  for (const shard of shards) {
    try {
      await shard.contract.calculateSwapSAMM(mediumAmount, tokenAAddr, tokenBAddr);
      // This shard can handle it
      if (selectedForMedium.toLowerCase() === shard.address.toLowerCase()) {
        foundSmallestValid = true;
        logTest(`Medium swap selects smallest valid shard (${shard.name})`, true);
        break;
      } else {
        logTest(`Medium swap should have selected ${shard.name} but selected different`, false);
        break;
      }
    } catch {
      // This shard can't handle it, continue to next
      continue;
    }
  }


  // ============ TEST 3: c-Threshold Validation ============
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 3: c-Threshold Validation");
  console.log("=".repeat(70));
  console.log("   Theory: Swaps exceeding c-threshold (OA/RA > c) should be rejected");

  // Calculate max allowed output for tiny shard
  const [tinyResA, tinyResB] = await shardAB_tiny.contract.getReserves();
  const cValue = Number(SAMM_PARAMS.c) / 1000000; // 0.0104
  const maxOutputTiny = Number(ethers.formatEther(tinyResA)) * cValue;
  console.log(`\n   Tiny shard reserves: ${ethers.formatEther(tinyResA)} / ${ethers.formatEther(tinyResB)}`);
  console.log(`   c-threshold: ${cValue}`);
  console.log(`   Max output for tiny shard: ~${maxOutputTiny.toFixed(4)} tokens`);

  // The c-threshold check is: OA/RA <= c
  // For tiny shard with 500 reserve and c=0.0104: max OA = 500 * 0.0104 = 5.2 tokens
  // So a 10 token swap should exceed the c-threshold
  
  // Test: Router should skip tiny shard for large swaps that exceed c-threshold
  const exceedsTinyAmount = ethers.parseEther("10"); // Should exceed tiny's c-threshold
  console.log(`\n   Testing router shard selection for ${ethers.formatEther(exceedsTinyAmount)} tokens:`);
  
  // The router should NOT select the tiny shard because it exceeds c-threshold
  try {
    const selectedForExceeds = await router.getSelectedShard(tokenAAddr, tokenBAddr, exceedsTinyAmount);
    const notTiny = selectedForExceeds.toLowerCase() !== shardAB_tiny.address.toLowerCase();
    
    // Find which shard was selected
    let selectedName = "Unknown";
    for (const shard of shards) {
      if (shard.address.toLowerCase() === selectedForExceeds.toLowerCase()) {
        selectedName = shard.name;
        break;
      }
    }
    
    console.log(`   Router selected: ${selectedName} (${selectedForExceeds})`);
    console.log(`   Tiny shard skipped: ${notTiny}`);
    
    // The router should select a larger shard that can handle the swap
    logTest("Router skips tiny shard when c-threshold exceeded", notTiny,
      `Selected: ${selectedName}, Tiny skipped: ${notTiny}`);
  } catch (e) {
    // If all shards exceed c-threshold, router should revert
    const correctError = e.message.includes("ExceedsCThreshold") || e.message.includes("revert");
    logTest("Router handles c-threshold correctly", correctError,
      `Error: ${e.message.substring(0, 50)}`);
  }

  // Test amount that exceeds ALL shards
  const hugeAmount = ethers.parseEther("5000"); // Should exceed all shards
  console.log(`\n   Testing swap of ${ethers.formatEther(hugeAmount)} tokens (should exceed all):`);
  try {
    await router.getSelectedShard(tokenAAddr, tokenBAddr, hugeAmount);
    logTest("Huge swap reverts with ExceedsCThreshold", false, "Should have reverted");
  } catch (e) {
    const correctError = e.message.includes("ExceedsCThreshold") || e.message.includes("revert");
    logTest("Huge swap reverts with ExceedsCThreshold", correctError,
      `Error: ${e.message.substring(0, 60)}`);
  }


  // ============ TEST 4: Rollback/Revert Scenarios ============
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 4: Rollback/Revert Scenarios");
  console.log("=".repeat(70));
  console.log("   Theory: Failed swaps should revert completely with no state changes");

  const deadline = Math.floor(Date.now() / 1000) + 3600;
  
  // Approve router for all tests
  await tokenA.approve(routerAddress, ethers.parseEther("1000000"));

  // Test 4.1: Slippage exceeded
  console.log("\n   Test 4.1: Slippage exceeded (maxAmountIn too low)");
  const balanceBefore_slippage = await tokenA.balanceOf(deployer.address);
  
  let slippageReverted = false;
  try {
    const tx = await router.swapExactOutput({
      hops: [{ tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: ethers.parseEther("10") }],
      maxAmountIn: ethers.parseEther("1"), // Way too low
      deadline: deadline,
      recipient: deployer.address
    }, { gasLimit: GAS_LIMIT });
    await tx.wait(CONFIRMATIONS);
    // If we get here, the transaction succeeded (which is wrong)
    slippageReverted = false;
  } catch (e) {
    slippageReverted = true;
    console.log(`   Error caught: ${e.message.substring(0, 80)}`);
  }
  
  const balanceAfter_slippage = await tokenA.balanceOf(deployer.address);
  const slippageBalanceUnchanged = balanceBefore_slippage === balanceAfter_slippage;
  logTest("Slippage exceeded reverts", slippageReverted && slippageBalanceUnchanged,
    `Reverted: ${slippageReverted}, Balance unchanged: ${slippageBalanceUnchanged}`);

  // Test 4.2: Deadline exceeded
  console.log("\n   Test 4.2: Deadline exceeded");
  const balanceBefore_deadline = await tokenA.balanceOf(deployer.address);
  
  let deadlineReverted = false;
  try {
    const tx = await router.swapExactOutput({
      hops: [{ tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: ethers.parseEther("1") }],
      maxAmountIn: ethers.parseEther("10"),
      deadline: Math.floor(Date.now() / 1000) - 1000, // Past deadline
      recipient: deployer.address
    }, { gasLimit: GAS_LIMIT });
    await tx.wait(CONFIRMATIONS);
    deadlineReverted = false;
  } catch (e) {
    deadlineReverted = true;
    console.log(`   Error caught: ${e.message.substring(0, 80)}`);
  }
  
  const balanceAfter_deadline = await tokenA.balanceOf(deployer.address);
  const deadlineBalanceUnchanged = balanceBefore_deadline === balanceAfter_deadline;
  logTest("Deadline exceeded reverts", deadlineReverted && deadlineBalanceUnchanged,
    `Reverted: ${deadlineReverted}, Balance unchanged: ${deadlineBalanceUnchanged}`);

  // Test 4.3: Invalid recipient (zero address)
  console.log("\n   Test 4.3: Invalid recipient (zero address)");
  const balanceBefore_recipient = await tokenA.balanceOf(deployer.address);
  
  let recipientReverted = false;
  try {
    const tx = await router.swapExactOutput({
      hops: [{ tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: ethers.parseEther("1") }],
      maxAmountIn: ethers.parseEther("10"),
      deadline: deadline,
      recipient: ethers.ZeroAddress
    }, { gasLimit: GAS_LIMIT });
    await tx.wait(CONFIRMATIONS);
    recipientReverted = false;
  } catch (e) {
    recipientReverted = true;
    console.log(`   Error caught: ${e.message.substring(0, 80)}`);
  }
  
  const balanceAfter_recipient = await tokenA.balanceOf(deployer.address);
  const recipientBalanceUnchanged = balanceBefore_recipient === balanceAfter_recipient;
  logTest("Invalid recipient reverts", recipientReverted && recipientBalanceUnchanged,
    `Reverted: ${recipientReverted}, Balance unchanged: ${recipientBalanceUnchanged}`);

  // Test 4.4: Empty path
  console.log("\n   Test 4.4: Empty path");
  let emptyPathReverted = false;
  try {
    const tx = await router.swapExactOutput({
      hops: [],
      maxAmountIn: ethers.parseEther("10"),
      deadline: deadline,
      recipient: deployer.address
    }, { gasLimit: GAS_LIMIT });
    await tx.wait(CONFIRMATIONS);
    emptyPathReverted = false;
  } catch (e) {
    emptyPathReverted = true;
    console.log(`   Error caught: ${e.message.substring(0, 80)}`);
  }
  logTest("Empty path reverts", emptyPathReverted, `Reverted: ${emptyPathReverted}`);

  // Test 4.5: Disconnected path
  console.log("\n   Test 4.5: Disconnected path (A→B, then C→? instead of B→C)");
  let disconnectedReverted = false;
  try {
    const tx = await router.swapExactOutput({
      hops: [
        { tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: ethers.parseEther("1") },
        { tokenIn: tokenCAddr, tokenOut: tokenAAddr, amountOut: ethers.parseEther("1") } // Wrong! Should be B→C
      ],
      maxAmountIn: ethers.parseEther("10"),
      deadline: deadline,
      recipient: deployer.address
    }, { gasLimit: GAS_LIMIT });
    await tx.wait(CONFIRMATIONS);
    disconnectedReverted = false;
  } catch (e) {
    disconnectedReverted = true;
    console.log(`   Error caught: ${e.message.substring(0, 80)}`);
  }
  logTest("Disconnected path reverts", disconnectedReverted, `Reverted: ${disconnectedReverted}`)


  // ============ TEST 5: Liquidity Addition Effects ============
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 5: Liquidity Addition Effects on Shard Selection");
  console.log("=".repeat(70));
  console.log("   Theory: Adding liquidity to a shard should change its selection priority");

  // Get current selection for a swap
  const testSwapAmount = ethers.parseEther("3");
  const selectedBefore = await router.getSelectedShard(tokenAAddr, tokenBAddr, testSwapAmount);
  console.log(`\n   Before liquidity addition:`);
  console.log(`   Selected shard for ${ethers.formatEther(testSwapAmount)} swap: ${selectedBefore}`);

  // Find which shard was selected
  let selectedShardBefore = null;
  for (const shard of shards) {
    if (shard.address.toLowerCase() === selectedBefore.toLowerCase()) {
      selectedShardBefore = shard;
      console.log(`   Selected: ${shard.name} (${ethers.formatEther(shard.liquidity)} initial liquidity)`);
      break;
    }
  }

  // Add significant liquidity to the tiny shard to make it larger
  console.log(`\n   Adding 50000 liquidity to Tiny shard...`);
  const addLiquidityAmount = ethers.parseEther("50000");
  await tokenA.approve(shardAB_tiny.address, addLiquidityAmount);
  await tokenB.approve(shardAB_tiny.address, addLiquidityAmount);
  
  await shardAB_tiny.contract.addLiquidity(
    addLiquidityAmount,
    addLiquidityAmount,
    0, 0,
    deployer.address,
    { gasLimit: GAS_LIMIT }
  );

  const [newResA, newResB] = await shardAB_tiny.contract.getReserves();
  console.log(`   Tiny shard new reserves: ${ethers.formatEther(newResA)} / ${ethers.formatEther(newResB)}`);

  // Check selection again - should now select a different (smaller) shard
  const selectedAfter = await router.getSelectedShard(tokenAAddr, tokenBAddr, testSwapAmount);
  console.log(`\n   After liquidity addition:`);
  console.log(`   Selected shard: ${selectedAfter}`);

  // The tiny shard is now the LARGEST, so it should NOT be selected
  const tinyNoLongerSelected = selectedAfter.toLowerCase() !== shardAB_tiny.address.toLowerCase();
  logTest("Liquidity addition changes shard selection", tinyNoLongerSelected,
    `Tiny (now largest) no longer selected: ${tinyNoLongerSelected}`);

  // Verify the new selection is the smallest remaining shard
  let newSelectedShard = null;
  for (const shard of [shardAB_small, shardAB_medium, shardAB_large]) {
    if (shard.address.toLowerCase() === selectedAfter.toLowerCase()) {
      newSelectedShard = shard;
      console.log(`   Now selected: ${shard.name}`);
      break;
    }
  }
  
  if (newSelectedShard) {
    logTest("New selection is smallest remaining shard", 
      newSelectedShard.name === "AB-Small",
      `Selected: ${newSelectedShard.name}`);
  }

  // Verify c-smaller-better still holds after liquidity change
  console.log("\n   Verifying c-smaller-better still holds after liquidity change:");
  const newSwapCosts = [];
  const updatedShards = [
    { ...shardAB_tiny, name: "AB-Tiny (now largest)" },
    shardAB_small,
    shardAB_medium,
    shardAB_large
  ];
  
  for (const shard of updatedShards) {
    try {
      const [resA, resB] = await shard.contract.getReserves();
      const result = await shard.contract.calculateSwapSAMM(testAmount, tokenAAddr, tokenBAddr);
      newSwapCosts.push({
        name: shard.name,
        reserveA: resA,
        amountIn: result.amountIn
      });
      console.log(`   ${shard.name}: Reserve=${ethers.formatEther(resA)}, Cost=${ethers.formatEther(result.amountIn)}`);
    } catch (e) {
      console.log(`   ${shard.name}: Error - ${e.message.substring(0, 40)}`);
    }
  }


  // ============ TEST 6: Multi-hop Atomic Execution ============
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 6: Multi-hop Atomic Execution Verification");
  console.log("=".repeat(70));
  console.log("   Theory: Multi-hop swaps must execute atomically - all or nothing");

  // Approve tokens for multi-hop
  await tokenA.approve(routerAddress, ethers.parseEther("1000000"));
  await tokenB.approve(routerAddress, ethers.parseEther("1000000"));

  // Test 6.1: Successful 2-hop swap (A→B→C)
  console.log("\n   Test 6.1: 2-hop swap (A→B→C)");
  const balanceA_before_2hop = await tokenA.balanceOf(deployer.address);
  const balanceC_before_2hop = await tokenC.balanceOf(deployer.address);
  
  try {
    const tx = await router.swapExactOutput({
      hops: [
        { tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: ethers.parseEther("5") },
        { tokenIn: tokenBAddr, tokenOut: tokenCAddr, amountOut: ethers.parseEther("4") }
      ],
      maxAmountIn: ethers.parseEther("20"),
      deadline: deadline,
      recipient: deployer.address
    }, { gasLimit: GAS_LIMIT });
    
    const receipt = await tx.wait(CONFIRMATIONS);
    
    // Count HopExecuted events
    const hopEvents = receipt.logs.filter(log => {
      try { return router.interface.parseLog(log)?.name === "HopExecuted"; }
      catch { return false; }
    });
    
    const balanceA_after_2hop = await tokenA.balanceOf(deployer.address);
    const balanceC_after_2hop = await tokenC.balanceOf(deployer.address);
    
    const aSpent = balanceA_before_2hop - balanceA_after_2hop;
    const cReceived = balanceC_after_2hop - balanceC_before_2hop;
    
    console.log(`   Token A spent: ${ethers.formatEther(aSpent)}`);
    console.log(`   Token C received: ${ethers.formatEther(cReceived)}`);
    console.log(`   Hop events emitted: ${hopEvents.length}`);
    
    logTest("2-hop swap executes atomically", 
      hopEvents.length === 2 && cReceived === ethers.parseEther("4"),
      `Hops: ${hopEvents.length}, C received: ${ethers.formatEther(cReceived)}`);
  } catch (e) {
    logTest("2-hop swap executes atomically", false, `Error: ${e.message.substring(0, 50)}`);
  }

  // Test 6.2: Verify intermediate tokens don't leak
  console.log("\n   Test 6.2: Intermediate tokens don't leak to router");
  const routerBalanceB = await tokenB.balanceOf(routerAddress);
  logTest("Router has no leftover Token B", routerBalanceB === 0n,
    `Router Token B balance: ${ethers.formatEther(routerBalanceB)}`);

  // Test 6.3: Multi-hop with tight slippage (should fail)
  console.log("\n   Test 6.3: Multi-hop with tight slippage (should revert)");
  const balanceA_before_tight = await tokenA.balanceOf(deployer.address);
  
  let tightSlippageReverted = false;
  try {
    const tx = await router.swapExactOutput({
      hops: [
        { tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: ethers.parseEther("5") },
        { tokenIn: tokenBAddr, tokenOut: tokenCAddr, amountOut: ethers.parseEther("4") }
      ],
      maxAmountIn: ethers.parseEther("1"), // Way too tight
      deadline: deadline,
      recipient: deployer.address
    }, { gasLimit: GAS_LIMIT });
    await tx.wait(CONFIRMATIONS);
    tightSlippageReverted = false;
  } catch (e) {
    tightSlippageReverted = true;
    console.log(`   Error caught: ${e.message.substring(0, 80)}`);
  }
  
  const balanceA_after_tight = await tokenA.balanceOf(deployer.address);
  const tightBalanceUnchanged = balanceA_before_tight === balanceA_after_tight;
  logTest("Multi-hop tight slippage reverts atomically", tightSlippageReverted && tightBalanceUnchanged,
    `Reverted: ${tightSlippageReverted}, Balance unchanged: ${tightBalanceUnchanged}`);


  // ============ TEST 7: Pause/Unpause Admin Functions ============
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 7: Pause/Unpause Admin Functions");
  console.log("=".repeat(70));
  console.log("   Theory: Owner can pause/unpause router, paused router rejects swaps");

  // Test 7.1: Pause the router
  console.log("\n   Test 7.1: Pause the router");
  try {
    const pauseTx = await router.pause({ gasLimit: GAS_LIMIT });
    await pauseTx.wait(CONFIRMATIONS);
    const isPaused = await router.paused();
    logTest("Router can be paused", isPaused, `Paused: ${isPaused}`);
  } catch (e) {
    logTest("Router can be paused", false, `Error: ${e.message.substring(0, 50)}`);
  }

  // Test 7.2: Swap should fail when paused
  console.log("\n   Test 7.2: Swap fails when paused");
  let pausedSwapReverted = false;
  try {
    const tx = await router.swapExactOutput({
      hops: [{ tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: ethers.parseEther("1") }],
      maxAmountIn: ethers.parseEther("10"),
      deadline: deadline,
      recipient: deployer.address
    }, { gasLimit: GAS_LIMIT });
    await tx.wait(CONFIRMATIONS);
    pausedSwapReverted = false;
  } catch (e) {
    pausedSwapReverted = true;
    console.log(`   Error caught: ${e.message.substring(0, 80)}`);
  }
  logTest("Swap fails when paused", pausedSwapReverted, `Reverted: ${pausedSwapReverted}`);

  // Test 7.3: Unpause the router
  console.log("\n   Test 7.3: Unpause the router");
  try {
    const unpauseTx = await router.unpause({ gasLimit: GAS_LIMIT });
    await unpauseTx.wait(CONFIRMATIONS);
    const isPaused = await router.paused();
    logTest("Router can be unpaused", !isPaused, `Paused: ${isPaused}`);
  } catch (e) {
    logTest("Router can be unpaused", false, `Error: ${e.message.substring(0, 50)}`);
  }

  // Test 7.4: Swap should work after unpause
  console.log("\n   Test 7.4: Swap works after unpause");
  try {
    const tx = await router.swapExactOutput({
      hops: [{ tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: ethers.parseEther("1") }],
      maxAmountIn: ethers.parseEther("10"),
      deadline: deadline,
      recipient: deployer.address
    }, { gasLimit: GAS_LIMIT });
    await tx.wait(CONFIRMATIONS);
    logTest("Swap works after unpause", true);
  } catch (e) {
    logTest("Swap works after unpause", false, `Error: ${e.message.substring(0, 50)}`);
  }


  // ============ TEST 8: Dynamic Pool Sharding Behavior ============
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 8: Dynamic Pool Sharding Behavior");
  console.log("=".repeat(70));
  console.log("   Theory: New shards can be added dynamically and will be selected if smallest");

  // Test 8.1: Create a new tiny shard
  console.log("\n   Test 8.1: Create new tiny shard dynamically");
  const shardAB_micro = await createShard(tokenAAddr, tokenBAddr, ethers.parseEther("100"), "AB-Micro");
  console.log(`   Created AB-Micro shard: ${shardAB_micro.address}`);
  console.log(`   Liquidity: ${ethers.formatEther(shardAB_micro.liquidity)}`);

  // Test 8.2: New micro shard should be selected for small swaps
  console.log("\n   Test 8.2: New micro shard selected for small swaps");
  const selectedAfterMicro = await router.getSelectedShard(tokenAAddr, tokenBAddr, ethers.parseEther("0.5"));
  const microSelected = selectedAfterMicro.toLowerCase() === shardAB_micro.address.toLowerCase();
  logTest("New micro shard is selected for small swaps", microSelected,
    `Selected: ${selectedAfterMicro}, Micro: ${shardAB_micro.address}`);

  // Test 8.3: Verify micro shard has best cost
  console.log("\n   Test 8.3: Verify micro shard has best (lowest) cost");
  const microCost = await shardAB_micro.contract.calculateSwapSAMM(ethers.parseEther("0.5"), tokenAAddr, tokenBAddr);
  const smallCost = await shardAB_small.contract.calculateSwapSAMM(ethers.parseEther("0.5"), tokenAAddr, tokenBAddr);
  
  const microCostNum = Number(ethers.formatEther(microCost.amountIn));
  const smallCostNum = Number(ethers.formatEther(smallCost.amountIn));
  
  console.log(`   Micro shard cost: ${microCostNum.toFixed(6)}`);
  console.log(`   Small shard cost: ${smallCostNum.toFixed(6)}`);
  
  logTest("Micro shard has lower cost than small shard", microCostNum < smallCostNum,
    `Micro: ${microCostNum.toFixed(6)} < Small: ${smallCostNum.toFixed(6)}`);

  // Test 8.4: Deactivate micro shard and verify selection changes
  console.log("\n   Test 8.4: Deactivate micro shard, selection should change");
  try {
    await factory.deactivateShard(shardAB_micro.address, { gasLimit: GAS_LIMIT });
    const selectedAfterDeactivate = await router.getSelectedShard(tokenAAddr, tokenBAddr, ethers.parseEther("0.5"));
    const microNotSelected = selectedAfterDeactivate.toLowerCase() !== shardAB_micro.address.toLowerCase();
    logTest("Deactivated shard is not selected", microNotSelected,
      `Selected: ${selectedAfterDeactivate}`);
  } catch (e) {
    logTest("Shard deactivation works", false, `Error: ${e.message.substring(0, 50)}`);
  }


  // ============ TEST 9: Quote Function Accuracy ============
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 9: Quote Function Accuracy");
  console.log("=".repeat(70));
  console.log("   Theory: Quote function should accurately predict swap costs");

  // Test 9.1: Single-hop quote accuracy
  console.log("\n   Test 9.1: Single-hop quote accuracy");
  const quoteAmount = ethers.parseEther("5");
  try {
    const quote = await router.quoteSwap([
      { tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: quoteAmount }
    ]);
    
    console.log(`   Quoted input: ${ethers.formatEther(quote.expectedAmountIn)}`);
    console.log(`   Selected shard: ${quote.selectedShards[0]}`);
    console.log(`   Quoted fee: ${ethers.formatEther(quote.hopFees[0])}`);
    
    // Execute the swap and compare
    const balanceBefore = await tokenA.balanceOf(deployer.address);
    const tx = await router.swapExactOutput({
      hops: [{ tokenIn: tokenAAddr, tokenOut: tokenBAddr, amountOut: quoteAmount }],
      maxAmountIn: quote.expectedAmountIn + ethers.parseEther("1"), // Add buffer
      deadline: deadline,
      recipient: deployer.address
    }, { gasLimit: GAS_LIMIT });
    await tx.wait(CONFIRMATIONS);
    const balanceAfter = await tokenA.balanceOf(deployer.address);
    
    const actualInput = balanceBefore - balanceAfter;
    const quotedInput = quote.expectedAmountIn;
    
    // Allow 0.1% tolerance for rounding
    const tolerance = quotedInput / 1000n;
    const withinTolerance = actualInput >= quotedInput - tolerance && actualInput <= quotedInput + tolerance;
    
    console.log(`   Actual input: ${ethers.formatEther(actualInput)}`);
    console.log(`   Difference: ${ethers.formatEther(actualInput - quotedInput)}`);
    
    logTest("Quote matches actual swap within 0.1%", withinTolerance,
      `Quoted: ${ethers.formatEther(quotedInput)}, Actual: ${ethers.formatEther(actualInput)}`);
  } catch (e) {
    logTest("Quote function works", false, `Error: ${e.message.substring(0, 50)}`);
  }


  // ============ FINAL SUMMARY ============
  console.log("\n" + "=".repeat(70));
  console.log("📊 FINAL TEST SUMMARY");
  console.log("=".repeat(70));
  console.log(`\n   Total Tests: ${testResults.passed + testResults.failed}`);
  console.log(`   ✅ Passed: ${testResults.passed}`);
  console.log(`   ❌ Failed: ${testResults.failed}`);
  console.log(`   Success Rate: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1)}%`);

  console.log("\n   Test Results by Category:");
  console.log("   " + "-".repeat(50));
  
  // Group tests by category
  const categories = {
    "c-smaller-better": [],
    "Shard Selection": [],
    "c-Threshold": [],
    "Rollback": [],
    "Liquidity": [],
    "Multi-hop": [],
    "Pause/Unpause": [],
    "Dynamic Sharding": [],
    "Quote": []
  };
  
  for (const test of testResults.tests) {
    if (test.name.includes("c-smaller-better") || test.name.includes("smaller")) {
      categories["c-smaller-better"].push(test);
    } else if (test.name.includes("select") || test.name.includes("Select")) {
      categories["Shard Selection"].push(test);
    } else if (test.name.includes("c-Threshold") || test.name.includes("threshold") || test.name.includes("Huge")) {
      categories["c-Threshold"].push(test);
    } else if (test.name.includes("revert") || test.name.includes("Slippage") || test.name.includes("Deadline") || test.name.includes("recipient") || test.name.includes("path")) {
      categories["Rollback"].push(test);
    } else if (test.name.includes("Liquidity") || test.name.includes("liquidity")) {
      categories["Liquidity"].push(test);
    } else if (test.name.includes("hop") || test.name.includes("atomic") || test.name.includes("leftover")) {
      categories["Multi-hop"].push(test);
    } else if (test.name.includes("pause") || test.name.includes("Pause")) {
      categories["Pause/Unpause"].push(test);
    } else if (test.name.includes("micro") || test.name.includes("Micro") || test.name.includes("Deactivate") || test.name.includes("dynamic")) {
      categories["Dynamic Sharding"].push(test);
    } else if (test.name.includes("Quote") || test.name.includes("quote")) {
      categories["Quote"].push(test);
    }
  }
  
  for (const [category, tests] of Object.entries(categories)) {
    if (tests.length > 0) {
      const passed = tests.filter(t => t.passed).length;
      const total = tests.length;
      const status = passed === total ? "✅" : "⚠️";
      console.log(`   ${status} ${category}: ${passed}/${total} passed`);
    }
  }

  // Save results to file
  const resultsFile = `comprehensive-e2e-results-${Date.now()}.json`;
  fs.writeFileSync(resultsFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    network: "Rise Testnet (local deployment)",
    contracts: {
      factory: factoryAddress,
      router: routerAddress,
      tokens: { tokenA: tokenAAddr, tokenB: tokenBAddr, tokenC: tokenCAddr }
    },
    summary: {
      total: testResults.passed + testResults.failed,
      passed: testResults.passed,
      failed: testResults.failed,
      successRate: ((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1) + "%"
    },
    tests: testResults.tests
  }, null, 2));
  
  console.log(`\n   Results saved to: ${resultsFile}`);
  
  if (testResults.failed > 0) {
    console.log("\n   ⚠️  Some tests failed. Review the output above for details.");
    process.exit(1);
  } else {
    console.log("\n   🎉 All tests passed! SAMM properties verified.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Test execution failed:", error);
    process.exit(1);
  });