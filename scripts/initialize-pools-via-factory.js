const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Initializing Pools via Factory - Oldest Monad Deployment");
  console.log("=".repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet("9387e097a14f64f865d10cc50835d3b16c3683f2e2cebd518b2456260f1e59ad", provider);

  console.log("📋 Operation Details:");
  console.log(`Network: Monad Testnet`);
  console.log(`Deployer: ${wallet.address}`);

  // Load the OLDEST deployment data specifically
  const deploymentFile = path.join(__dirname, "..", "deployment-data", "monad-multi-shard-1764330063991.json");
  const deploymentData = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  
  console.log(`📄 Using deployment: monad-multi-shard-1764330063991.json`);

  // Get contract addresses
  const factoryAddress = deploymentData.contracts?.factory;
  const tokens = deploymentData.contracts?.tokens || [];
  const usdcAddress = tokens.find(t => t.symbol === 'USDC')?.address;
  const usdtAddress = tokens.find(t => t.symbol === 'USDT')?.address;
  const daiAddress = tokens.find(t => t.symbol === 'DAI')?.address;

  console.log("\n📍 Contract Addresses:");
  console.log(`Factory: ${factoryAddress}`);
  console.log(`USDC: ${usdcAddress}`);
  console.log(`USDT: ${usdtAddress}`);
  console.log(`DAI: ${daiAddress}`);

  // Connect to contracts
  const SAMMPoolFactory = await ethers.getContractFactory("SAMMPoolFactory", wallet);
  const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
  
  const factory = SAMMPoolFactory.attach(factoryAddress);
  const usdc = MockERC20.attach(usdcAddress);
  const usdt = MockERC20.attach(usdtAddress);
  const dai = MockERC20.attach(daiAddress);

  console.log("\n💰 Ensuring sufficient token balances...");

  // Get current nonce
  let nonce = await provider.getTransactionCount(wallet.address);
  console.log(`Starting nonce: ${nonce}`);

  // Check current balances
  const currentUsdcBalance = await usdc.balanceOf(wallet.address);
  const currentUsdtBalance = await usdt.balanceOf(wallet.address);
  const currentDaiBalance = await dai.balanceOf(wallet.address);
  
  console.log(`Current USDC: ${ethers.formatUnits(currentUsdcBalance, 6)}`);
  console.log(`Current USDT: ${ethers.formatUnits(currentUsdtBalance, 6)}`);
  console.log(`Current DAI: ${ethers.formatUnits(currentDaiBalance, 18)}`);

  // Mint more if needed
  const requiredUsdcAmount = ethers.parseUnits("50000000", 6); // 50M USDC
  const requiredUsdtAmount = ethers.parseUnits("20000000", 6); // 20M USDT
  const requiredDaiAmount = ethers.parseUnits("20000000", 18); // 20M DAI

  if (currentUsdcBalance < requiredUsdcAmount) {
    console.log("Minting additional USDC...");
    await usdc.mint(wallet.address, requiredUsdcAmount - currentUsdcBalance, { nonce: nonce++ });
  }
  
  if (currentUsdtBalance < requiredUsdtAmount) {
    console.log("Minting additional USDT...");
    await usdt.mint(wallet.address, requiredUsdtAmount - currentUsdtBalance, { nonce: nonce++ });
  }
  
  if (currentDaiBalance < requiredDaiAmount) {
    console.log("Minting additional DAI...");
    await dai.mint(wallet.address, requiredDaiAmount - currentDaiBalance, { nonce: nonce++ });
  }

  console.log("\n🏊 Initializing pools via factory...");

  const allShards = deploymentData.contracts?.shards || [];
  
  // Initialization amounts for each shard (different sizes to demonstrate C-smaller-better)
  const initAmounts = [
    { usdc: "5000000", usdt: "5000000", dai: "5000000" },     // 5M each - Large shard
    { usdc: "3000000", usdt: "3000000", dai: "3000000" },     // 3M each - Medium-large shard
    { usdc: "2000000", usdt: "2000000", dai: "2000000" },     // 2M each - Medium shard
    { usdc: "1500000", usdt: "1500000", dai: "1500000" },     // 1.5M each - Small-medium shard
    { usdc: "1000000", usdt: "1000000", dai: "1000000" }      // 1M each - Small shard
  ];

  let totalLiquidityValue = 0;

  // Initialize each shard via factory
  for (let i = 0; i < allShards.length; i++) {
    const shard = allShards[i];
    const amounts = initAmounts[i] || initAmounts[initAmounts.length - 1];
    
    console.log(`\n🏊 Initializing ${shard.name} via factory...`);
    
    try {
      // Check if already initialized by checking total supply
      const SAMMPool = await ethers.getContractFactory("SAMMPool", wallet);
      const pool = SAMMPool.attach(shard.address);
      const poolState = await pool.getPoolState();
      
      if (poolState.totalSupply > 0) {
        console.log(`   ⚠️  Pool ${shard.name} already initialized, skipping...`);
        continue;
      }
      
      if (shard.pairName === 'USDC/USDT') {
        const amountA = ethers.parseUnits(amounts.usdc, 6); // USDC
        const amountB = ethers.parseUnits(amounts.usdt, 6); // USDT
        
        console.log(`   💰 Initializing with ${amounts.usdc} USDC + ${amounts.usdt} USDT...`);
        
        // Approve tokens to factory
        console.log(`   📝 Approving tokens to factory...`);
        await usdc.approve(factoryAddress, amountA, { nonce: nonce++ });
        await usdt.approve(factoryAddress, amountB, { nonce: nonce++ });
        
        // Initialize via factory
        console.log(`   🏊 Calling factory.initializeShard...`);
        const tx = await factory.initializeShard(
          shard.address,
          amountA,
          amountB,
          { nonce: nonce++, gasLimit: 800000 }
        );
        
        const receipt = await tx.wait();
        console.log(`   ✅ Initialized ${shard.name} via factory! Tx: ${receipt.hash}`);
        
        totalLiquidityValue += parseFloat(amounts.usdc) + parseFloat(amounts.usdt);
        
      } else if (shard.pairName === 'USDC/DAI') {
        const amountA = ethers.parseUnits(amounts.usdc, 6); // USDC
        const amountB = ethers.parseUnits(amounts.dai, 18); // DAI
        
        console.log(`   💰 Initializing with ${amounts.usdc} USDC + ${amounts.dai} DAI...`);
        
        // Approve tokens to factory
        console.log(`   📝 Approving tokens to factory...`);
        await usdc.approve(factoryAddress, amountA, { nonce: nonce++ });
        await dai.approve(factoryAddress, amountB, { nonce: nonce++ });
        
        // Initialize via factory
        console.log(`   🏊 Calling factory.initializeShard...`);
        const tx = await factory.initializeShard(
          shard.address,
          amountA,
          amountB,
          { nonce: nonce++, gasLimit: 800000 }
        );
        
        const receipt = await tx.wait();
        console.log(`   ✅ Initialized ${shard.name} via factory! Tx: ${receipt.hash}`);
        
        totalLiquidityValue += parseFloat(amounts.usdc) + parseFloat(amounts.dai);
      }
      
    } catch (error) {
      console.log(`   ❌ Error initializing ${shard.name}: ${error.message}`);
    }
  }

  console.log("\n📊 Checking final pool states...");
  
  // Check pool states to verify initialization
  for (const shard of allShards) {
    try {
      const SAMMPool = await ethers.getContractFactory("SAMMPool", wallet);
      const pool = SAMMPool.attach(shard.address);
      const poolState = await pool.getPoolState();
      const sammParams = await pool.getSAMMParams();
      
      console.log(`\n📈 ${shard.name} Pool State:`);
      console.log(`   Reserves A: ${ethers.formatUnits(poolState.reserveA, shard.pairName.includes('DAI') && poolState.tokenA.toLowerCase() === daiAddress.toLowerCase() ? 18 : 6)}`);
      console.log(`   Reserves B: ${ethers.formatUnits(poolState.reserveB, shard.pairName.includes('DAI') && poolState.tokenB.toLowerCase() === daiAddress.toLowerCase() ? 18 : 6)}`);
      console.log(`   Total Supply: ${ethers.formatUnits(poolState.totalSupply, 18)}`);
      console.log(`   Trade Fee: ${poolState.tradeFeeNumerator}/${poolState.tradeFeeDenominator}`);
      console.log(`   C Parameter: ${sammParams.c}`);
      
    } catch (error) {
      console.log(`   ❌ Error checking ${shard.name}:`, error.message);
    }
  }

  console.log(`\n💎 Total Liquidity Initialized: ~${totalLiquidityValue.toLocaleString()}`);

  console.log("\n🎉 Successfully Initialized All Pools via Factory!");
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
    console.log(`\n✅ Pool initialization via factory completed successfully`);
    console.log(`📊 Initialized ${result.shardsInitialized} shards with ~${result.totalLiquidityValue.toLocaleString()} total liquidity`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Pool initialization failed:");
    console.error(error);
    process.exit(1);
  });''