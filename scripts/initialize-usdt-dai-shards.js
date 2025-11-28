const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Initialize the 3 USDT/DAI shards via factory
 */
async function main() {
  console.log("🔧 Initializing USDT/DAI Shards via Factory");
  console.log("=".repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log(`Deployer: ${wallet.address}\n`);

  // The 3 shards that were created
  const usdtDaiShards = [
    "0x20c893A2706a71695894b15A4C385a3710C213eb",
    "0xe369Fe406ecB270b0F73C641260791C5A2edEB81",
    "0x4d3c19832713A7993d69870cB421586CBC36dceA"
  ];

  const factoryAddress = "0x70fe868ac814CC197631B60eEEaEaa1553418D03";
  const usdtAddress = "0x1888FF2446f2542cbb399eD179F4d6d966268C1F";
  const daiAddress = "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e";

  // Get contract instances
  const factory = await ethers.getContractAt("SAMMPoolFactory", factoryAddress, wallet);
  const usdt = await ethers.getContractAt("MockERC20", usdtAddress, wallet);
  const dai = await ethers.getContractAt("MockERC20", daiAddress, wallet);

  // Liquidity amounts for each shard
  const liquidityAmounts = [
    { usdt: "100", dai: "100" },
    { usdt: "500", dai: "500" },
    { usdt: "1000", dai: "1000" }
  ];

  for (let i = 0; i < usdtDaiShards.length; i++) {
    console.log(`\n🔧 Initializing shard ${i + 1}...`);
    console.log(`Address: ${usdtDaiShards[i]}`);
    
    const usdtAmount = ethers.parseUnits(liquidityAmounts[i].usdt, 6);
    const daiAmount = ethers.parseUnits(liquidityAmounts[i].dai, 18);
    
    console.log(`Amounts: ${liquidityAmounts[i].usdt} USDT + ${liquidityAmounts[i].dai} DAI`);
    
    // Approve tokens to factory (factory will transfer to shard)
    console.log("Approving USDT to factory...");
    const approveTx1 = await usdt.approve(factoryAddress, usdtAmount);
    await approveTx1.wait();
    console.log("✅ USDT approved");
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log("Approving DAI to factory...");
    const approveTx2 = await dai.approve(factoryAddress, daiAmount);
    await approveTx2.wait();
    console.log("✅ DAI approved");
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Initialize shard via factory
    console.log("Initializing shard via factory...");
    const initTx = await factory.initializeShard(
      usdtDaiShards[i],
      usdtAmount,
      daiAmount
    );
    const initReceipt = await initTx.wait();
    console.log(`✅ Shard initialized in block ${initReceipt.blockNumber}`);
    
    // Verify reserves
    const pool = await ethers.getContractAt("SAMMPool", usdtDaiShards[i], wallet);
    const reserves = await pool.getReserves();
    console.log(`Reserves: ${ethers.formatUnits(reserves[0], 6)} USDT, ${ethers.formatUnits(reserves[1], 18)} DAI`);
    
    if (i < 2) {
      console.log("Waiting 3 seconds before next shard...");
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Save deployment data
  const deploymentData = {
    network: "Monad Testnet",
    chainId: 10143,
    timestamp: new Date().toISOString(),
    deployer: wallet.address,
    feature: "USDT/DAI pools with 3 shards",
    contracts: {
      factory: factoryAddress,
      tokens: [
        {
          symbol: "USDT",
          address: usdtAddress
        },
        {
          symbol: "DAI",
          address: daiAddress
        }
      ],
      shards: [
        {
          name: "USDT/DAI-1",
          pairName: "USDT/DAI",
          address: usdtDaiShards[0],
          tokenA: usdtAddress,
          tokenB: daiAddress,
          liquidity: "100.0"
        },
        {
          name: "USDT/DAI-2",
          pairName: "USDT/DAI",
          address: usdtDaiShards[1],
          tokenA: usdtAddress,
          tokenB: daiAddress,
          liquidity: "500.0"
        },
        {
          name: "USDT/DAI-3",
          pairName: "USDT/DAI",
          address: usdtDaiShards[2],
          tokenA: usdtAddress,
          tokenB: daiAddress,
          liquidity: "1000.0"
        }
      ]
    },
    stats: {
      totalShards: 3,
      totalLiquidity: "1600.0"
    }
  };

  const deploymentPath = path.join(__dirname, "..", "deployment-data", `usdt-dai-pools-${Date.now()}.json`);
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));

  console.log("\n🎉 All Shards Initialized!");
  console.log(`📄 Deployment saved to: ${deploymentPath}`);
  console.log("\n📊 Summary:");
  usdtDaiShards.forEach((shard, i) => {
    console.log(`  ${i + 1}. ${shard} (${liquidityAmounts[i].usdt} USDT + ${liquidityAmounts[i].dai} DAI)`);
  });
}

main()
  .then(() => {
    console.log("\n✅ Script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:");
    console.error(error);
    process.exit(1);
  });
