/**
 * deploy-uniswap-aggregator.js
 * Deploys UniswapSAMMAggregator on Sepolia for the Uniswap Foundation prize track.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-uniswap-aggregator.js --network sepolia
 *
 * Env vars required:
 *   PRIVATE_KEY           — Deployer private key
 *   SEPOLIA_RPC_URL       — Sepolia JSON-RPC URL
 *   SAMM_ROUTER_ADDRESS   — Deployed CrossPoolRouter address
 *   UNISWAP_ROUTER_ADDRESS — Uniswap V3 SwapRouter (default: Sepolia)
 *   UNISWAP_QUOTER_ADDRESS — Uniswap V3 QuoterV2 (default: Sepolia)
 *   ETHERSCAN_API_KEY     — Optional, enables Etherscan verification
 */

const { ethers, run } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Sepolia Uniswap V3 addresses
const DEFAULT_UNISWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const DEFAULT_UNISWAP_QUOTER = "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3";

const GAS_LIMIT = 5_000_000;
const CONFIRMATIONS = 2;
const INITIAL_SLIPPAGE_BPS = 50; // 0.5%

async function main() {
  console.log("🚀 Deploying UniswapSAMMAggregator to Sepolia");
  console.log("=".repeat(60));

  const [deployer] = await ethers.getSigners();
  console.log(`\n📋 Deployer : ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance  : ${ethers.formatEther(balance)} ETH`);

  const network = await ethers.provider.getNetwork();
  console.log(`🌐 Network  : Chain ID ${network.chainId}`);

  const sammRouter = process.env.SAMM_ROUTER_ADDRESS;
  const uniswapRouter = process.env.UNISWAP_ROUTER_ADDRESS || DEFAULT_UNISWAP_ROUTER;
  const uniswapQuoter = process.env.UNISWAP_QUOTER_ADDRESS || DEFAULT_UNISWAP_QUOTER;

  if (!sammRouter) {
    throw new Error("SAMM_ROUTER_ADDRESS env var is required");
  }

  console.log(`\n📦 Constructor args:`);
  console.log(`   SAMM Router    : ${sammRouter}`);
  console.log(`   Uniswap Router : ${uniswapRouter}`);
  console.log(`   Uniswap Quoter : ${uniswapQuoter}`);
  console.log(`   Slippage BPS   : ${INITIAL_SLIPPAGE_BPS} (${INITIAL_SLIPPAGE_BPS / 100}%)`);

  console.log("\n1️⃣  Deploying UniswapSAMMAggregator…");
  const AggregatorFactory = await ethers.getContractFactory("UniswapSAMMAggregator");
  const aggregator = await AggregatorFactory.deploy(
    sammRouter,
    uniswapRouter,
    uniswapQuoter,
    INITIAL_SLIPPAGE_BPS,
    { gasLimit: GAS_LIMIT }
  );
  await aggregator.waitForDeployment();
  console.log(`✅ Deployed at: ${await aggregator.getAddress()}`);

  console.log(`\n⏳ Waiting for ${CONFIRMATIONS} confirmations…`);
  await aggregator.deploymentTransaction().wait(CONFIRMATIONS);

  const deploymentData = {
    network: "Sepolia",
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      UniswapSAMMAggregator: {
        address: await aggregator.getAddress(),
        args: [sammRouter, uniswapRouter, uniswapQuoter, INITIAL_SLIPPAGE_BPS],
      },
    },
    config: {
      sammRouter,
      uniswapRouter,
      uniswapQuoter,
      slippageBps: INITIAL_SLIPPAGE_BPS,
    },
  };

  const outputDir = path.join(__dirname, "..", "deployment-data");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "sepolia-uniswap-aggregator.json");
  fs.writeFileSync(outputPath, JSON.stringify(deploymentData, null, 2));
  console.log(`\n💾 Deployment data saved to: ${outputPath}`);

  if (process.env.ETHERSCAN_API_KEY) {
    console.log("\n🔍 Verifying on Etherscan…");
    try {
      await run("verify:verify", {
        address: await aggregator.getAddress(),
        constructorArguments: [sammRouter, uniswapRouter, uniswapQuoter, INITIAL_SLIPPAGE_BPS],
      });
      console.log("✅ Verified on Etherscan");
    } catch (err) {
      console.log(`⚠️  Etherscan verification failed: ${err.message}`);
    }
  }

  console.log("\n🎉 UniswapSAMMAggregator deployment complete!");
  console.log(`   Address: ${await aggregator.getAddress()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
