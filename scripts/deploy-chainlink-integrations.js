/**
 * deploy-chainlink-integrations.js
 * Deploys ChainlinkPriceValidator and VRFFairSequencer on Sepolia.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-chainlink-integrations.js --network sepolia
 *
 * Env vars:
 *   PRIVATE_KEY                      — Deployer key
 *   SEPOLIA_RPC_URL                  — Sepolia RPC
 *   CHAINLINK_VRF_SUBSCRIPTION_ID    — Funded VRF v2.5 subscription ID
 *   ETHERSCAN_API_KEY                — Optional verification
 */

const { ethers, run } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Sepolia VRF v2.5
const VRF_COORDINATOR_SEPOLIA = "0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B";

// Sepolia feed addresses (ETH, BTC, LINK, USDC)
const WETH_SEPOLIA  = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const WBTC_SEPOLIA  = "0x29f2D40B0605204364af54EC677bD022dA425d03";
const LINK_SEPOLIA  = "0x779877A7B0D9E8603169DdbD7836e478b4624789";
const USDC_SEPOLIA  = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

const ETH_USD_FEED  = "0x694AA1769357215DE4FAC081bf1f309aDC325306";
const BTC_USD_FEED  = "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43";
const LINK_USD_FEED = "0xc59E3633BAAC79493d908e63626716e204A45EdF";
const USDC_USD_FEED = "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E";

const GAS_LIMIT = 5_000_000;
const CONFIRMATIONS = 2;
const MAX_DEVIATION_BPS = 500;  // 5%
const STALENESS_THRESHOLD = 3600; // 1 hour

async function main() {
  console.log("🚀 Deploying Chainlink Integrations to Sepolia");
  console.log("=".repeat(60));

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log(`📋 Deployer : ${deployer.address}`);
  console.log(`💰 Balance  : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log(`🌐 Network  : Chain ID ${network.chainId}`);

  const subscriptionId = process.env.CHAINLINK_VRF_SUBSCRIPTION_ID;
  if (!subscriptionId) {
    console.log("⚠️  CHAINLINK_VRF_SUBSCRIPTION_ID not set — using placeholder 1");
  }
  const subId = subscriptionId ? BigInt(subscriptionId) : 1n;

  const deployment = {
    network: "Sepolia",
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {},
  };

  // ---- Deploy ChainlinkPriceValidator ----
  console.log("\n1️⃣  Deploying ChainlinkPriceValidator…");
  const ValidatorFactory = await ethers.getContractFactory("ChainlinkPriceValidator");
  const validator = await ValidatorFactory.deploy(MAX_DEVIATION_BPS, STALENESS_THRESHOLD, {
    gasLimit: GAS_LIMIT,
  });
  await validator.waitForDeployment();
  const validatorAddr = await validator.getAddress();
  console.log(`✅ ChainlinkPriceValidator: ${validatorAddr}`);

  // Add Sepolia price feeds
  console.log("   Adding Sepolia price feeds…");
  const tokens = [WETH_SEPOLIA, WBTC_SEPOLIA, LINK_SEPOLIA, USDC_SEPOLIA];
  const feeds  = [ETH_USD_FEED, BTC_USD_FEED, LINK_USD_FEED, USDC_USD_FEED];
  const tx = await validator.addFeeds(tokens, feeds, { gasLimit: 500_000 });
  await tx.wait(1);
  console.log("   ✅ Feeds registered");

  deployment.contracts.ChainlinkPriceValidator = {
    address: validatorAddr,
    args: [MAX_DEVIATION_BPS, STALENESS_THRESHOLD],
    feeds: { WETH: ETH_USD_FEED, WBTC: BTC_USD_FEED, LINK: LINK_USD_FEED, USDC: USDC_USD_FEED },
  };

  // ---- Deploy VRFFairSequencer ----
  console.log("\n2️⃣  Deploying VRFFairSequencer…");
  const SequencerFactory = await ethers.getContractFactory("VRFFairSequencer");
  const sequencer = await SequencerFactory.deploy(VRF_COORDINATOR_SEPOLIA, subId, {
    gasLimit: GAS_LIMIT,
  });
  await sequencer.waitForDeployment();
  const sequencerAddr = await sequencer.getAddress();
  console.log(`✅ VRFFairSequencer: ${sequencerAddr}`);

  deployment.contracts.VRFFairSequencer = {
    address: sequencerAddr,
    args: [VRF_COORDINATOR_SEPOLIA, subId.toString()],
    vrfConfig: {
      coordinator: VRF_COORDINATOR_SEPOLIA,
      subscriptionId: subId.toString(),
    },
  };

  console.log(`\n⏳ Waiting for ${CONFIRMATIONS} confirmations on both contracts…`);
  await validator.deploymentTransaction().wait(CONFIRMATIONS);
  await sequencer.deploymentTransaction().wait(CONFIRMATIONS);

  const outputDir = path.join(__dirname, "..", "deployment-data");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "sepolia-chainlink.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2));
  console.log(`\n💾 Deployment data saved to: ${outputPath}`);

  if (process.env.ETHERSCAN_API_KEY) {
    console.log("\n🔍 Verifying contracts on Etherscan…");
    for (const [name, info] of Object.entries(deployment.contracts)) {
      try {
        await run("verify:verify", { address: info.address, constructorArguments: info.args });
        console.log(`✅ ${name} verified`);
      } catch (err) {
        console.log(`⚠️  ${name} verification failed: ${err.message}`);
      }
    }
  }

  console.log("\n🎉 Chainlink integrations deployed!");
  console.log(`   ChainlinkPriceValidator : ${validatorAddr}`);
  console.log(`   VRFFairSequencer        : ${sequencerAddr}`);
  console.log("\n📝 Next steps:");
  console.log("   1. Add VRFFairSequencer as consumer to your VRF subscription");
  console.log("   2. Fund subscription with LINK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
