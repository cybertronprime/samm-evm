/**
 * Deploy Token Faucet for Rise Testnet
 * 
 * Uses the latest production deployment tokens
 */

const { ethers } = require("hardhat");
const fs = require("fs");

// Latest production deployment data
const DEPLOYMENT_FILE = "deployment-data/production-risechain-1766847140276.json";

// Token amounts per faucet request
const FAUCET_AMOUNTS = {
  WBTC: 1,        // 1 BTC (~$100k)
  WETH: 10,       // 10 ETH (~$35k)
  USDC: 10000,    // 10,000 USDC
  USDT: 10000,    // 10,000 USDT
  DAI: 10000,     // 10,000 DAI
  LINK: 500,      // 500 LINK (~$7.5k)
  UNI: 1000,      // 1,000 UNI (~$8k)
  AAVE: 50        // 50 AAVE (~$9k)
};

async function main() {
  console.log("🚰 Deploying Token Faucet on Rise Testnet");
  console.log("=".repeat(60));
  
  // Load deployment data
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    console.error(`❌ Deployment file not found: ${DEPLOYMENT_FILE}`);
    process.exit(1);
  }
  
  const deploymentData = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const tokens = deploymentData.contracts.tokens;
  
  const [deployer] = await ethers.getSigners();
  console.log(`\n📋 Deployer: ${deployer.address}`);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH\n`);

  // Deploy Faucet
  console.log("📦 Deploying TokenFaucet...");
  const TokenFaucet = await ethers.getContractFactory("TokenFaucet");
  const faucet = await TokenFaucet.deploy({ gasLimit: 3000000 });
  await faucet.waitForDeployment();
  const faucetAddress = await faucet.getAddress();
  console.log(`   ✅ Faucet deployed: ${faucetAddress}`);

  // Set cooldown to 0 for testing (can request anytime)
  console.log("\n⏱️  Setting cooldown to 0 (no limit for testing)...");
  await faucet.setCooldownPeriod(0);
  console.log("   ✅ Cooldown set to 0");

  // Add tokens to faucet
  console.log("\n🪙 Adding tokens to faucet...");
  for (const [symbol, tokenData] of Object.entries(tokens)) {
    const amount = FAUCET_AMOUNTS[symbol] || 1000;
    try {
      await faucet.addToken(tokenData.address, symbol, amount, { gasLimit: 500000 });
      console.log(`   ✅ Added ${symbol}: ${amount} per request`);
    } catch (e) {
      console.log(`   ❌ Failed to add ${symbol}: ${e.message.slice(0, 50)}`);
    }
  }

  // Verify faucet setup
  console.log("\n🧪 Verifying faucet setup...");
  const tokenCount = await faucet.getTokenCount();
  console.log(`   Token count: ${tokenCount}`);
  
  const allTokens = await faucet.getAllTokens();
  console.log("   Registered tokens:");
  for (const token of allTokens) {
    console.log(`      - ${token.symbol}: ${token.amountPerRequest} per request (${token.decimals} decimals)`);
  }

  // Test faucet
  console.log("\n🧪 Testing faucet...");
  try {
    const canRequest = await faucet.canRequest(deployer.address);
    console.log(`   Can request: ${canRequest}`);
    
    if (canRequest) {
      console.log("   Requesting tokens...");
      const tx = await faucet.requestTokens({ gasLimit: 1000000 });
      await tx.wait();
      console.log("   ✅ Tokens received!");
      
      // Check balances
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      for (const [symbol, tokenData] of Object.entries(tokens)) {
        const token = MockERC20.attach(tokenData.address);
        const balance = await token.balanceOf(deployer.address);
        console.log(`      ${symbol}: ${ethers.formatUnits(balance, tokenData.decimals)}`);
      }
    }
  } catch (e) {
    console.log(`   ❌ Test failed: ${e.message.slice(0, 80)}`);
  }

  // Save faucet data
  const faucetData = {
    network: "Rise Testnet",
    chainId: 11155931,
    timestamp: new Date().toISOString(),
    faucet: faucetAddress,
    tokens: Object.entries(tokens).map(([symbol, data]) => ({
      symbol,
      address: data.address,
      decimals: data.decimals,
      amountPerRequest: FAUCET_AMOUNTS[symbol] || 1000
    })),
    productionDeployment: DEPLOYMENT_FILE,
    router: deploymentData.contracts.router,
    factory: deploymentData.contracts.factory
  };
  
  const filename = `deployment-data/faucet-risechain-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(faucetData, null, 2));

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 FAUCET DEPLOYMENT SUMMARY");
  console.log("=".repeat(60));
  console.log(`\n   🚰 Faucet Address: ${faucetAddress}`);
  console.log(`   🔗 Network: Rise Testnet (Chain ID: 11155931)`);
  console.log(`\n   📝 How to use:`);
  console.log(`      1. Call requestTokens() to get all tokens`);
  console.log(`      2. Or call requestTokensFor(address) to send to any address`);
  console.log(`\n   🪙 Tokens available per request:`);
  for (const [symbol, amount] of Object.entries(FAUCET_AMOUNTS)) {
    console.log(`      - ${symbol}: ${amount}`);
  }
  console.log(`\n   💾 Data saved to: ${filename}`);
  console.log("\n   🎉 Faucet ready to use!");
  
  return faucetAddress;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
