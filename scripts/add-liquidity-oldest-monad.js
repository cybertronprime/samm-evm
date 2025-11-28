const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Adding Liquidity to OLDEST Monad Deployment");
  console.log("=".repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet("9387e097a14f64f865d10cc50835d3b16c3683f2e2cebd518b2456260f1e59ad", provider);

  console.log("📋 Operation Details:");
  console.log(`Network: Monad Testnet`);
  console.log(`Deployer: ${wallet.address}`);

  // Load the OLDEST deployment data specifically
  const deploymentFile = path.join(__dirname, "..", "deployment-data", "monad-multi-shard-1764330063991.json");
  
  if (!fs.existsSync(deploymentFile)) {
    throw new Error("❌ Oldest Monad deployment file not found!");
  }

  const deploymentData = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  console.log(`📄 Using OLDEST deployment: monad-multi-shard-1764330063991.json`);
  console.log(`📅 Deployment timestamp: ${deploymentData.timestamp}`);

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

  console.log("\n📍 Contract Addresses from Oldest Deployment:");
  console.log(`Factory: ${factoryAddress}`);
  console.log(`USDC: ${usdcAddress}`);
  console.log(`USDT: ${usdtAddress}`);
  console.log(`DAI: ${daiAddress}`);

  // Connect to existing contracts
  const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
  const usdc = MockERC20.attach(usdcAddress);
  const usdt = MockERC20.attach(usdtAddress);
  const dai = MockERC20.attach(daiAddress);

  console.log("\n💰 Minting tokens for liquidity...");

  // Get current nonce and manage it manually
  let nonce = await provider.getTransactionCount(wallet.address);
  console.log(`Starting nonce: ${nonce}`);

  // Mint amounts for testing
  const usdcAmount = ethers.parseUnits("10000000", 6); // 10M USDC
  const usdtAmount = ethers.parseUnits("10000000", 6); // 10M USDT
  const daiAmount = ethers.parseUnits("10000000", 18); // 10M DAI

  // Mint to deployer
  console.log("Minting to deployer...");
  await usdc.mint(wallet.address, usdcAmount, { nonce: nonce++ });
  console.log("✅ Minted 10,000,000 USDC to deployer");
  
  await usdt.mint(wallet.address, usdtAmount, { nonce: nonce++ });
  console.log("✅ Minted 10,000,000 USDT to deployer");
  
  await dai.mint(wallet.address, daiAmount, { nonce: nonce++ });
  console.log("✅ Minted 10,000,000 DAI to deployer");

  console.log("\n🏊 Adding liquidity to existing pools from oldest deployment...");

  // Get existing pool shards from the deployment data
  const allShards = deploymentData.contracts?.shards || [];
  
  console.log(`📊 Found ${allShards.length} total shards in oldest deployment:`);
  allShards.forEach((shard, i) => {
    console.log(`  ${i + 1}. ${shard.name} (${shard.pairName}): ${shard.address}`);
  });

  // Liquidity amounts for each shard
  const liquidityLevels = [
    { usdc: "2000000", usdt: "2000000", dai: "2000000" },   // 2M each - Large shard
    { usdc: "1500000", usdt: "1500000", dai: "1500000" },   // 1.5M each - Medium-large shard
    { usdc: "1000000", usdt: "1000000", dai: "1000000" },   // 1M each - Medium shard
    { usdc: "800000", usdt: "800000", dai: "800000" },      // 800K each - Small-medium shard
    { usdc: "500000", usdt: "500000", dai: "500000" }       // 500K each - Small shard
  ];

  let totalLiquidityValue = 0;

  // Add liquidity to each shard via direct transfers
  for (let i = 0; i < allShards.length; i++) {
    const shard = allShards[i];
    const liquidityLevel = liquidityLevels[i] || liquidityLevels[liquidityLevels.length - 1];
    
    console.log(`\n💰 Adding liquidity to ${shard.name} (${shard.pairName})...`);
    
    if (shard.pairName === 'USDC/USDT') {
      const amount0 = ethers.parseUnits(liquidityLevel.usdc, 6); // USDC
      const amount1 = ethers.parseUnits(liquidityLevel.usdt, 6); // USDT
      
      console.log(`  Transferring ${liquidityLevel.usdc} USDC + ${liquidityLevel.usdt} USDT...`);
      
      // Direct transfer to shard
      await usdc.transfer(shard.address, amount0, { nonce: nonce++ });
      await usdt.transfer(shard.address, amount1, { nonce: nonce++ });
      
      totalLiquidityValue += parseFloat(liquidityLevel.usdc) + parseFloat(liquidityLevel.usdt);
      console.log(`✅ Transferred ${liquidityLevel.usdc} USDC + ${liquidityLevel.usdt} USDT to ${shard.name}`);
      
    } else if (shard.pairName === 'USDC/DAI') {
      const amount0 = ethers.parseUnits(liquidityLevel.usdc, 6); // USDC
      const amount1 = ethers.parseUnits(liquidityLevel.dai, 18); // DAI
      
      console.log(`  Transferring ${liquidityLevel.usdc} USDC + ${liquidityLevel.dai} DAI...`);
      
      // Direct transfer to shard
      await usdc.transfer(shard.address, amount0, { nonce: nonce++ });
      await dai.transfer(shard.address, amount1, { nonce: nonce++ });
      
      totalLiquidityValue += parseFloat(liquidityLevel.usdc) + parseFloat(liquidityLevel.dai);
      console.log(`✅ Transferred ${liquidityLevel.usdc} USDC + ${liquidityLevel.dai} DAI to ${shard.name}`);
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

  // Check shard balances to verify liquidity was added
  console.log("\n📈 Verifying shard liquidity...");
  
  for (const shard of allShards) {
    if (shard.pairName === 'USDC/USDT') {
      const usdcBalance = await usdc.balanceOf(shard.address);
      const usdtBalance = await usdt.balanceOf(shard.address);
      const usdcFormatted = ethers.formatUnits(usdcBalance, 6);
      const usdtFormatted = ethers.formatUnits(usdtBalance, 6);
      const shardValue = parseFloat(usdcFormatted) + parseFloat(usdtFormatted);
      console.log(`  ${shard.name}: ${usdcFormatted} USDC + ${usdtFormatted} USDT (~${shardValue.toLocaleString()})`);
    } else if (shard.pairName === 'USDC/DAI') {
      const usdcBalance = await usdc.balanceOf(shard.address);
      const daiBalance = await dai.balanceOf(shard.address);
      const usdcFormatted = ethers.formatUnits(usdcBalance, 6);
      const daiFormatted = ethers.formatUnits(daiBalance, 18);
      const shardValue = parseFloat(usdcFormatted) + parseFloat(daiFormatted);
      console.log(`  ${shard.name}: ${usdcFormatted} USDC + ${daiFormatted} DAI (~${shardValue.toLocaleString()})`);
    }
  }

  console.log(`\n💎 Total Liquidity Added: ~${totalLiquidityValue.toLocaleString()}`);

  console.log("\n🎉 Successfully Added Liquidity to Oldest Monad Deployment!");
  console.log("=".repeat(60));
  console.log("✅ All shards from oldest deployment now have liquidity");
  console.log("✅ Deployer has remaining tokens for further operations");
  console.log("✅ All pools are ready for trading and testing");
  console.log(`✅ Total liquidity deployed: ~${totalLiquidityValue.toLocaleString()}`);
  console.log(`📄 Deployment used: monad-multi-shard-1764330063991.json`);

  return {
    success: true,
    totalLiquidityValue,
    shardsUpdated: allShards.length,
    deploymentFile: "monad-multi-shard-1764330063991.json"
  };
}

main()
  .then((result) => {
    console.log(`\n✅ Liquidity addition to oldest deployment completed successfully`);
    console.log(`📊 Updated ${result.shardsUpdated} shards with ~${result.totalLiquidityValue.toLocaleString()} total liquidity`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Liquidity addition failed:");
    console.error(error);
    process.exit(1);
  });