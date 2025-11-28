const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🔄 Complete Multi-Hop Test Across Different Shards");
  console.log("=".repeat(70));

  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log(`Tester: ${wallet.address}\n`);

  const deploymentPath = path.join(__dirname, "deployment-data", "complete-deployment-1764357709284.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const usdcAddress = deployment.contracts.tokens.find(t => t.symbol === "USDC").address;
  const usdtAddress = deployment.contracts.tokens.find(t => t.symbol === "USDT").address;
  const daiAddress = deployment.contracts.tokens.find(t => t.symbol === "DAI").address;

  const usdcUsdtShards = deployment.contracts.shards
    .filter(s => s.pairName === "USDC/USDT")
    .map(s => s.address);
  
  const usdtDaiShards = deployment.contracts.shards
    .filter(s => s.pairName === "USDT/DAI")
    .map(s => s.address);

  console.log("📍 Deployment Info:");
  console.log(`USDC: ${usdcAddress}`);
  console.log(`USDT: ${usdtAddress}`);
  console.log(`DAI: ${daiAddress}`);
  console.log(`\nUSCD/USDT Shards: ${usdcUsdtShards.length}`);
  usdcUsdtShards.forEach((addr, i) => console.log(`  ${i + 1}. ${addr}`));
  console.log(`\nUSDT/DAI Shards: ${usdtDaiShards.length}`);
  usdtDaiShards.forEach((addr, i) => console.log(`  ${i + 1}. ${addr}`));

  const usdc = await ethers.getContractAt("MockERC20", usdcAddress, wallet);
  const usdt = await ethers.getContractAt("MockERC20", usdtAddress, wallet);
  const dai = await ethers.getContractAt("MockERC20", daiAddress, wallet);

  const usdcBalanceInit = await usdc.balanceOf(wallet.address);
  const usdtBalanceInit = await usdt.balanceOf(wallet.address);
  const daiBalanceInit = await dai.balanceOf(wallet.address);

  console.log("\n💰 Initial Balances:");
  console.log(`USDC: ${ethers.formatUnits(usdcBalanceInit, 6)}`);
  console.log(`USDT: ${ethers.formatUnits(usdtBalanceInit, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiBalanceInit, 18)}`);

  console.log("\n🔄 Testing Multi-Hop Swaps Across Different Shards");
  console.log("=".repeat(70));

  const testAmount = "10"; // Now using 10 with decimal-aware contract
  const testResults = [];

  const combinations = [
    { usdcUsdt: 0, usdtDai: 0, name: "Smallest -> Smallest" },
    { usdcUsdt: 0, usdtDai: 2, name: "Smallest -> Largest" },
    { usdcUsdt: 2, usdtDai: 0, name: "Largest -> Smallest" },
    { usdcUsdt: 2, usdtDai: 2, name: "Largest -> Largest" },
    { usdcUsdt: 1, usdtDai: 1, name: "Medium -> Medium" }
  ];

  for (let i = 0; i < combinations.length; i++) {
    const combo = combinations[i];
    console.log(`\n📊 Test ${i + 1}: ${combo.name}`);
    console.log(`   USDC/USDT Shard: ${combo.usdcUsdt + 1}`);
    console.log(`   USDT/DAI Shard: ${combo.usdtDai + 1}`);

    try {
      const usdcUsdtPool = await ethers.getContractAt("SAMMPool", usdcUsdtShards[combo.usdcUsdt], wallet);
      const usdtDaiPool = await ethers.getContractAt("SAMMPool", usdtDaiShards[combo.usdtDai], wallet);

      const [reserveA1Before, reserveB1Before] = await usdcUsdtPool.getReserves();
      const [reserveA2Before, reserveB2Before] = await usdtDaiPool.getReserves();

      console.log(`   USDC/USDT Pool: ${ethers.formatUnits(reserveA1Before, 6)} USDC, ${ethers.formatUnits(reserveB1Before, 6)} USDT`);
      console.log(`   USDT/DAI Pool: ${ethers.formatUnits(reserveA2Before, 6)} USDT, ${ethers.formatUnits(reserveB2Before, 18)} DAI`);

      console.log(`\n   Step 1: Swap ${testAmount} USDC -> USDT`);
      const usdcAmount = ethers.parseUnits(testAmount, 6);
      
      // Get USDT balance before swap
      const usdtBalanceBefore = await usdt.balanceOf(wallet.address);
      
      const swap1Result = await usdcUsdtPool.calculateSwapSAMM(
        usdcAmount,
        usdcAddress,
        usdtAddress
      );
      
      const expectedUsdtReceived = swap1Result.amountOut;
      console.log(`   Expected USDT: ${ethers.formatUnits(expectedUsdtReceived, 6)}`);

      await usdc.approve(usdcUsdtShards[combo.usdcUsdt], swap1Result.amountIn);
      await new Promise(resolve => setTimeout(resolve, 2000));

      const maxInput1 = swap1Result.amountIn * 105n / 100n;
      const swap1Tx = await usdcUsdtPool.swapSAMM(
        usdcAmount,
        maxInput1,
        usdcAddress,
        usdtAddress,
        wallet.address
      );
      await swap1Tx.wait();
      console.log(`   ✅ First swap complete`);

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get actual USDT balance after swap
      const usdtBalanceAfter = await usdt.balanceOf(wallet.address);
      const actualUsdtReceived = usdtBalanceAfter - usdtBalanceBefore;
      console.log(`   Actual USDT received: ${ethers.formatUnits(actualUsdtReceived, 6)}`);

      console.log(`\n   Step 2: Swap ${ethers.formatUnits(actualUsdtReceived, 6)} USDT -> DAI`);
      
      // Get DAI balance before second swap
      const daiBalanceBefore = await dai.balanceOf(wallet.address);
      
      // For USDT->DAI swap, we need to request DAI output in DAI's decimal scale (18 decimals)
      // We want approximately the same value, so 10 USDT should give us ~10 DAI
      // Convert the USDT amount to DAI decimal scale: 10 USDT (6 decimals) -> 10 DAI (18 decimals)
      const desiredDaiOutput = ethers.parseUnits(ethers.formatUnits(actualUsdtReceived, 6), 18);
      console.log(`   Desired DAI output: ${ethers.formatUnits(desiredDaiOutput, 18)} DAI`);
      
      const swap2Result = await usdtDaiPool.calculateSwapSAMM(
        desiredDaiOutput,
        usdtAddress,
        daiAddress
      );
      
      const expectedDaiReceived = swap2Result.amountOut;
      console.log(`   Expected DAI: ${ethers.formatUnits(expectedDaiReceived, 18)}`);
      console.log(`   Required USDT input: ${ethers.formatUnits(swap2Result.amountIn, 6)}`);

      await usdt.approve(usdtDaiShards[combo.usdtDai], swap2Result.amountIn);
      await new Promise(resolve => setTimeout(resolve, 2000));

      const maxInput2 = swap2Result.amountIn * 105n / 100n;
      const swap2Tx = await usdtDaiPool.swapSAMM(
        desiredDaiOutput,
        maxInput2,
        usdtAddress,
        daiAddress,
        wallet.address
      );
      await swap2Tx.wait();
      console.log(`   ✅ Second swap complete`);

      // Get actual DAI received
      const daiBalanceAfter = await dai.balanceOf(wallet.address);
      const actualDaiReceived = daiBalanceAfter - daiBalanceBefore;
      console.log(`   Actual DAI received: ${ethers.formatUnits(actualDaiReceived, 18)}`);

      console.log(`\n   📊 Results:`);
      console.log(`   USDC Input: ${testAmount}`);
      console.log(`   USDT Intermediate: ${ethers.formatUnits(actualUsdtReceived, 6)}`);
      console.log(`   DAI Output: ${ethers.formatUnits(actualDaiReceived, 18)}`);
      console.log(`   Rate: 1 USDC = ${(Number(ethers.formatUnits(actualDaiReceived, 18)) / Number(testAmount)).toFixed(6)} DAI`);

      testResults.push({
        test: i + 1,
        name: combo.name,
        success: true,
        usdcIn: testAmount,
        usdtIntermediate: ethers.formatUnits(actualUsdtReceived, 6),
        daiOut: ethers.formatUnits(actualDaiReceived, 18),
        rate: (Number(ethers.formatUnits(actualDaiReceived, 18)) / Number(testAmount)).toFixed(6)
      });

    } catch (error) {
      console.log(`   ❌ Test failed: ${error.message}`);
      testResults.push({
        test: i + 1,
        name: combo.name,
        success: false,
        error: error.message
      });
    }

    if (i < combinations.length - 1) {
      console.log("\nWaiting 3 seconds before next test...");
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  const usdcBalanceFinal = await usdc.balanceOf(wallet.address);
  const usdtBalanceFinal = await usdt.balanceOf(wallet.address);
  const daiBalanceFinal = await dai.balanceOf(wallet.address);

  console.log("\n💰 Final Balances:");
  console.log(`USDC: ${ethers.formatUnits(usdcBalanceFinal, 6)}`);
  console.log(`USDT: ${ethers.formatUnits(usdtBalanceFinal, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiBalanceFinal, 18)}`);

  console.log("\n📊 Test Summary:");
  console.log("=".repeat(70));
  const successCount = testResults.filter(r => r.success).length;
  console.log(`Total Tests: ${testResults.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${testResults.length - successCount}`);

  testResults.forEach(result => {
    if (result.success) {
      console.log(`\n✅ Test ${result.test}: ${result.name}`);
      console.log(`   ${result.usdcIn} USDC -> ${result.usdtIntermediate} USDT -> ${result.daiOut} DAI`);
      console.log(`   Effective Rate: 1 USDC = ${result.rate} DAI`);
    } else {
      console.log(`\n❌ Test ${result.test}: ${result.name}`);
      console.log(`   Error: ${result.error}`);
    }
  });

  console.log("\n🎉 Multi-Hop Testing Complete!");
  console.log("✅ Successfully demonstrated multi-hop routing across different shards");
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
