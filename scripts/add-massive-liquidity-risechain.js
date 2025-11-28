const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Adding Massive Liquidity to Existing RiseChain Deployment");
  console.log("=".repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider("https://testnet.riselabs.xyz");
  const wallet = new ethers.Wallet("9387e097a14f64f865d10cc50835d3b16c3683f2e2cebd518b2456260f1e59ad", provider);
  const testingAddress = "0x0fb795cfc581666932abafe438bd3ce6702da69c";

  console.log("📋 Operation Details:");
  console.log(`Network: RiseChain Testnet`);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Testing Address: ${testingAddress}`);

  // Load existing deployment data
  const deploymentDir = path.join(__dirname, "..", "deployment-data");
  const files = fs.readdirSync(deploymentDir);
  const riseChainFile = files.find(f => f.includes('risechain') && f.endsWith('.json'));
  
  if (!riseChainFile) {
    throw new Error("❌ No RiseChain deployment file found!");
  }

  const deploymentData = JSON.parse(fs.readFileSync(path.join(deploymentDir, riseChainFile), 'utf8'));
  console.log(`📄 Using deployment: ${riseChainFile}`);

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
  console.log(`DAI: ${daiAddress}`);

  // Connect to existing contracts
  const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
  const usdc = MockERC20.attach(usdcAddress);
  const usdt = MockERC20.attach(usdtAddress);
  const dai = MockERC20.attach(daiAddress);

  console.log("\n💰 Minting massive amounts of tokens...");

  // Get current nonce and manage it manually
  let nonce = await provider.getTransactionCount(wallet.address);
  console.log(`Starting nonce: ${nonce}`);

  // Mint massive amounts for production testing
  const massiveUsdcAmount = ethers.parseUnits("100000000", 6); // 100M USDC
  const massiveUsdtAmount = ethers.parseUnits("100000000", 6); // 100M USDT
  const massiveDaiAmount = ethers.parseUnits("100000000", 18); // 100M DAI

  // Mint to deployer with manual nonce management
  console.log("Minting to deployer...");
  await usdc.mint(wallet.address, massiveUsdcAmount, { nonce: nonce++ });
  console.log("✅ Minted 100,000,000 USDC to deployer");
  
  await usdt.mint(wallet.address, massiveUsdtAmount, { nonce: nonce++ });
  console.log("✅ Minted 100,000,000 USDT to deployer");
  
  await dai.mint(wallet.address, massiveDaiAmount, { nonce: nonce++ });
  console.log("✅ Minted 100,000,000 DAI to deployer");

  // Mint to testing address
  const testingUsdcAmount = ethers.parseUnits("50000000", 6); // 50M USDC
  const testingUsdtAmount = ethers.parseUnits("50000000", 6); // 50M USDT
  const testingDaiAmount = ethers.parseUnits("50000000", 18); // 50M DAI

  console.log("Minting to testing address...");
  await usdc.mint(testingAddress, testingUsdcAmount, { nonce: nonce++ });
  console.log(`✅ Minted 50,000,000 USDC to testing address: ${testingAddress}`);
  
  await usdt.mint(testingAddress, testingUsdtAmount, { nonce: nonce++ });
  console.log(`✅ Minted 50,000,000 USDT to testing address: ${testingAddress}`);
  
  await dai.mint(testingAddress, testingDaiAmount, { nonce: nonce++ });
  console.log(`✅ Minted 50,000,000 DAI to testing address: ${testingAddress}`);

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
  console.log(`Found ${usdcDaiShards.length} USDC/DAI shards`);

  // Massive liquidity amounts for each shard (production scale)
  const massiveLiquidityLevels = [
    { usdc: "20000000", usdt: "20000000", dai: "20000000" },   // 20M each - Massive shard
    { usdc: "15000000", usdt: "15000000", dai: "15000000" },   // 15M each - Very large shard
    { usdc: "10000000", usdt: "10000000", dai: "10000000" },   // 10M each - Large shard
    { usdc: "8000000", usdt: "8000000", dai: "8000000" },      // 8M each - Medium-large shard
    { usdc: "5000000", usdt: "5000000", dai: "5000000" }       // 5M each - Medium shard
  ];

  // Add massive liquidity to USDC/USDT shards using direct transfers
  if (usdcUsdtShards.length > 0) {
    console.log("💰 Adding massive liquidity to USDC/USDT shards via direct transfers...");
    for (let i = 0; i < usdcUsdtShards.length; i++) {
      const liquidityLevel = massiveLiquidityLevels[i] || massiveLiquidityLevels[massiveLiquidityLevels.length - 1];
      const amount0 = ethers.parseUnits(liquidityLevel.usdc, 6); // USDC
      const amount1 = ethers.parseUnits(liquidityLevel.usdt, 6); // USDT
      
      console.log(`  Transferring ${liquidityLevel.usdc} USDC + ${liquidityLevel.usdt} USDT to shard ${i + 1}...`);
      
      // Direct transfer to shard (this will increase the reserves)
      await usdc.transfer(usdcUsdtShards[i], amount0, { nonce: nonce++ });
      await usdt.transfer(usdcUsdtShards[i], amount1, { nonce: nonce++ });
      
      console.log(`✅ Transferred ${liquidityLevel.usdc} USDC + ${liquidityLevel.usdt} USDT to USDC/USDT shard ${i + 1}`);
    }
  }

  // Add massive liquidity to USDC/DAI shards using direct transfers
  if (usdcDaiShards.length > 0) {
    console.log("💰 Adding massive liquidity to USDC/DAI shards via direct transfers...");
    for (let i = 0; i < usdcDaiShards.length; i++) {
      const liquidityLevel = massiveLiquidityLevels[i] || massiveLiquidityLevels[massiveLiquidityLevels.length - 1];
      const amount0 = ethers.parseUnits(liquidityLevel.usdc, 6); // USDC
      const amount1 = ethers.parseUnits(liquidityLevel.dai, 18); // DAI
      
      console.log(`  Transferring ${liquidityLevel.usdc} USDC + ${liquidityLevel.dai} DAI to shard ${i + 1}...`);
      
      // Direct transfer to shard (this will increase the reserves)
      await usdc.transfer(usdcDaiShards[i], amount0, { nonce: nonce++ });
      await dai.transfer(usdcDaiShards[i], amount1, { nonce: nonce++ });
      
      console.log(`✅ Transferred ${liquidityLevel.usdc} USDC + ${liquidityLevel.dai} DAI to USDC/DAI shard ${i + 1}`);
    }
  }

  console.log("\n📊 Checking final token balances...");
  
  // Check deployer balances
  const deployerUsdcBalance = await usdc.balanceOf(wallet.address);
  const deployerUsdtBalance = await usdt.balanceOf(wallet.address);
  const deployerDaiBalance = await dai.balanceOf(wallet.address);
  
  console.log(`Deployer USDC: ${ethers.formatUnits(deployerUsdcBalance, 6)}`);
  console.log(`Deployer USDT: ${ethers.formatUnits(deployerUsdtBalance, 6)}`);
  console.log(`Deployer DAI: ${ethers.formatUnits(deployerDaiBalance, 18)}`);

  // Check testing address balances
  const testingUsdcBalance = await usdc.balanceOf(testingAddress);
  const testingUsdtBalance = await usdt.balanceOf(testingAddress);
  const testingDaiBalance = await dai.balanceOf(testingAddress);
  
  console.log(`Testing Address USDC: ${ethers.formatUnits(testingUsdcBalance, 6)}`);
  console.log(`Testing Address USDT: ${ethers.formatUnits(testingUsdtBalance, 6)}`);
  console.log(`Testing Address DAI: ${ethers.formatUnits(testingDaiBalance, 18)}`);

  // Check shard balances to verify liquidity was added
  console.log("\n📈 Verifying shard liquidity...");
  
  let totalLiquidityValue = 0;
  
  for (let i = 0; i < usdcUsdtShards.length; i++) {
    const usdcBalance = await usdc.balanceOf(usdcUsdtShards[i]);
    const usdtBalance = await usdt.balanceOf(usdcUsdtShards[i]);
    const usdcFormatted = ethers.formatUnits(usdcBalance, 6);
    const usdtFormatted = ethers.formatUnits(usdtBalance, 6);
    const shardValue = parseFloat(usdcFormatted) + parseFloat(usdtFormatted);
    totalLiquidityValue += shardValue;
    console.log(`  USDC/USDT Shard ${i + 1}: ${usdcFormatted} USDC + ${usdtFormatted} USDT (~$${shardValue.toLocaleString()})`);
  }
  
  for (let i = 0; i < usdcDaiShards.length; i++) {
    const usdcBalance = await usdc.balanceOf(usdcDaiShards[i]);
    const daiBalance = await dai.balanceOf(usdcDaiShards[i]);
    const usdcFormatted = ethers.formatUnits(usdcBalance, 6);
    const daiFormatted = ethers.formatUnits(daiBalance, 18);
    const shardValue = parseFloat(usdcFormatted) + parseFloat(daiFormatted);
    totalLiquidityValue += shardValue;
    console.log(`  USDC/DAI Shard ${i + 1}: ${usdcFormatted} USDC + ${daiFormatted} DAI (~$${shardValue.toLocaleString()})`);
  }

  console.log(`\n💎 Total Liquidity in Shards: ~$${totalLiquidityValue.toLocaleString()}`);

  console.log("\n🎉 Successfully Added Massive Liquidity to RiseChain Deployment!");
  console.log("=".repeat(60));
  console.log("✅ All shards now have massive production-scale liquidity");
  console.log("✅ Testing address has been funded with 50M of each token");
  console.log("✅ Deployer has additional tokens for further operations");
  console.log("✅ All pools are ready for high-volume trading and testing");
  console.log(`✅ Total liquidity deployed: ~$${totalLiquidityValue.toLocaleString()}`);

  return {
    success: true,
    totalLiquidityValue,
    shardsUpdated: usdcUsdtShards.length + usdcDaiShards.length,
    testingAddressFunded: true
  };
}

main()
  .then((result) => {
    console.log(`\n✅ Massive liquidity addition completed successfully`);
    console.log(`📊 Updated ${result.shardsUpdated} shards with ~$${result.totalLiquidityValue.toLocaleString()} total liquidity`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Massive liquidity addition failed:");
    console.error(error);
    process.exit(1);
  });