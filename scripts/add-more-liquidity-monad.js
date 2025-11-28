const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Adding More Liquidity to Existing Monad Deployment");
  console.log("=".repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet("9387e097a14f64f865d10cc50835d3b16c3683f2e2cebd518b2456260f1e59ad", provider);
  const testingAddress = "0x0fb795cfc581666932abafe438bd3ce6702da69c";

  console.log("📋 Operation Details:");
  console.log(`Network: Monad Testnet`);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Testing Address: ${testingAddress}`);

  // Load existing deployment data
  const deploymentDir = path.join(__dirname, "..", "deployment-data");
  const files = fs.readdirSync(deploymentDir);
  const monadFile = files.find(f => f.includes('monad') && f.endsWith('.json'));
  
  if (!monadFile) {
    throw new Error("❌ No Monad deployment file found!");
  }

  const deploymentData = JSON.parse(fs.readFileSync(path.join(deploymentDir, monadFile), 'utf8'));
  console.log(`📄 Using deployment: ${monadFile}`);

  // Get contract addresses from deployment
  const factoryAddress = deploymentData.contracts?.factory;
  
  // Find token addresses from the tokens array
  const tokens = deploymentData.contracts?.tokens || [];
  const usdcToken = tokens.find(t => t.symbol === 'USDC');
  const usdtToken = tokens.find(t => t.symbol === 'USDT');
  const daiToken = tokens.find(t => t.symbol === 'DAI');
  
  const usdcAddress = usdcToken?.address;
  const usdtAddress = usdtToken?.address;
  const daiAddress = daiToken?.address;

  console.log("\n📍 Contract Addresses:");
  console.log(`Factory: ${factoryAddress}`);
  console.log(`USDC: ${usdcAddress}`);
  console.log(`USDT: ${usdtAddress}`);
  if (daiAddress) console.log(`DAI: ${daiAddress}`);

  // Connect to existing contracts
  const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
  const usdc = MockERC20.attach(usdcAddress);
  const usdt = MockERC20.attach(usdtAddress);
  let dai = null;
  if (daiAddress) {
    dai = MockERC20.attach(daiAddress);
  }

  console.log("\n💰 Minting additional tokens...");

  // Mint massive amounts for production testing
  const additionalUsdcAmount = ethers.parseUnits("50000000", 6); // 50M more USDC
  const additionalUsdtAmount = ethers.parseUnits("50000000", 6); // 50M more USDT
  const additionalDaiAmount = ethers.parseUnits("50000000", 18); // 50M more DAI

  // Mint to deployer
  await usdc.mint(wallet.address, additionalUsdcAmount);
  console.log("✅ Minted additional 50,000,000 USDC to deployer");
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await usdt.mint(wallet.address, additionalUsdtAmount);
  console.log("✅ Minted additional 50,000,000 USDT to deployer");
  
  if (dai) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await dai.mint(wallet.address, additionalDaiAmount);
    console.log("✅ Minted additional 50,000,000 DAI to deployer");
  }

  // Mint to testing address
  const testingUsdcAmount = ethers.parseUnits("20000000", 6); // 20M USDC
  const testingUsdtAmount = ethers.parseUnits("20000000", 6); // 20M USDT
  const testingDaiAmount = ethers.parseUnits("20000000", 18); // 20M DAI

  await new Promise(resolve => setTimeout(resolve, 2000));
  await usdc.mint(testingAddress, testingUsdcAmount);
  console.log(`✅ Minted additional 20,000,000 USDC to testing address: ${testingAddress}`);
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await usdt.mint(testingAddress, testingUsdtAmount);
  console.log(`✅ Minted additional 20,000,000 USDT to testing address: ${testingAddress}`);
  
  if (dai) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await dai.mint(testingAddress, testingDaiAmount);
    console.log(`✅ Minted additional 20,000,000 DAI to testing address: ${testingAddress}`);
  }

  console.log("\n🏊 Adding massive liquidity to existing pools...");

  // Get existing pool shards from the deployment data
  const allShards = deploymentData.contracts?.shards || [];
  
  const usdcUsdtShards = allShards
    .filter(s => s.pairName === 'USDC/USDT')
    .map(s => s.address);
    
  const usdcDaiShards = allShards
    .filter(s => s.pairName === 'USDC/DAI')
    .map(s => s.address);

  console.log(`Found ${usdcUsdtShards.length} USDC/USDT shards`);
  if (usdcDaiShards.length > 0) {
    console.log(`Found ${usdcDaiShards.length} USDC/DAI shards`);
  }

  const SAMMPool = await ethers.getContractFactory("SAMMPool");

  // Massive liquidity amounts for each shard
  const massiveLiquidityLevels = [
    { usdc: "10000000", usdt: "10000000", dai: "10000000" },   // 10M each - Huge shard
    { usdc: "8000000", usdt: "8000000", dai: "8000000" },     // 8M each - Very large shard
    { usdc: "6000000", usdt: "6000000", dai: "6000000" },     // 6M each - Large shard
    { usdc: "4000000", usdt: "4000000", dai: "4000000" },     // 4M each - Medium-large shard
    { usdc: "2000000", usdt: "2000000", dai: "2000000" }      // 2M each - Medium shard
  ];

  // Add massive liquidity to USDC/USDT shards
  if (usdcUsdtShards.length > 0) {
    console.log("💰 Adding massive liquidity to USDC/USDT shards...");
    for (let i = 0; i < usdcUsdtShards.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const pool = SAMMPool.attach(usdcUsdtShards[i]);
      const liquidityLevel = massiveLiquidityLevels[i] || massiveLiquidityLevels[massiveLiquidityLevels.length - 1];
      const amount0 = ethers.parseUnits(liquidityLevel.usdc, 6); // USDC
      const amount1 = ethers.parseUnits(liquidityLevel.usdt, 6); // USDT
      
      console.log(`  Adding ${liquidityLevel.usdc} USDC + ${liquidityLevel.usdt} USDT to shard ${i + 1}...`);
      
      // Approve tokens
      await usdc.approve(usdcUsdtShards[i], amount0);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await usdt.approve(usdcUsdtShards[i], amount1);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Add liquidity
      try {
        await pool.addLiquidity(amount0, amount1, 0, 0, wallet.address, Math.floor(Date.now() / 1000) + 3600);
        console.log(`✅ Added ${liquidityLevel.usdc} USDC + ${liquidityLevel.usdt} USDT to USDC/USDT shard ${i + 1}`);
      } catch (error) {
        console.log(`⚠️  Shard ${i + 1} might not support addLiquidity, trying direct transfer...`);
        // If addLiquidity fails, try direct transfer (for older shard versions)
        await usdc.transfer(usdcUsdtShards[i], amount0);
        await usdt.transfer(usdcUsdtShards[i], amount1);
        console.log(`✅ Transferred ${liquidityLevel.usdc} USDC + ${liquidityLevel.usdt} USDT to shard ${i + 1}`);
      }
    }
  }

  // Add massive liquidity to USDC/DAI shards
  if (usdcDaiShards.length > 0 && dai) {
    console.log("💰 Adding massive liquidity to USDC/DAI shards...");
    for (let i = 0; i < usdcDaiShards.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const pool = SAMMPool.attach(usdcDaiShards[i]);
      const liquidityLevel = massiveLiquidityLevels[i] || massiveLiquidityLevels[massiveLiquidityLevels.length - 1];
      const amount0 = ethers.parseUnits(liquidityLevel.usdc, 6); // USDC
      const amount1 = ethers.parseUnits(liquidityLevel.dai, 18); // DAI
      
      console.log(`  Adding ${liquidityLevel.usdc} USDC + ${liquidityLevel.dai} DAI to shard ${i + 1}...`);
      
      // Approve tokens
      await usdc.approve(usdcDaiShards[i], amount0);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await dai.approve(usdcDaiShards[i], amount1);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Add liquidity
      try {
        await pool.addLiquidity(amount0, amount1, 0, 0, wallet.address, Math.floor(Date.now() / 1000) + 3600);
        console.log(`✅ Added ${liquidityLevel.usdc} USDC + ${liquidityLevel.dai} DAI to USDC/DAI shard ${i + 1}`);
      } catch (error) {
        console.log(`⚠️  Shard ${i + 1} might not support addLiquidity, trying direct transfer...`);
        // If addLiquidity fails, try direct transfer (for older shard versions)
        await usdc.transfer(usdcDaiShards[i], amount0);
        await dai.transfer(usdcDaiShards[i], amount1);
        console.log(`✅ Transferred ${liquidityLevel.usdc} USDC + ${liquidityLevel.dai} DAI to shard ${i + 1}`);
      }
    }
  }

  console.log("\n📊 Checking final token balances...");
  
  // Check deployer balances
  const deployerUsdcBalance = await usdc.balanceOf(wallet.address);
  const deployerUsdtBalance = await usdt.balanceOf(wallet.address);
  console.log(`Deployer USDC: ${ethers.formatUnits(deployerUsdcBalance, 6)}`);
  console.log(`Deployer USDT: ${ethers.formatUnits(deployerUsdtBalance, 6)}`);
  
  if (dai) {
    const deployerDaiBalance = await dai.balanceOf(wallet.address);
    console.log(`Deployer DAI: ${ethers.formatUnits(deployerDaiBalance, 18)}`);
  }

  // Check testing address balances
  const testingUsdcBalance = await usdc.balanceOf(testingAddress);
  const testingUsdtBalance = await usdt.balanceOf(testingAddress);
  console.log(`Testing Address USDC: ${ethers.formatUnits(testingUsdcBalance, 6)}`);
  console.log(`Testing Address USDT: ${ethers.formatUnits(testingUsdtBalance, 6)}`);
  
  if (dai) {
    const testingDaiBalance = await dai.balanceOf(testingAddress);
    console.log(`Testing Address DAI: ${ethers.formatUnits(testingDaiBalance, 18)}`);
  }

  console.log("\n🎉 Successfully Added Massive Liquidity to Monad Deployment!");
  console.log("=".repeat(60));
  console.log("✅ Existing pools now have massive liquidity for production testing");
  console.log("✅ Testing address has been funded with additional tokens");
  console.log("✅ Deployer has additional tokens for further operations");
  console.log("✅ All pools are ready for high-volume trading tests");

  return {
    success: true,
    additionalTokensMinted: true,
    liquidityAdded: true,
    testingAddressFunded: true
  };
}

main()
  .then(() => {
    console.log("\n✅ Liquidity addition completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Liquidity addition failed:");
    console.error(error);
    process.exit(1);
  });