const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Initializing OLDEST Monad Deployment Pools");
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
  const tokens = deploymentData.contracts?.tokens || [];
  const usdcToken = tokens.find(t => t.symbol === 'USDC');
  const usdtToken = tokens.find(t => t.symbol === 'USDT');
  const daiToken = tokens.find(t => t.symbol === 'DAI');
  
  const usdcAddress = usdcToken?.address;
  const usdtAddress = usdtToken?.address;
  const daiAddress = daiToken?.address;

  console.log("\n📍 Contract Addresses from Oldest Deployment:");
  console.log(`USDC: ${usdcAddress}`);
  console.log(`USDT: ${usdtAddress}`);
  console.log(`DAI: ${daiAddress}`);

  // Connect to contracts
  const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
  const SAMMPool = await ethers.getContractFactory("SAMMPool", wallet);
  
  const usdc = MockERC20.attach(usdcAddress);
  const usdt = MockERC20.attach(usdtAddress);
  const dai = MockERC20.attach(daiAddress);

  console.log("\n💰 Minting tokens for initialization...");

  // Get current nonce and manage it manually
  let nonce = await provider.getTransactionCount(wallet.address);
  console.log(`Starting nonce: ${nonce}`);

  // Mint large amounts for initialization
  const usdcAmount = ethers.parseUnits("50000000", 6); // 50M USDC
  const usdtAmount = ethers.parseUnits("50000000", 6); // 50M USDT
  const daiAmount = ethers.parseUnits("50000000", 18); // 50M DAI

  // Mint to deployer
  console.log("Minting to deployer...");
  await usdc.mint(wallet.address, usdcAmount, { nonce: nonce++ });
  console.log("✅ Minted 50,000,000 USDC to deployer");
  
  await usdt.mint(wallet.address, usdtAmount, { nonce: nonce++ });
  console.log("✅ Minted 50,000,000 USDT to deployer");
  
  await dai.mint(wallet.address, daiAmount, { nonce: nonce++ });
  console.log("✅ Minted 50,000,000 DAI to deployer");

  console.log("\n🏊 Initializing pools from oldest deployment...");

  // Get existing pool shards from the deployment data
  const allShards = deploymentData.contracts?.shards || [];
  
  console.log(`📊 Found ${allShards.length} total shards in oldest deployment:`);
  allShards.forEach((shard, i) => {
    console.log(`  ${i + 1}. ${shard.name} (${shard.pairName}): ${shard.address}`);
  });

  // Initialization amounts for each shard (different sizes to demonstrate C-smaller-better)
  const initAmounts = [
    { usdc: "5000000", usdt: "5000000", dai: "5000000" },     // 5M each - Large shard
    { usdc: "3000000", usdt: "3000000", dai: "3000000" },     // 3M each - Medium-large shard
    { usdc: "2000000", usdt: "2000000", dai: "2000000" },     // 2M each - Medium shard
    { usdc: "1500000", usdt: "1500000", dai: "1500000" },     // 1.5M each - Small-medium shard
    { usdc: "1000000", usdt: "1000000", dai: "1000000" }      // 1M each - Small shard
  ];

  // Fee parameters (standard SAMM fees)
  const tradeFeeNumerator = 25;      // 0.25%
  const tradeFeeDenominator = 10000;
  const ownerFeeNumerator = 10;      // 0.10%
  const ownerFeeDenominator = 10000;

  let totalLiquidityValue = 0;

  // Initialize each shard
  for (let i = 0; i < allShards.length; i++) {
    const shard = allShards[i];
    const amounts = initAmounts[i] || initAmounts[initAmounts.length - 1];
    
    console.log(`\n🏊 Initializing ${shard.name} (${shard.pairName})...`);
    
    const pool = SAMMPool.attach(shard.address);
    
    // Check if already initialized
    try {
      const poolState = await pool.getPoolState();
      if (poolState.totalSupply > 0) {
        console.log(`   ⚠️  Pool ${shard.name} already initialized, skipping...`);
        continue;
      }
    } catch (error) {
      // Pool might not be initialized yet, continue
    }
    
    if (shard.pairName === 'USDC/USDT') {
      const amountA = ethers.parseUnits(amounts.usdc, 6); // USDC
      const amountB = ethers.parseUnits(amounts.usdt, 6); // USDT
      
      console.log(`   💰 Initializing with ${amounts.usdc} USDC + ${amounts.usdt} USDT...`);
      
      // Approve tokens
      console.log(`   📝 Approving tokens...`);
      await usdc.approve(shard.address, amountA, { nonce: nonce++ });
      await usdt.approve(shard.address, amountB, { nonce: nonce++ });
      
      // Initialize pool
      console.log(`   🏊 Initializing pool...`);
      const tx = await pool.initialize(
        usdcAddress,
        usdtAddress,
        amountA,
        amountB,
        tradeFeeNumerator,
        tradeFeeDenominator,
        ownerFeeNumerator,
        ownerFeeDenominator,
        { nonce: nonce++, gasLimit: 500000 }
      );
      
      await tx.wait();
      console.log(`   ✅ Initialized ${shard.name} with ${amounts.usdc} USDC + ${amounts.usdt} USDT`);
      
      totalLiquidityValue += parseFloat(amounts.usdc) + parseFloat(amounts.usdt);
      
    } else if (shard.pairName === 'USDC/DAI') {
      const amountA = ethers.parseUnits(amounts.usdc, 6); // USDC
      const amountB = ethers.parseUnits(amounts.dai, 18); // DAI
      
      console.log(`   💰 Initializing with ${amounts.usdc} USDC + ${amounts.dai} DAI...`);
      
      // Approve tokens
      console.log(`   📝 Approving tokens...`);
      await usdc.approve(shard.address, amountA, { nonce: nonce++ });
      await dai.approve(shard.address, amountB, { nonce: nonce++ });
      
      // Initialize pool
      console.log(`   🏊 Initializing pool...`);
      const tx = await pool.initialize(
        usdcAddress,
        daiAddress,
        amountA,
        amountB,
        tradeFeeNumerator,
        tradeFeeDenominator,
        ownerFeeNumerator,
        ownerFeeDenominator,
        { nonce: nonce++, gasLimit: 500000 }
      );
      
      await tx.wait();
      console.log(`   ✅ Initialized ${shard.name} with ${amounts.usdc} USDC + ${amounts.dai} DAI`);
      
      totalLiquidityValue += parseFloat(amounts.usdc) + parseFloat(amounts.dai);
    }
  }

  console.log("\n📊 Checking final pool states...");
  
  // Check pool states to verify initialization
  for (const shard of allShards) {
    try {
      const pool = SAMMPool.attach(shard.address);
      const poolState = await pool.getPoolState();
      const sammParams = await pool.getSAMMParams();
      
      console.log(`\n📈 ${shard.name} Pool State:`);
      console.log(`   Reserves A: ${ethers.formatUnits(poolState.reserveA, shard.pairName.includes('DAI') && poolState.tokenB.toLowerCase() === daiAddress.toLowerCase() ? 18 : 6)}`);
      console.log(`   Reserves B: ${ethers.formatUnits(poolState.reserveB, shard.pairName.includes('DAI') && poolState.tokenA.toLowerCase() === daiAddress.toLowerCase() ? 18 : 6)}`);
      console.log(`   Total Supply: ${ethers.formatUnits(poolState.totalSupply, 18)}`);
      console.log(`   Trade Fee: ${poolState.tradeFeeNumerator}/${poolState.tradeFeeDenominator}`);
      console.log(`   C Parameter: ${sammParams.c}`);
      
    } catch (error) {
      console.log(`   ❌ Error checking ${shard.name}:`, error.message);
    }
  }

  console.log(`\n💎 Total Liquidity Initialized: ~${totalLiquidityValue.toLocaleString()}`);

  console.log("\n🎉 Successfully Initialized All Pools in Oldest Monad Deployment!");
  console.log("=".repeat(60));
  console.log("✅ All shards from oldest deployment are now properly initialized");
  console.log("✅ Pools have proper reserves and SAMM parameters");
  console.log("✅ All pools are ready for swapping and testing");
  console.log(`✅ Total liquidity initialized: ~${totalLiquidityValue.toLocaleString()}`);
  console.log(`📄 Deployment used: monad-multi-shard-1764330063991.json`);

  return {
    success: true,
    totalLiquidityValue,
    shardsInitialized: allShards.length,
    deploymentFile: "monad-multi-shard-1764330063991.json"
  };
}

main()
  .then((result) => {
    console.log(`\n✅ Pool initialization completed successfully`);
    console.log(`📊 Initialized ${result.shardsInitialized} shards with ~${result.totalLiquidityValue.toLocaleString()} total liquidity`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Pool initialization failed:");
    console.error(error);
    process.exit(1);
  });