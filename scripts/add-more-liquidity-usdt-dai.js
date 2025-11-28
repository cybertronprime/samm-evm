const { ethers } = require("hardhat");

/**
 * Add more liquidity to all 3 USDT/DAI shards
 * This adds substantial liquidity to make the pools ready for multi-hop testing
 */
async function main() {
  console.log("💧 Adding More Liquidity to USDT/DAI Shards");
  console.log("=".repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log(`Deployer: ${wallet.address}\n`);

  // The 3 USDT/DAI shards
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

  // Check current balances
  const usdtBalance = await usdt.balanceOf(wallet.address);
  const daiBalance = await dai.balanceOf(wallet.address);
  console.log("💰 Current Token Balances:");
  console.log(`USDT: ${ethers.formatUnits(usdtBalance, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiBalance, 18)}\n`);

  // Additional liquidity amounts for each shard
  // Adding significant amounts to make pools robust for multi-hop
  const additionalLiquidity = [
    { usdt: "10000", dai: "10000" },   // Shard 1: Add 10k each (total: 10.1k)
    { usdt: "20000", dai: "20000" },   // Shard 2: Add 20k each (total: 20.5k)
    { usdt: "30000", dai: "30000" }    // Shard 3: Add 30k each (total: 31k)
  ];

  console.log("📊 Liquidity Addition Plan:");
  console.log("Shard 1: +10,000 USDT + 10,000 DAI");
  console.log("Shard 2: +20,000 USDT + 20,000 DAI");
  console.log("Shard 3: +30,000 USDT + 30,000 DAI");
  console.log("Total: +60,000 USDT + 60,000 DAI\n");

  for (let i = 0; i < usdtDaiShards.length; i++) {
    console.log(`\n💧 Adding liquidity to Shard ${i + 1}...`);
    console.log(`Address: ${usdtDaiShards[i]}`);
    
    const pool = await ethers.getContractAt("SAMMPool", usdtDaiShards[i], wallet);
    
    // Get current reserves
    const reservesBefore = await pool.getReserves();
    console.log(`Current Reserves: ${ethers.formatUnits(reservesBefore[0], 6)} USDT, ${ethers.formatUnits(reservesBefore[1], 18)} DAI`);
    
    const usdtAmount = ethers.parseUnits(additionalLiquidity[i].usdt, 6);
    const daiAmount = ethers.parseUnits(additionalLiquidity[i].dai, 18);
    
    console.log(`Adding: ${additionalLiquidity[i].usdt} USDT + ${additionalLiquidity[i].dai} DAI`);
    
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
    
    // Get new reserves
    const reservesAfter = await pool.getReserves();
    console.log(`New Reserves: ${ethers.formatUnits(reservesAfter[0], 6)} USDT, ${ethers.formatUnits(reservesAfter[1], 18)} DAI`);
    
    // Calculate increase
    const usdtIncrease = reservesAfter[0] - reservesBefore[0];
    const daiIncrease = reservesAfter[1] - reservesBefore[1];
    console.log(`Increase: +${ethers.formatUnits(usdtIncrease, 6)} USDT, +${ethers.formatUnits(daiIncrease, 18)} DAI`);
    
    // Get LP token balance
    const lpBalance = await pool.balanceOf(wallet.address);
    console.log(`LP Tokens: ${ethers.formatEther(lpBalance)}`);
    
    if (i < 2) {
      console.log("\nWaiting 3 seconds before next shard...");
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Final token balances
  const usdtBalanceFinal = await usdt.balanceOf(wallet.address);
  const daiBalanceFinal = await dai.balanceOf(wallet.address);
  console.log("\n💰 Final Token Balances:");
  console.log(`USDT: ${ethers.formatUnits(usdtBalanceFinal, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiBalanceFinal, 18)}`);

  // Summary
  console.log("\n📊 Liquidity Addition Summary:");
  console.log("=".repeat(60));
  
  for (let i = 0; i < usdtDaiShards.length; i++) {
    const pool = await ethers.getContractAt("SAMMPool", usdtDaiShards[i], wallet);
    const reserves = await pool.getReserves();
    const totalSupply = await pool.totalSupply();
    
    console.log(`\nShard ${i + 1}: ${usdtDaiShards[i]}`);
    console.log(`  Reserves: ${ethers.formatUnits(reserves[0], 6)} USDT, ${ethers.formatUnits(reserves[1], 18)} DAI`);
    console.log(`  LP Supply: ${ethers.formatEther(totalSupply)}`);
  }

  console.log("\n🎉 Liquidity Addition Complete!");
  console.log("✅ All shards now have substantial liquidity for multi-hop testing");
}

main()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:");
    console.error(error);
    process.exit(1);
  });
