/**
 * Production Deployment for CrossPoolRouter on Rise Testnet
 * 
 * Deploys realistic tokens (BTC, ETH, USDC, USDT, DAI, LINK, UNI, AAVE)
 * with proper liquidity pools and multiple shards per pair.
 * 
 * SAMM Shard Algorithm:
 * - Shards are MANUALLY created (not automatic)
 * - Each shard has different liquidity levels
 * - Smaller shards = better rates (c-smaller-better)
 * - Router selects smallest shard that can handle the swap
 * - Shards can be deactivated but not automatically removed
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Configuration
const GAS_LIMIT = 12000000;
const CONFIRMATIONS = 1;

// Token configurations with realistic decimals and initial supplies
const TOKENS = {
  WBTC: { name: "Wrapped Bitcoin", symbol: "WBTC", decimals: 8, price: 100000 },
  WETH: { name: "Wrapped Ether", symbol: "WETH", decimals: 18, price: 3500 },
  USDC: { name: "USD Coin", symbol: "USDC", decimals: 6, price: 1 },
  USDT: { name: "Tether USD", symbol: "USDT", decimals: 6, price: 1 },
  DAI: { name: "Dai Stablecoin", symbol: "DAI", decimals: 18, price: 1 },
  LINK: { name: "Chainlink", symbol: "LINK", decimals: 18, price: 15 },
  UNI: { name: "Uniswap", symbol: "UNI", decimals: 18, price: 8 },
  AAVE: { name: "Aave", symbol: "AAVE", decimals: 18, price: 180 }
};

// Pool configurations with realistic liquidity levels (in USD value)
// Each pair has multiple shards: Small, Medium, Large
const POOL_CONFIGS = [
  // Major pairs - high liquidity
  { tokenA: "WETH", tokenB: "USDC", shards: [
    { name: "Small", liquidityUSD: 50000 },
    { name: "Medium", liquidityUSD: 250000 },
    { name: "Large", liquidityUSD: 1000000 }
  ]},
  { tokenA: "WBTC", tokenB: "USDC", shards: [
    { name: "Small", liquidityUSD: 100000 },
    { name: "Medium", liquidityUSD: 500000 },
    { name: "Large", liquidityUSD: 2000000 }
  ]},
  { tokenA: "WETH", tokenB: "WBTC", shards: [
    { name: "Small", liquidityUSD: 100000 },
    { name: "Medium", liquidityUSD: 500000 },
    { name: "Large", liquidityUSD: 1500000 }
  ]},
  // Stablecoin pairs - very high liquidity
  { tokenA: "USDC", tokenB: "USDT", shards: [
    { name: "Small", liquidityUSD: 100000 },
    { name: "Medium", liquidityUSD: 500000 },
    { name: "Large", liquidityUSD: 2000000 }
  ]},
  { tokenA: "USDC", tokenB: "DAI", shards: [
    { name: "Small", liquidityUSD: 100000 },
    { name: "Medium", liquidityUSD: 500000 },
    { name: "Large", liquidityUSD: 1500000 }
  ]},
  { tokenA: "USDT", tokenB: "DAI", shards: [
    { name: "Small", liquidityUSD: 50000 },
    { name: "Medium", liquidityUSD: 250000 },
    { name: "Large", liquidityUSD: 1000000 }
  ]},
  // DeFi token pairs
  { tokenA: "LINK", tokenB: "USDC", shards: [
    { name: "Small", liquidityUSD: 25000 },
    { name: "Medium", liquidityUSD: 100000 },
    { name: "Large", liquidityUSD: 500000 }
  ]},
  { tokenA: "UNI", tokenB: "USDC", shards: [
    { name: "Small", liquidityUSD: 25000 },
    { name: "Medium", liquidityUSD: 100000 },
    { name: "Large", liquidityUSD: 400000 }
  ]},
  { tokenA: "AAVE", tokenB: "USDC", shards: [
    { name: "Small", liquidityUSD: 25000 },
    { name: "Medium", liquidityUSD: 100000 },
    { name: "Large", liquidityUSD: 300000 }
  ]},
  // Cross pairs for multi-hop routing
  { tokenA: "WETH", tokenB: "LINK", shards: [
    { name: "Small", liquidityUSD: 20000 },
    { name: "Medium", liquidityUSD: 80000 }
  ]},
  { tokenA: "WETH", tokenB: "UNI", shards: [
    { name: "Small", liquidityUSD: 20000 },
    { name: "Medium", liquidityUSD: 80000 }
  ]},
  { tokenA: "WETH", tokenB: "AAVE", shards: [
    { name: "Small", liquidityUSD: 20000 },
    { name: "Medium", liquidityUSD: 80000 }
  ]}
];

// SAMM Parameters from research paper
const SAMM_PARAMS = {
  beta1: -1050000n,  // -1.05 * 1e6
  rmin: 1000n,       // 0.001 * 1e6
  rmax: 12000n,      // 0.012 * 1e6
  c: 10400n          // 0.0104 * 1e6
};

const FEE_PARAMS = {
  tradeFeeNumerator: 25n,      // 0.25%
  tradeFeeDenominator: 10000n,
  ownerFeeNumerator: 5n,       // 0.05%
  ownerFeeDenominator: 10000n
};

async function main() {
  console.log("🚀 Production Deployment for CrossPoolRouter on Rise Testnet");
  console.log("=".repeat(70));
  
  const [deployer] = await ethers.getSigners();
  console.log(`\n📋 Deployer: ${deployer.address}`);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH\n`);

  const deploymentData = {
    network: "Rise Testnet",
    chainId: 11155931,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: { tokens: {}, shards: {} },
    poolStats: {}
  };

  // ============ Deploy Factory ============
  console.log("=".repeat(70));
  console.log("📦 Deploying Core Contracts");
  console.log("=".repeat(70));

  const SAMMPoolFactory = await ethers.getContractFactory("SAMMPoolFactory");
  const factory = await SAMMPoolFactory.deploy({ gasLimit: GAS_LIMIT });
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`   ✅ Factory: ${factoryAddress}`);
  deploymentData.contracts.factory = factoryAddress;

  // ============ Deploy Router ============
  const CrossPoolRouter = await ethers.getContractFactory("CrossPoolRouter");
  const router = await CrossPoolRouter.deploy(factoryAddress, { gasLimit: GAS_LIMIT });
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`   ✅ Router: ${routerAddress}`);
  deploymentData.contracts.router = routerAddress;

  // ============ Deploy Tokens ============
  console.log("\n" + "=".repeat(70));
  console.log("🪙 Deploying Tokens");
  console.log("=".repeat(70));

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const tokenContracts = {};

  for (const [symbol, config] of Object.entries(TOKENS)) {
    const token = await MockERC20.deploy(config.name, symbol, config.decimals, { gasLimit: GAS_LIMIT });
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    tokenContracts[symbol] = { contract: token, address: tokenAddress, ...config };
    console.log(`   ✅ ${symbol}: ${tokenAddress} (${config.decimals} decimals)`);
    deploymentData.contracts.tokens[symbol] = {
      address: tokenAddress,
      name: config.name,
      decimals: config.decimals,
      price: config.price
    };
  }

  // ============ Mint Tokens ============
  console.log("\n" + "=".repeat(70));
  console.log("💵 Minting Tokens");
  console.log("=".repeat(70));

  // Mint large amounts for liquidity provision
  for (const [symbol, tokenData] of Object.entries(tokenContracts)) {
    // Mint based on price - more tokens for cheaper assets
    const mintAmount = BigInt(Math.floor(100000000 / tokenData.price)) * (10n ** BigInt(tokenData.decimals));
    await tokenData.contract.mint(deployer.address, mintAmount);
    console.log(`   ✅ Minted ${symbol}: ${ethers.formatUnits(mintAmount, tokenData.decimals)}`);
  }

  // ============ Create Shards ============
  console.log("\n" + "=".repeat(70));
  console.log("🔧 Creating Pool Shards");
  console.log("=".repeat(70));

  // Helper function to calculate token amounts from USD value
  function calculateTokenAmounts(tokenASymbol, tokenBSymbol, liquidityUSD) {
    const tokenA = tokenContracts[tokenASymbol];
    const tokenB = tokenContracts[tokenBSymbol];
    
    // Split liquidity 50/50 in USD value
    const halfLiquidityUSD = liquidityUSD / 2;
    
    // Calculate token amounts based on price
    const amountA = BigInt(Math.floor(halfLiquidityUSD / tokenA.price * (10 ** tokenA.decimals)));
    const amountB = BigInt(Math.floor(halfLiquidityUSD / tokenB.price * (10 ** tokenB.decimals)));
    
    return { amountA, amountB };
  }

  // Helper function to create and initialize a shard
  async function createShard(tokenASymbol, tokenBSymbol, shardConfig) {
    const tokenA = tokenContracts[tokenASymbol];
    const tokenB = tokenContracts[tokenBSymbol];
    
    const { amountA, amountB } = calculateTokenAmounts(tokenASymbol, tokenBSymbol, shardConfig.liquidityUSD);
    
    // Create shard
    const tx = await factory.createShard(
      tokenA.address,
      tokenB.address,
      SAMM_PARAMS,
      FEE_PARAMS,
      { gasLimit: GAS_LIMIT }
    );
    const receipt = await tx.wait(CONFIRMATIONS);
    
    // Get shard address from event
    const event = receipt.logs.find(log => {
      try { return factory.interface.parseLog(log)?.name === "ShardCreated"; }
      catch { return false; }
    });
    const shardAddress = factory.interface.parseLog(event).args.shard;
    
    // Approve tokens
    await tokenA.contract.approve(factoryAddress, amountA);
    await tokenB.contract.approve(factoryAddress, amountB);
    
    // Initialize shard
    await factory.initializeShard(shardAddress, amountA, amountB, { gasLimit: GAS_LIMIT });
    
    return {
      address: shardAddress,
      name: `${tokenASymbol}-${tokenBSymbol}-${shardConfig.name}`,
      liquidityUSD: shardConfig.liquidityUSD,
      amountA: ethers.formatUnits(amountA, tokenA.decimals),
      amountB: ethers.formatUnits(amountB, tokenB.decimals)
    };
  }

  let totalShards = 0;
  let totalLiquidityUSD = 0;

  for (const poolConfig of POOL_CONFIGS) {
    const pairKey = `${poolConfig.tokenA}-${poolConfig.tokenB}`;
    console.log(`\n   📊 Creating ${pairKey} shards:`);
    deploymentData.contracts.shards[pairKey] = [];
    
    for (const shardConfig of poolConfig.shards) {
      try {
        const shard = await createShard(poolConfig.tokenA, poolConfig.tokenB, shardConfig);
        deploymentData.contracts.shards[pairKey].push(shard);
        totalShards++;
        totalLiquidityUSD += shardConfig.liquidityUSD;
        console.log(`      ✅ ${shard.name}: $${shardConfig.liquidityUSD.toLocaleString()} (${shard.address.slice(0, 10)}...)`);
      } catch (e) {
        console.log(`      ❌ ${pairKey}-${shardConfig.name}: ${e.message.slice(0, 50)}`);
      }
    }
  }

  console.log(`\n   📈 Total: ${totalShards} shards with $${totalLiquidityUSD.toLocaleString()} TVL`);
  deploymentData.poolStats = { totalShards, totalLiquidityUSD };

  // ============ Verify Deployment ============
  console.log("\n" + "=".repeat(70));
  console.log("🧪 Verifying Deployment");
  console.log("=".repeat(70));

  const testResults = { passed: 0, failed: 0, tests: [] };
  
  function logTest(name, passed, details = "") {
    const status = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`   ${status}: ${name}`);
    if (details) console.log(`      ${details}`);
    testResults.tests.push({ name, passed, details });
    if (passed) testResults.passed++;
    else testResults.failed++;
  }

  // Test 1: Verify c-smaller-better on USDC-DAI (stablecoin pair - known to work)
  console.log("\n   Testing c-smaller-better property on USDC-DAI:");
  const usdcDaiShards = deploymentData.contracts.shards["USDC-DAI"];
  if (usdcDaiShards && usdcDaiShards.length >= 2) {
    const SAMMPool = await ethers.getContractFactory("SAMMPool");
    const smallShard = SAMMPool.attach(usdcDaiShards[0].address);
    const largeShard = SAMMPool.attach(usdcDaiShards[usdcDaiShards.length - 1].address);
    
    // Get the actual token order from the pool
    const poolTokenA = await smallShard.tokenA();
    const poolTokenB = await smallShard.tokenB();
    console.log(`      Pool tokenA: ${poolTokenA}`);
    console.log(`      Pool tokenB: ${poolTokenB}`);
    
    // Determine which is USDC and which is DAI
    const isUsdcTokenA = poolTokenA.toLowerCase() === tokenContracts.USDC.address.toLowerCase();
    const usdcAddr = isUsdcTokenA ? poolTokenA : poolTokenB;
    const daiAddr = isUsdcTokenA ? poolTokenB : poolTokenA;
    
    // Test: Get 10 DAI, how much USDC needed?
    const testAmount = ethers.parseUnits("10", 18); // 10 DAI output
    try {
      const smallResult = await smallShard.calculateSwapSAMM(testAmount, usdcAddr, daiAddr);
      const largeResult = await largeShard.calculateSwapSAMM(testAmount, usdcAddr, daiAddr);
      
      const smallCost = Number(ethers.formatUnits(smallResult.amountIn, 6));
      const largeCost = Number(ethers.formatUnits(largeResult.amountIn, 6));
      
      logTest("c-smaller-better: Small shard has lower cost", smallCost < largeCost,
        `Small: ${smallCost.toFixed(6)} USDC, Large: ${largeCost.toFixed(6)} USDC`);
    } catch (e) {
      logTest("c-smaller-better verification", false, e.message.slice(0, 80));
    }
  }

  // Test 2: Verify shard selection on USDC-DAI
  console.log("\n   Testing shard selection:");
  try {
    const selectedShard = await router.getSelectedShard(
      tokenContracts.USDC.address,
      tokenContracts.DAI.address,
      ethers.parseUnits("10", 18) // 10 DAI output
    );
    // Check if it selected one of the USDC-DAI shards
    const isValidShard = usdcDaiShards.some(s => s.address.toLowerCase() === selectedShard.toLowerCase());
    // Should select the smallest shard for small amounts
    const isSmallestShard = selectedShard.toLowerCase() === usdcDaiShards[0].address.toLowerCase();
    logTest("Router selects smallest valid shard", isValidShard && isSmallestShard,
      `Selected: ${selectedShard.slice(0, 10)}... (expected smallest: ${usdcDaiShards[0].address.slice(0, 10)}...)`);
  } catch (e) {
    logTest("Shard selection", false, e.message.slice(0, 80));
  }

  // Test 3: Execute a swap (USDC → USDT) - stablecoin swap
  console.log("\n   Testing swap execution:");
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  await tokenContracts.USDC.contract.approve(routerAddress, ethers.parseUnits("100000", 6));
  
  try {
    const usdtBefore = await tokenContracts.USDT.contract.balanceOf(deployer.address);
    const tx = await router.swapExactOutput({
      hops: [{
        tokenIn: tokenContracts.USDC.address,
        tokenOut: tokenContracts.USDT.address,
        amountOut: ethers.parseUnits("50", 6) // Get 50 USDT
      }],
      maxAmountIn: ethers.parseUnits("60", 6), // Max 60 USDC
      deadline: deadline,
      recipient: deployer.address
    }, { gasLimit: GAS_LIMIT });
    await tx.wait(CONFIRMATIONS);
    
    const usdtAfter = await tokenContracts.USDT.contract.balanceOf(deployer.address);
    const received = usdtAfter - usdtBefore;
    logTest("Single-hop swap (USDC→USDT)", received === ethers.parseUnits("50", 6),
      `Received: ${ethers.formatUnits(received, 6)} USDT`);
  } catch (e) {
    logTest("Single-hop swap", false, e.message.slice(0, 80));
  }

  // Test 4: Multi-hop swap (USDC → USDT → DAI) - all stablecoins
  console.log("\n   Testing multi-hop swap:");
  
  try {
    const daiBefore = await tokenContracts.DAI.contract.balanceOf(deployer.address);
    const tx = await router.swapExactOutput({
      hops: [
        { tokenIn: tokenContracts.USDC.address, tokenOut: tokenContracts.USDT.address, amountOut: ethers.parseUnits("30", 6) },
        { tokenIn: tokenContracts.USDT.address, tokenOut: tokenContracts.DAI.address, amountOut: ethers.parseUnits("25", 18) }
      ],
      maxAmountIn: ethers.parseUnits("50", 6),
      deadline: deadline,
      recipient: deployer.address
    }, { gasLimit: GAS_LIMIT });
    const receipt = await tx.wait(CONFIRMATIONS);
    
    const hopEvents = receipt.logs.filter(log => {
      try { return router.interface.parseLog(log)?.name === "HopExecuted"; }
      catch { return false; }
    });
    
    const daiAfter = await tokenContracts.DAI.contract.balanceOf(deployer.address);
    const received = daiAfter - daiBefore;
    logTest("Multi-hop swap (USDC→USDT→DAI)", hopEvents.length === 2 && received === ethers.parseUnits("25", 18),
      `Hops: ${hopEvents.length}, Received: ${ethers.formatUnits(received, 18)} DAI`);
  } catch (e) {
    logTest("Multi-hop swap", false, e.message.slice(0, 80));
  }

  // Test 5: Stablecoin swap
  console.log("\n   Testing stablecoin swap:");
  await tokenContracts.USDC.contract.approve(routerAddress, ethers.parseUnits("10000", 6));
  
  try {
    const daiBefore = await tokenContracts.DAI.contract.balanceOf(deployer.address);
    const tx = await router.swapExactOutput({
      hops: [{ tokenIn: tokenContracts.USDC.address, tokenOut: tokenContracts.DAI.address, amountOut: ethers.parseUnits("100", 18) }],
      maxAmountIn: ethers.parseUnits("110", 6),
      deadline: deadline,
      recipient: deployer.address
    }, { gasLimit: GAS_LIMIT });
    await tx.wait(CONFIRMATIONS);
    
    const daiAfter = await tokenContracts.DAI.contract.balanceOf(deployer.address);
    const received = daiAfter - daiBefore;
    logTest("Stablecoin swap (USDC→DAI)", received === ethers.parseUnits("100", 18),
      `Received: ${ethers.formatUnits(received, 18)} DAI`);
  } catch (e) {
    logTest("Stablecoin swap", false, e.message.slice(0, 50));
  }

  // Test 6: Quote accuracy
  console.log("\n   Testing quote accuracy:");
  try {
    const quote = await router.quoteSwap([{
      tokenIn: tokenContracts.USDC.address,
      tokenOut: tokenContracts.DAI.address,
      amountOut: ethers.parseUnits("100", 18)
    }]);
    
    const usdcBefore = await tokenContracts.USDC.contract.balanceOf(deployer.address);
    const tx = await router.swapExactOutput({
      hops: [{ tokenIn: tokenContracts.USDC.address, tokenOut: tokenContracts.DAI.address, amountOut: ethers.parseUnits("100", 18) }],
      maxAmountIn: quote.expectedAmountIn + ethers.parseUnits("10", 6),
      deadline: deadline,
      recipient: deployer.address
    }, { gasLimit: GAS_LIMIT });
    await tx.wait(CONFIRMATIONS);
    
    const usdcAfter = await tokenContracts.USDC.contract.balanceOf(deployer.address);
    const actualSpent = usdcBefore - usdcAfter;
    const quotedSpent = quote.expectedAmountIn;
    
    const tolerance = quotedSpent / 1000n; // 0.1% tolerance
    const withinTolerance = actualSpent >= quotedSpent - tolerance && actualSpent <= quotedSpent + tolerance;
    
    logTest("Quote accuracy within 0.1%", withinTolerance,
      `Quoted: ${ethers.formatUnits(quotedSpent, 6)} USDC, Actual: ${ethers.formatUnits(actualSpent, 6)} USDC`);
  } catch (e) {
    logTest("Quote accuracy", false, e.message.slice(0, 80));
  }

  // ============ Final Summary ============
  console.log("\n" + "=".repeat(70));
  console.log("📊 DEPLOYMENT SUMMARY");
  console.log("=".repeat(70));
  
  console.log("\n   🏭 Core Contracts:");
  console.log(`      Factory: ${factoryAddress}`);
  console.log(`      Router: ${routerAddress}`);
  
  console.log("\n   🪙 Tokens Deployed:");
  for (const [symbol, data] of Object.entries(deploymentData.contracts.tokens)) {
    console.log(`      ${symbol}: ${data.address} (${data.decimals} decimals, $${data.price})`);
  }
  
  console.log("\n   🔧 Pool Shards:");
  for (const [pair, shards] of Object.entries(deploymentData.contracts.shards)) {
    console.log(`      ${pair}: ${shards.length} shards`);
    for (const shard of shards) {
      console.log(`         - ${shard.name}: $${shard.liquidityUSD.toLocaleString()}`);
    }
  }
  
  console.log("\n   📈 Statistics:");
  console.log(`      Total Shards: ${totalShards}`);
  console.log(`      Total TVL: $${totalLiquidityUSD.toLocaleString()}`);
  
  console.log("\n   🧪 Test Results:");
  console.log(`      Passed: ${testResults.passed}/${testResults.passed + testResults.failed}`);
  console.log(`      Success Rate: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1)}%`);

  // Save deployment data
  deploymentData.testResults = testResults;
  const filename = `deployment-data/production-risechain-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(deploymentData, null, 2));
  console.log(`\n   💾 Deployment data saved to: ${filename}`);

  if (testResults.failed > 0) {
    console.log("\n   ⚠️  Some tests failed. Review the output above.");
  } else {
    console.log("\n   🎉 All tests passed! Deployment successful.");
  }

  // Print shard algorithm explanation
  console.log("\n" + "=".repeat(70));
  console.log("📚 SAMM SHARD ALGORITHM EXPLANATION");
  console.log("=".repeat(70));
  console.log(`
   HOW SHARDS WORK:
   ================
   1. Shards are MANUALLY created via factory.createShard()
   2. Each shard has different liquidity levels
   3. Shards are NOT automatically created/removed
   
   SHARD SELECTION (c-smaller-better):
   ===================================
   - Router ALWAYS selects the SMALLEST shard that can handle the swap
   - Smaller shards = BETTER swap rates (lower fees)
   - If swap exceeds c-threshold (OA/RA > c), router skips to larger shard
   
   LIQUIDITY MANAGEMENT:
   =====================
   - Add liquidity: pool.addLiquidity() - increases shard size
   - Remove liquidity: pool.removeLiquidity() - decreases shard size
   - Deactivate shard: factory.deactivateShard() - admin only
   
   WHEN TO CREATE NEW SHARDS:
   ==========================
   - When existing shards are too large (poor rates)
   - When you want to offer better rates for small swaps
   - When expanding to new token pairs
   
   c-THRESHOLD FORMULA:
   ====================
   - c = 0.0104 (from SAMM research paper)
   - Max output = Reserve × c
   - If swap exceeds this, router selects larger shard
  `);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
