const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

/**
 * DEMO: How any user can create their own pool and add liquidity
 * 
 * This script shows:
 * 1. Create a new wallet
 * 2. Fund it with ETH from deployer
 * 3. Get tokens from existing deployment
 * 4. Create a new pool shard
 * 5. Add liquidity
 * 6. Test a swap
 */

const GAS_LIMIT = 12000000;
const DEPLOYMENT_FILE = "production-risechain-1770744587343.json";

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🎯 USER POOL CREATION DEMO");
  console.log("=".repeat(80));
  
  // Load deployment
  const deploymentPath = path.join(__dirname, "..", "deployment-data", DEPLOYMENT_FILE);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  
  console.log(`\n📋 Using deployment: ${DEPLOYMENT_FILE}`);
  console.log(`Factory: ${deployment.contracts.factory}`);
  console.log(`Router: ${deployment.contracts.router}`);
  
  // Get deployer (has funds)
  const [deployer] = await ethers.getSigners();
  console.log(`\n💰 Deployer: ${deployer.address}`);
  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  console.log(`   Balance: ${ethers.formatEther(deployerBalance)} ETH`);
  
  // Create new user wallet
  const newUser = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log(`\n👤 New User Created: ${newUser.address}`);
  console.log(`   Private Key: ${newUser.privateKey}`);
  console.log(`   ⚠️  Save this private key to use this wallet later!`);
  
  // Fund new user with ETH
  console.log(`\n💸 Funding new user with 0.002 ETH...`);
  const fundTx = await deployer.sendTransaction({
    to: newUser.address,
    value: ethers.parseEther("0.002")
  });
  await fundTx.wait();
  
  const userBalance = await ethers.provider.getBalance(newUser.address);
  console.log(`   ✅ User balance: ${ethers.formatEther(userBalance)} ETH`);
  
  // Connect to contracts
  const factory = await ethers.getContractAt("SAMMPoolFactory", deployment.contracts.factory, newUser);
  const router = await ethers.getContractAt("CrossPoolRouter", deployment.contracts.router, newUser);
  
  // Get tokens (using deployer's tokens since we don't have a faucet)
  console.log(`\n🪙 Getting tokens for new user...`);
  const USDC = await ethers.getContractAt("MockERC20", deployment.contracts.tokens.USDC.address);
  const DAI = await ethers.getContractAt("MockERC20", deployment.contracts.tokens.DAI.address);
  
  // Transfer tokens from deployer to new user
  console.log(`   Transferring 10,000 USDC...`);
  await USDC.connect(deployer).transfer(newUser.address, ethers.parseUnits("10000", 6));
  
  console.log(`   Transferring 10,000 DAI...`);
  await DAI.connect(deployer).transfer(newUser.address, ethers.parseUnits("10000", 18));
  
  const usdcBalance = await USDC.balanceOf(newUser.address);
  const daiBalance = await DAI.balanceOf(newUser.address);
  console.log(`   ✅ USDC: ${ethers.formatUnits(usdcBalance, 6)}`);
  console.log(`   ✅ DAI: ${ethers.formatUnits(daiBalance, 18)}`);
  
  // STEP 1: Create a new pool shard
  console.log(`\n${"=".repeat(80)}`);
  console.log(`STEP 1: CREATE NEW POOL SHARD`);
  console.log("=".repeat(80));
  
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
  
  console.log(`\nCreating USDC-DAI pool shard...`);
  console.log(`  SAMM Params: beta1=${SAMM_PARAMS.beta1}, rmin=${SAMM_PARAMS.rmin}, rmax=${SAMM_PARAMS.rmax}, c=${SAMM_PARAMS.c}`);
  console.log(`  Fee Params: tradeFee=0.25%, ownerFee=0.05%`);
  
  const createTx = await factory.createShard(
    USDC.target,
    DAI.target,
    SAMM_PARAMS,
    FEE_PARAMS,
    { gasLimit: GAS_LIMIT }
  );
  
  const createReceipt = await createTx.wait();
  
  // Find ShardCreated event
  const shardCreatedEvent = createReceipt.logs.find(log => {
    try {
      return factory.interface.parseLog(log)?.name === "ShardCreated";
    } catch {
      return false;
    }
  });
  
  const poolAddress = factory.interface.parseLog(shardCreatedEvent).args.shard;
  console.log(`\n✅ Pool created: ${poolAddress}`);
  console.log(`   Creator: ${newUser.address}`);
  
  // STEP 2: Initialize pool with liquidity
  console.log(`\n${"=".repeat(80)}`);
  console.log(`STEP 2: ADD INITIAL LIQUIDITY`);
  console.log("=".repeat(80));
  
  const pool = await ethers.getContractAt("SAMMPool", poolAddress, newUser);
  
  // Check token order
  const tokenA = await pool.tokenA();
  const tokenB = await pool.tokenB();
  
  let amount0, amount1, token0Symbol, token1Symbol;
  if (tokenA.toLowerCase() === USDC.target.toLowerCase()) {
    // USDC is tokenA
    amount0 = ethers.parseUnits("5000", 6);  // 5000 USDC
    amount1 = ethers.parseUnits("5000", 18); // 5000 DAI
    token0Symbol = "USDC";
    token1Symbol = "DAI";
  } else {
    // DAI is tokenA
    amount0 = ethers.parseUnits("5000", 18); // 5000 DAI
    amount1 = ethers.parseUnits("5000", 6);  // 5000 USDC
    token0Symbol = "DAI";
    token1Symbol = "USDC";
  }
  
  console.log(`\nPool token order:`);
  console.log(`  TokenA: ${token0Symbol} (${tokenA})`);
  console.log(`  TokenB: ${token1Symbol} (${tokenB})`);
  
  console.log(`\nApproving tokens...`);
  await USDC.connect(newUser).approve(factory.target, ethers.parseUnits("10000", 6));
  await DAI.connect(newUser).approve(factory.target, ethers.parseUnits("10000", 18));
  console.log(`  ✅ Tokens approved`);
  
  console.log(`\nInitializing pool with:`);
  console.log(`  ${token0Symbol}: ${ethers.formatUnits(amount0, token0Symbol === "USDC" ? 6 : 18)}`);
  console.log(`  ${token1Symbol}: ${ethers.formatUnits(amount1, token1Symbol === "USDC" ? 6 : 18)}`);
  
  const initTx = await factory.initializeShard(poolAddress, amount0, amount1, { gasLimit: GAS_LIMIT });
  await initTx.wait();
  
  console.log(`\n✅ Pool initialized!`);
  
  // Check pool state
  const reserves = await pool.getReserves();
  const lpBalance = await pool.balanceOf(newUser.address);
  
  console.log(`\nPool state:`);
  console.log(`  Reserve ${token0Symbol}: ${ethers.formatUnits(reserves[0], token0Symbol === "USDC" ? 6 : 18)}`);
  console.log(`  Reserve ${token1Symbol}: ${ethers.formatUnits(reserves[1], token1Symbol === "USDC" ? 6 : 18)}`);
  console.log(`  LP tokens: ${ethers.formatUnits(lpBalance, 18)}`);
  console.log(`  Liquidity: $${(5000 + 5000).toLocaleString()}`);
  
  // STEP 3: Test a swap
  console.log(`\n${"=".repeat(80)}`);
  console.log(`STEP 3: TEST SWAP`);
  console.log("=".repeat(80));
  
  console.log(`\nSwapping 100 USDC → DAI...`);
  
  // Approve router
  await USDC.connect(newUser).approve(router.target, ethers.parseUnits("200", 6));
  
  const usdcBefore = await USDC.balanceOf(newUser.address);
  const daiBefore = await DAI.balanceOf(newUser.address);
  
  const swapTx = await router.swapExactOutput({
    hops: [{
      tokenIn: USDC.target,
      tokenOut: DAI.target,
      amountOut: ethers.parseUnits("100", 18)
    }],
    maxAmountIn: ethers.parseUnits("105", 6),
    deadline: Math.floor(Date.now() / 1000) + 600,
    recipient: newUser.address
  }, { gasLimit: GAS_LIMIT });
  
  await swapTx.wait();
  
  const usdcAfter = await USDC.balanceOf(newUser.address);
  const daiAfter = await DAI.balanceOf(newUser.address);
  
  const usdcSpent = usdcBefore - usdcAfter;
  const daiReceived = daiAfter - daiBefore;
  
  console.log(`\n✅ Swap successful!`);
  console.log(`  USDC spent: ${ethers.formatUnits(usdcSpent, 6)}`);
  console.log(`  DAI received: ${ethers.formatUnits(daiReceived, 18)}`);
  console.log(`  Rate: ${(parseFloat(ethers.formatUnits(usdcSpent, 6)) / parseFloat(ethers.formatUnits(daiReceived, 18))).toFixed(4)} USDC per DAI`);
  
  // Final balances
  console.log(`\n${"=".repeat(80)}`);
  console.log(`FINAL BALANCES`);
  console.log("=".repeat(80));
  
  const finalUSDC = await USDC.balanceOf(newUser.address);
  const finalDAI = await DAI.balanceOf(newUser.address);
  const finalETH = await ethers.provider.getBalance(newUser.address);
  
  console.log(`\nUser: ${newUser.address}`);
  console.log(`  ETH: ${ethers.formatEther(finalETH)}`);
  console.log(`  USDC: ${ethers.formatUnits(finalUSDC, 6)}`);
  console.log(`  DAI: ${ethers.formatUnits(finalDAI, 18)}`);
  console.log(`  LP tokens: ${ethers.formatUnits(lpBalance, 18)}`);
  
  // Summary
  console.log(`\n${"=".repeat(80)}`);
  console.log(`✅ DEMO COMPLETED SUCCESSFULLY!`);
  console.log("=".repeat(80));
  
  console.log(`\n📝 Summary:`);
  console.log(`  1. Created new user wallet: ${newUser.address}`);
  console.log(`  2. Funded with 0.002 ETH`);
  console.log(`  3. Received 10,000 USDC and 10,000 DAI`);
  console.log(`  4. Created new USDC-DAI pool: ${poolAddress}`);
  console.log(`  5. Added $10,000 liquidity (5000 USDC + 5000 DAI)`);
  console.log(`  6. Executed test swap: 100 USDC → DAI`);
  
  console.log(`\n🔑 Save this info to continue using this pool:`);
  console.log(`  User Private Key: ${newUser.privateKey}`);
  console.log(`  Pool Address: ${poolAddress}`);
  console.log(`  Factory: ${factory.target}`);
  console.log(`  Router: ${router.target}`);
  
  console.log(`\n💡 Next steps:`);
  console.log(`  - Add more liquidity: pool.addLiquidity()`);
  console.log(`  - Remove liquidity: pool.removeLiquidity()`);
  console.log(`  - Execute more swaps through the router`);
  console.log(`  - Create additional shards for other pairs`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
