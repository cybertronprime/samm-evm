const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

/**
 * Deploy TokenFaucet for RiseChain Testnet
 * Uses existing MockERC20 tokens - faucet will mint tokens directly
 */

const GAS_LIMIT = 12000000;

// Auto-find the latest production deployment file
function findLatestDeployment() {
  const deployDir = path.join(__dirname, "..", "deployment-data");
  const files = fs.readdirSync(deployDir)
    .filter(f => f.startsWith("production-risechain-") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) throw new Error("No production deployment files found in deployment-data/");
  console.log(`   Found ${files.length} deployment files, using latest: ${files[0]}`);
  return files[0];
}

const DEPLOYMENT_FILE = process.env.DEPLOYMENT_FILE || findLatestDeployment();

// Faucet configuration
// Note: TokenFaucet multiplies these by 10^decimals, so use base amounts
const COOLDOWN_PERIOD = 24 * 60 * 60; // 24 hours
const FAUCET_AMOUNTS = {
  WBTC: 0,      // Skip WBTC for now (needs fractional amount)
  WETH: 3,        // 3 WETH
  USDC: 10000,    // 10,000 USDC
  USDT: 10000,    // 10,000 USDT
  DAI: 10000,     // 10,000 DAI
  LINK: 500,      // 500 LINK
  UNI: 1000,      // 1,000 UNI
  AAVE: 50        // 50 AAVE
};

async function main() {
  console.log("\n🚰 Deploying TokenFaucet for RiseChain Testnet\n");
  
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  
  // Load deployment
  const deploymentPath = path.join(__dirname, "..", "deployment-data", DEPLOYMENT_FILE);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  
  // Deploy faucet
  const TokenFaucet = await ethers.getContractFactory("TokenFaucet");
  const faucet = await TokenFaucet.deploy({ gasLimit: GAS_LIMIT });
  await faucet.waitForDeployment();
  const faucetAddress = await faucet.getAddress();
  
  console.log(`\n✅ Faucet deployed: ${faucetAddress}`);
  
  // Set cooldown
  await faucet.setCooldownPeriod(COOLDOWN_PERIOD, { gasLimit: GAS_LIMIT });
  console.log(`✅ Cooldown set: ${COOLDOWN_PERIOD / 3600} hours`);
  
  // Add tokens
  console.log(`\n🪙 Adding tokens...`);
  for (const [symbol, tokenData] of Object.entries(deployment.contracts.tokens)) {
    const amount = FAUCET_AMOUNTS[symbol];
    if (!amount) continue;
    
    await faucet.addToken(tokenData.address, symbol, amount, { gasLimit: GAS_LIMIT });
    console.log(`   ✅ ${symbol}: ${amount} per request`);
  }
  
  // Save to deployment file
  deployment.contracts.faucet = faucetAddress;
  deployment.faucetConfig = {
    cooldownPeriod: COOLDOWN_PERIOD,
    cooldownHours: 24,
    amounts: FAUCET_AMOUNTS
  };
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  
  // Test
  console.log(`\n🧪 Testing faucet...`);
  await faucet.requestTokens({ gasLimit: GAS_LIMIT });
  console.log(`✅ Test successful!`);
  
  console.log(`\n📝 Faucet Address: ${faucetAddress}`);
  console.log(`💡 Users call: faucet.requestTokens()`);
}

main().then(() => process.exit(0)).catch(console.error);
