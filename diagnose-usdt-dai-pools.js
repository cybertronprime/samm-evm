const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🔍 Diagnosing USDT/DAI Pool Issues");
  console.log("=".repeat(70));

  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const deploymentPath = path.join(__dirname, "deployment-data", "monad-complete-deployment.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const usdtAddress = deployment.contracts.tokens.find(t => t.symbol === "USDT").address;
  const daiAddress = deployment.contracts.tokens.find(t => t.symbol === "DAI").address;

  const usdtDaiShards = deployment.contracts.shards
    .filter(s => s.pairName === "USDT/DAI");

  console.log(`USDT: ${usdtAddress} (6 decimals)`);
  console.log(`DAI: ${daiAddress} (18 decimals)\n`);

  const usdt = await ethers.getContractAt("MockERC20", usdtAddress, wallet);
  const dai = await ethers.getContractAt("MockERC20", daiAddress, wallet);

  for (let i = 0; i < usdtDaiShards.length; i++) {
    const shard = usdtDaiShards[i];
    console.log(`\n📊 ${shard.name} (${shard.address})`);
    console.log("=".repeat(70));

    const pool = await ethers.getContractAt("SAMMPool", shard.address, wallet);

    try {
      // Get pool info
      const tokenA = await pool.tokenA();
      const tokenB = await pool.tokenB();
      const [reserveA, reserveB] = await pool.getReserves();

      console.log(`Token A: ${tokenA}`);
      console.log(`Token B: ${tokenB}`);
      console.log(`Reserve A (raw): ${reserveA.toString()}`);
      console.log(`Reserve B (raw): ${reserveB.toString()}`);

      // Determine which is USDT and which is DAI
      const isUsdtTokenA = tokenA.toLowerCase() === usdtAddress.toLowerCase();
      const usdtReserve = isUsdtTokenA ? reserveA : reserveB;
      const daiReserve = isUsdtTokenA ? reserveB : reserveA;

      console.log(`\nUSDT Reserve: ${ethers.formatUnits(usdtReserve, 6)} USDT`);
      console.log(`DAI Reserve: ${ethers.formatUnits(daiReserve, 18)} DAI`);

      // Test a small swap calculation
      const testAmount = ethers.parseUnits("10", 6); // 10 USDT
      console.log(`\n🧪 Testing swap of 10 USDT -> DAI`);
      console.log(`Test amount (raw): ${testAmount.toString()}`);

      try {
        const swapResult = await pool.calculateSwapSAMM(
          testAmount,
          usdtAddress,
          daiAddress
        );

        console.log(`\nSwap Calculation Result:`);
        console.log(`  Amount In (raw): ${swapResult.amountIn.toString()}`);
        console.log(`  Amount Out (raw): ${swapResult.amountOut.toString()}`);
        console.log(`  Amount In: ${ethers.formatUnits(swapResult.amountIn, 6)} USDT`);
        console.log(`  Amount Out: ${ethers.formatUnits(swapResult.amountOut, 18)} DAI`);
        console.log(`  Fee: ${ethers.formatUnits(swapResult.fee, 6)}`);

        if (swapResult.amountOut === 0n) {
          console.log(`\n⚠️  WARNING: Output amount is ZERO!`);
          console.log(`This indicates a problem with the pool configuration or calculation.`);
        }

      } catch (error) {
        console.log(`\n❌ Swap calculation failed: ${error.message}`);
      }

      // Check wallet balances
      const walletUsdt = await usdt.balanceOf(wallet.address);
      const walletDai = await dai.balanceOf(wallet.address);
      console.log(`\n💰 Wallet Balances:`);
      console.log(`  USDT: ${ethers.formatUnits(walletUsdt, 6)}`);
      console.log(`  DAI: ${ethers.formatUnits(walletDai, 18)}`);

    } catch (error) {
      console.log(`❌ Error checking pool: ${error.message}`);
    }
  }
}

main()
  .then(() => {
    console.log("\n✅ Diagnosis complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Diagnosis failed:");
    console.error(error);
    process.exit(1);
  });
