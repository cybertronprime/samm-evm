/**
 * deploy-arc-nanopayments.js
 * Deploys NanopaymentArbitrageur and SAMM core contracts on Arc testnet.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-arc-nanopayments.js --network arc
 *
 * Env vars:
 *   PRIVATE_KEY     — Deployer key
 *   ARC_RPC_URL     — Arc testnet RPC (default: https://testnet-rpc.arc.network)
 *   USDC_ADDRESS    — USDC token address on Arc (if pre-deployed)
 *   EURC_ADDRESS    — EURC token address on Arc (if pre-deployed)
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const GAS_LIMIT = 8_000_000;
const CONFIRMATIONS = 1;

// SAMM parameters from research paper
const SAMM_PARAMS = {
  beta1: -1050000n,
  rmin: 1000n,
  rmax: 12000n,
  c: 10400n,
};

const FEE_PARAMS = {
  tradeFeeNumerator: 25n,
  tradeFeeDenominator: 10000n,
  ownerFeeNumerator: 5n,
  ownerFeeDenominator: 10000n,
};

// Liquidity for demo pools (USDC has 6 decimals)
const USDC_LIQUIDITY = 100_000n * 10n ** 6n; // 100,000 USDC
const EURC_LIQUIDITY = 100_000n * 10n ** 6n; // 100,000 EURC
const SHARD_COUNT = 4;

async function main() {
  console.log("🚀 Deploying Arc Nanopayments Integration");
  console.log("=".repeat(60));

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log(`📋 Deployer : ${deployer.address}`);
  console.log(`🌐 Network  : Chain ID ${network.chainId}`);

  const deployment = {
    network: "Arc Testnet",
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {},
    pools: [],
  };

  // ---- Deploy SAMM Core ----
  console.log("\n1️⃣  Deploying SAMMPoolFactory…");
  const FactoryContract = await ethers.getContractFactory("SAMMPoolFactory");
  const factory = await FactoryContract.deploy({ gasLimit: GAS_LIMIT });
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log(`✅ SAMMPoolFactory: ${factoryAddr}`);
  deployment.contracts.SAMMPoolFactory = { address: factoryAddr };

  console.log("\n2️⃣  Deploying CrossPoolRouter…");
  const RouterContract = await ethers.getContractFactory("CrossPoolRouter");
  const router = await RouterContract.deploy(factoryAddr, { gasLimit: GAS_LIMIT });
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log(`✅ CrossPoolRouter: ${routerAddr}`);
  deployment.contracts.CrossPoolRouter = { address: routerAddr };

  // ---- Deploy or use existing USDC/EURC ----
  let usdcAddr = process.env.USDC_ADDRESS;
  let eurcAddr = process.env.EURC_ADDRESS;

  if (!usdcAddr) {
    console.log("\n3️⃣  Deploying mock USDC (6 decimals)…");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6, { gasLimit: GAS_LIMIT });
    await usdc.waitForDeployment();
    usdcAddr = await usdc.getAddress();
    console.log(`✅ USDC: ${usdcAddr}`);

    await usdc.mint(deployer.address, USDC_LIQUIDITY * BigInt(SHARD_COUNT * 2));
    deployment.contracts.USDC = { address: usdcAddr, mock: true };
  }

  if (!eurcAddr) {
    console.log("   Deploying mock EURC (6 decimals)…");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const eurc = await MockERC20.deploy("Euro Coin", "EURC", 6, { gasLimit: GAS_LIMIT });
    await eurc.waitForDeployment();
    eurcAddr = await eurc.getAddress();
    console.log(`✅ EURC: ${eurcAddr}`);

    await eurc.mint(deployer.address, EURC_LIQUIDITY * BigInt(SHARD_COUNT * 2));
    deployment.contracts.EURC = { address: eurcAddr, mock: true };
  }

  const usdc = await ethers.getContractAt("MockERC20", usdcAddr);
  const eurc = await ethers.getContractAt("MockERC20", eurcAddr);

  // ---- Create USDC/EURC shards ----
  console.log(`\n4️⃣  Creating ${SHARD_COUNT} USDC/EURC shards…`);
  for (let i = 0; i < SHARD_COUNT; i++) {
    const tx = await factory.createShard(usdcAddr, eurcAddr, SAMM_PARAMS, FEE_PARAMS, {
      gasLimit: GAS_LIMIT,
    });
    const receipt = await tx.wait(1);
    const shardCreatedEvent = receipt.logs
      .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
      .find((e) => e?.name === "ShardCreated");
    const shardAddr = shardCreatedEvent?.args?.shard;

    if (shardAddr) {
      // Initialize with liquidity
      await usdc.approve(await factory.getAddress(), USDC_LIQUIDITY);
      await eurc.approve(await factory.getAddress(), EURC_LIQUIDITY);
      await factory.initializeShard(shardAddr, USDC_LIQUIDITY, EURC_LIQUIDITY, {
        gasLimit: GAS_LIMIT,
      });
      console.log(`   ✅ Shard ${i + 1}: ${shardAddr}`);
      deployment.pools.push({ shard: shardAddr, tokenA: usdcAddr, tokenB: eurcAddr, index: i });
    }
  }

  // ---- Deploy NanopaymentArbitrageur ----
  console.log("\n5️⃣  Deploying NanopaymentArbitrageur…");
  const ArbitrageurFactory = await ethers.getContractFactory("NanopaymentArbitrageur");
  const arbitrageur = await ArbitrageurFactory.deploy({ gasLimit: GAS_LIMIT });
  await arbitrageur.waitForDeployment();
  const arbitrageurAddr = await arbitrageur.getAddress();
  console.log(`✅ NanopaymentArbitrageur: ${arbitrageurAddr}`);

  // Register deployer as agent
  await arbitrageur.registerAgent(deployer.address, { gasLimit: 200_000 });
  console.log(`   ✅ Registered ${deployer.address} as agent`);
  deployment.contracts.NanopaymentArbitrageur = { address: arbitrageurAddr };

  const outputDir = path.join(__dirname, "..", "deployment-data");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "arc-nanopayments.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2));
  console.log(`\n💾 Deployment data saved to: ${outputPath}`);

  console.log("\n🎉 Arc nanopayments deployment complete!");
  console.log(`   SAMMPoolFactory          : ${factoryAddr}`);
  console.log(`   CrossPoolRouter           : ${routerAddr}`);
  console.log(`   NanopaymentArbitrageur   : ${arbitrageurAddr}`);
  console.log(`   USDC                      : ${usdcAddr}`);
  console.log(`   EURC                      : ${eurcAddr}`);
  console.log(`   USDC/EURC Shards          : ${SHARD_COUNT}`);
  console.log("\n📝 Set these in your .env:");
  console.log(`   NANOPAYMENT_ARBITRAGEUR_ADDRESS=${arbitrageurAddr}`);
  console.log(`   SAMM_FACTORY_ADDRESS=${factoryAddr}`);
  console.log(`   SAMM_ROUTER_ADDRESS=${routerAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
