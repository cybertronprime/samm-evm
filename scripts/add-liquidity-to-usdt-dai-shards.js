const { ethers } = require("hardhat");

/**
 * Add liquidity to the 3 USDT/DAI shards that were just created
 */
async function main() {
  console.log("💧 Adding Liquidity to USDT/DAI Shards");
  console.log("=".repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log(`Deployer: ${wallet.address}\n`);

  // The 3 shards that were just created
  const usdtDaiShards = [
    "0x20c893A2706a71695894b15A4C385a3710C213eb",
    "0xe369Fe406ecB270b0F73C641260791C5A2edEB81",
    "0x4d3c19832713A7993d69870cB421586CBC36dceA"
  ];

  const usdtAddress = "0x1888FF2446f2542cbb399eD179F4d6d966268C1F";
  const daiAddress = "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e";

  // Get token instances
  const usdt = await ethers.getContractAt("MockERC20", usdtAddress, wallet);
  const dai = await ethers.getContractAt("MockERC20", daiAddress, wallet);

  // Liquidity amounts for each shard
  const liquidityAmounts = [
    { usdt: "100", dai: "100" },
    { usdt: "500", dai: "500" },
    { usdt: "1000", dai: "1000" }
  ];

  for (let i = 0; i < usdtDaiShards.length; i++) {
    console.log(`\n💧 Adding liquidity to shard ${i + 1}...`);
    console.log(`Address: ${usdtDaiShards[i]}`);
    
    const pool = await ethers.getContractAt("SAMMPool", usdtDaiShards[i], wallet);
    const usdtAmount = ethers.parseUnits(liquidityAmounts[i].usdt, 6);
    const daiAmount = ethers.parseUnits(liquidityAmounts[i].dai, 18);
    
    console.log(`Amounts: ${liquidityAmounts[i].usdt} USDT + ${liquidityAmounts[i].dai} DAI`);
    
    // Approve USDT
    console.log("Approving USDT...");
    const approveTx1 = await usdt.approve(usdtDaiShards[i], usdtAmount);
    await approveTx1.wait();
    console.log("✅ USDT approved");
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Approve DAI
    console.log("Approving DAI...");
    const approveTx2 = await dai.approve(usdtDaiShards[i], daiAmount);
    await approveTx2.wait();
    console.log("✅ DAI approved");
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Add liquidity
    console.log("Adding liquidity...");
    const addLiqTx = await pool.addLiquidity(
      usdtAmount,
      daiAmount,
      0, // amountAMin
      0, // amountBMin
      wallet.address
    );
    const addLiqReceipt = await addLiqTx.wait();
    console.log(`✅ Liquidity added in block ${addLiqReceipt.blockNumber}`);
    
    // Verify reserves
    const reserves = await pool.getReserves();
    console.log(`Reserves: ${ethers.formatUnits(reserves[0], 6)} USDT, ${ethers.formatUnits(reserves[1], 18)} DAI`);
    
    if (i < 2) {
      console.log("Waiting 3 seconds before next shard...");
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  console.log("\n🎉 Liquidity Added to All Shards!");
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
