const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🔍 Debugging Pool States - Oldest Monad Deployment");
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
  const tokens = deploymentData.contracts?.tokens || [];
  const usdcAddress = tokens.find(t => t.symbol === 'USDC')?.address;
  const usdtAddress = tokens.find(t => t.symbol === 'USDT')?.address;
  const daiAddress = tokens.find(t => t.symbol === 'DAI')?.address;

  console.log("\n📍 Token Addresses:");
  console.log(`USDC: ${usdcAddress}`);
  console.log(`USDT: ${usdtAddress}`);
  console.log(`DAI: ${daiAddress}`);

  // Connect to contracts
  const SAMMPool = await ethers.getContractFactory("SAMMPool", wallet);
  const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
  
  const usdc = MockERC20.attach(usdcAddress);
  const usdt = MockERC20.attach(usdtAddress);
  const dai = MockERC20.attach(daiAddress);

  console.log("\n🔍 Checking Pool States...");

  const allShards = deploymentData.contracts?.shards || [];
  
  for (const shard of allShards) {
    console.log(`\n📊 ${shard.name} (${shard.address}):`);
    
    try {
      const pool = SAMMPool.attach(shard.address);
      
      // Check if contract exists
      const code = await provider.getCode(shard.address);
      if (code === '0x') {
        console.log(`   ❌ No contract deployed at this address`);
        continue;
      }
      
      // Check owner
      try {
        const owner = await pool.owner();
        console.log(`   👤 Owner: ${owner}`);
      } catch (error) {
        console.log(`   ❌ Error getting owner: ${error.message}`);
      }
      
      // Check if initialized
      try {
        const initialized = await pool.initialized();
        console.log(`   🏊 Initialized: ${initialized}`);
      } catch (error) {
        console.log(`   ❌ Error checking initialized: ${error.message}`);
      }
      
      // Try to get pool state
      try {
        const poolState = await pool.getPoolState();
        console.log(`   📈 Pool State:`);
        console.log(`      Token A: ${poolState.tokenA}`);
        console.log(`      Token B: ${poolState.tokenB}`);
        console.log(`      Reserve A: ${poolState.reserveA.toString()}`);
        console.log(`      Reserve B: ${poolState.reserveB.toString()}`);
        console.log(`      Total Supply: ${poolState.totalSupply.toString()}`);
        console.log(`      Trade Fee: ${poolState.tradeFeeNumerator}/${poolState.tradeFeeDenominator}`);
      } catch (error) {
        console.log(`   ❌ Error getting pool state: ${error.message}`);
      }
      
      // Check token balances in the pool
      if (shard.pairName === 'USDC/USDT') {
        const usdcBalance = await usdc.balanceOf(shard.address);
        const usdtBalance = await usdt.balanceOf(shard.address);
        console.log(`   💰 Token Balances:`);
        console.log(`      USDC: ${ethers.formatUnits(usdcBalance, 6)}`);
        console.log(`      USDT: ${ethers.formatUnits(usdtBalance, 6)}`);
      } else if (shard.pairName === 'USDC/DAI') {
        const usdcBalance = await usdc.balanceOf(shard.address);
        const daiBalance = await dai.balanceOf(shard.address);
        console.log(`   💰 Token Balances:`);
        console.log(`      USDC: ${ethers.formatUnits(usdcBalance, 6)}`);
        console.log(`      DAI: ${ethers.formatUnits(daiBalance, 18)}`);
      }
      
    } catch (error) {
      console.log(`   ❌ Error checking pool: ${error.message}`);
    }
  }

  // Check deployer token balances
  console.log("\n💰 Deployer Token Balances:");
  try {
    const usdcBalance = await usdc.balanceOf(wallet.address);
    const usdtBalance = await usdt.balanceOf(wallet.address);
    const daiBalance = await dai.balanceOf(wallet.address);
    
    console.log(`USDC: ${ethers.formatUnits(usdcBalance, 6)}`);
    console.log(`USDT: ${ethers.formatUnits(usdtBalance, 6)}`);
    console.log(`DAI: ${ethers.formatUnits(daiBalance, 18)}`);
  } catch (error) {
    console.log(`❌ Error checking deployer balances: ${error.message}`);
  }

  console.log("\n✅ Pool state debugging complete!");
}

main()
  .then(() => {
    console.log("Debug completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Debug failed:", error);
    process.exit(1);
  });