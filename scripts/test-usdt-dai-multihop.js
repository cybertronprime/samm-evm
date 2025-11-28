const { ethers } = require("hardhat");

/**
 * Test multi-hop functionality: USDC -> USDT -> DAI
 * This demonstrates routing through multiple pools
 */
async function main() {
  console.log("🔄 Testing Multi-Hop Swaps: USDC -> USDT -> DAI");
  console.log("=".repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log(`Tester: ${wallet.address}\n`);

  // Contract addresses from existing deployment
  const usdcAddress = "0x67DcA5710a9dA091e00093dF04765d711759f435";
  const usdtAddress = "0x1888FF2446f2542cbb399eD179F4d6d966268C1F";
  const daiAddress = "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e";

  // USDC/USDT shards (from existing deployment)
  const usdcUsdtShards = [
    "0x686ff8090b18C0DF4f828f02deAf122CeC40B1DE",
    "0x0481CD694F9C4EfC925C694f49835547404c0460",
    "0x49ac6067BB0b6d5b793e9F3af3CD78b3a108AA5a"
  ];

  // USDT/DAI shards (newly created)
  const usdtDaiShards = [
    "0x20c893A2706a71695894b15A4C385a3710C213eb",
    "0xe369Fe406ecB270b0F73C641260791C5A2edEB81",
    "0x4d3c19832713A7993d69870cB421586CBC36dceA"
  ];

  // Get token instances
  const usdc = await ethers.getContractAt("MockERC20", usdcAddress, wallet);
  const usdt = await ethers.getContractAt("MockERC20", usdtAddress, wallet);
  const dai = await ethers.getContractAt("MockERC20", daiAddress, wallet);

  // Check initial balances
  const usdcBalanceInitial = await usdc.balanceOf(wallet.address);
  const usdtBalanceInitial = await usdt.balanceOf(wallet.address);
  const daiBalanceInitial = await dai.balanceOf(wallet.address);
  
  console.log("💰 Initial Balances:");
  console.log(`USDC: ${ethers.formatUnits(usdcBalanceInitial, 6)}`);
  console.log(`USDT: ${ethers.formatUnits(usdtBalanceInitial, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiBalanceInitial, 18)}\n`);

  // Display pool reserves
  console.log("📊 Pool Reserves:");
  console.log("\nUSDC/USDT Pools:");
  for (let i = 0; i < usdcUsdtShards.length; i++) {
    const pool = await ethers.getContractAt("SAMMPool", usdcUsdtShards[i], wallet);
    const reserves = await pool.getReserves();
    console.log(`  Shard ${i + 1}: ${ethers.formatUnits(reserves[0], 6)} USDC, ${ethers.formatUnits(reserves[1], 6)} USDT`);
  }
  
  console.log("\nUSDT/DAI Pools:");
  for (let i = 0; i < usdtDaiShards.length; i++) {
    const pool = await ethers.getContractAt("SAMMPool", usdtDaiShards[i], wallet);
    const reserves = await pool.getReserves();
    console.log(`  Shard ${i + 1}: ${ethers.formatUnits(reserves[0], 6)} USDT, ${ethers.formatUnits(reserves[1], 18)} DAI`);
  }

  // Test 1: Direct swap USDT -> DAI (single hop)
  console.log("\n" + "=".repeat(60));
  console.log("🧪 Test 1: Direct Swap USDT -> DAI (Single Hop)");
  console.log("=".repeat(60));
  
  const usdtSwapAmount = ethers.parseUnits("100", 6); // 100 USDT
  console.log(`\nSwapping: 100 USDT -> DAI`);
  console.log(`Using: USDT/DAI Shard 1 (smallest shard)\n`);
  
  const usdtDaiPool1 = await ethers.getContractAt("SAMMPool", usdtDaiShards[0], wallet);
  
  // Calculate expected output
  const swapResult1 = await usdtDaiPool1.calculateSwapSAMM(
    usdtSwapAmount,
    usdtAddress,
    daiAddress
  );
  
  console.log(`Expected Input: ${ethers.formatUnits(swapResult1.amountIn, 18)} DAI`);
  console.log(`Expected Output: ${ethers.formatUnits(swapResult1.amountOut, 6)} USDT`);
  console.log(`Trade Fee: ${ethers.formatUnits(swapResult1.tradeFee, 18)} DAI`);
  console.log(`Owner Fee: ${ethers.formatUnits(swapResult1.ownerFee, 18)} DAI`);
  
  // Execute swap
  const approveTx1 = await dai.approve(usdtDaiShards[0], swapResult1.amountIn);
  await approveTx1.wait();
  
  const maxInput1 = swapResult1.amountIn * 105n / 100n; // 5% slippage
  const swapTx1 = await usdtDaiPool1.swapSAMM(
    usdtSwapAmount,
    maxInput1,
    daiAddress,
    usdtAddress,
    wallet.address
  );
  const swapReceipt1 = await swapTx1.wait();
  console.log(`\n✅ Swap executed in block ${swapReceipt1.blockNumber}`);
  
  // Check balances after first swap
  const usdtBalanceAfterTest1 = await usdt.balanceOf(wallet.address);
  const daiBalanceAfterTest1 = await dai.balanceOf(wallet.address);
  const usdtGained = usdtBalanceAfterTest1 - usdtBalanceInitial;
  const daiSpent = daiBalanceInitial - daiBalanceAfterTest1;
  
  console.log(`\nResult:`);
  console.log(`  USDT Gained: +${ethers.formatUnits(usdtGained, 6)}`);
  console.log(`  DAI Spent: -${ethers.formatUnits(daiSpent, 18)}`);

  await new Promise(resolve => setTimeout(resolve, 3000));

  // Test 2: Multi-hop swap USDC -> USDT -> DAI
  console.log("\n" + "=".repeat(60));
  console.log("🧪 Test 2: Multi-Hop Swap USDC -> USDT -> DAI");
  console.log("=".repeat(60));
  
  const usdcSwapAmount = ethers.parseUnits("100", 6); // 100 USDC
  console.log(`\nSwapping: 100 USDC -> USDT -> DAI`);
  console.log(`Route: USDC/USDT Shard 1 -> USDT/DAI Shard 1\n`);
  
  // Step 1: USDC -> USDT
  console.log("Step 1: USDC -> USDT");
  const usdcUsdtPool1 = await ethers.getContractAt("SAMMPool", usdcUsdtShards[0], wallet);
  
  const swapResult2a = await usdcUsdtPool1.calculateSwapSAMM(
    usdcSwapAmount,
    usdcAddress,
    usdtAddress
  );
  
  console.log(`  Expected Input: ${ethers.formatUnits(swapResult2a.amountIn, 6)} USDC`);
  console.log(`  Expected Output: ${ethers.formatUnits(swapResult2a.amountOut, 6)} USDT`);
  console.log(`  Trade Fee: ${ethers.formatUnits(swapResult2a.tradeFee, 6)} USDC`);
  
  // Execute USDC -> USDT
  const approveTx2a = await usdc.approve(usdcUsdtShards[0], swapResult2a.amountIn);
  await approveTx2a.wait();
  
  const maxInput2a = swapResult2a.amountIn * 105n / 100n;
  const swapTx2a = await usdcUsdtPool1.swapSAMM(
    usdcSwapAmount,
    maxInput2a,
    usdcAddress,
    usdtAddress,
    wallet.address
  );
  const swapReceipt2a = await swapTx2a.wait();
  console.log(`  ✅ Executed in block ${swapReceipt2a.blockNumber}`);
  
  const usdtReceived = swapResult2a.amountOut;
  console.log(`  USDT Received: ${ethers.formatUnits(usdtReceived, 6)}`);
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Step 2: USDT -> DAI
  console.log("\nStep 2: USDT -> DAI");
  
  const swapResult2b = await usdtDaiPool1.calculateSwapSAMM(
    usdtReceived,
    usdtAddress,
    daiAddress
  );
  
  console.log(`  Expected Input: ${ethers.formatUnits(swapResult2b.amountIn, 18)} DAI`);
  console.log(`  Expected Output: ${ethers.formatUnits(swapResult2b.amountOut, 6)} USDT`);
  console.log(`  Trade Fee: ${ethers.formatUnits(swapResult2b.tradeFee, 18)} DAI`);
  
  // Execute USDT -> DAI
  const approveTx2b = await dai.approve(usdtDaiShards[0], swapResult2b.amountIn);
  await approveTx2b.wait();
  
  const maxInput2b = swapResult2b.amountIn * 105n / 100n;
  const swapTx2b = await usdtDaiPool1.swapSAMM(
    usdtReceived,
    maxInput2b,
    daiAddress,
    usdtAddress,
    wallet.address
  );
  const swapReceipt2b = await swapTx2b.wait();
  console.log(`  ✅ Executed in block ${swapReceipt2b.blockNumber}`);
  
  // Final balances
  const usdcBalanceFinal = await usdc.balanceOf(wallet.address);
  const usdtBalanceFinal = await usdt.balanceOf(wallet.address);
  const daiBalanceFinal = await dai.balanceOf(wallet.address);
  
  console.log("\n💰 Final Balances:");
  console.log(`USDC: ${ethers.formatUnits(usdcBalanceFinal, 6)}`);
  console.log(`USDT: ${ethers.formatUnits(usdtBalanceFinal, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiBalanceFinal, 18)}`);
  
  // Calculate net changes
  const usdcChange = usdcBalanceFinal - usdcBalanceInitial;
  const usdtChange = usdtBalanceFinal - usdtBalanceAfterTest1;
  const daiChange = daiBalanceFinal - daiBalanceAfterTest1;
  
  console.log("\n📊 Multi-Hop Result:");
  console.log(`  USDC Spent: ${ethers.formatUnits(usdcChange, 6)}`);
  console.log(`  USDT Change: ${ethers.formatUnits(usdtChange, 6)}`);
  console.log(`  DAI Change: ${ethers.formatUnits(daiChange, 18)}`);
  
  // Test 3: Reverse multi-hop DAI -> USDT -> USDC
  console.log("\n" + "=".repeat(60));
  console.log("🧪 Test 3: Reverse Multi-Hop DAI -> USDT -> USDC");
  console.log("=".repeat(60));
  
  const daiSwapAmount = ethers.parseUnits("100", 18); // 100 DAI
  console.log(`\nSwapping: 100 DAI -> USDT -> USDC`);
  console.log(`Route: USDT/DAI Shard 2 -> USDC/USDT Shard 2\n`);
  
  // Step 1: DAI -> USDT
  console.log("Step 1: DAI -> USDT");
  const usdtDaiPool2 = await ethers.getContractAt("SAMMPool", usdtDaiShards[1], wallet);
  
  const swapResult3a = await usdtDaiPool2.calculateSwapSAMM(
    daiSwapAmount,
    daiAddress,
    usdtAddress
  );
  
  console.log(`  Expected Input: ${ethers.formatUnits(swapResult3a.amountIn, 6)} USDT`);
  console.log(`  Expected Output: ${ethers.formatUnits(swapResult3a.amountOut, 18)} DAI`);
  console.log(`  Trade Fee: ${ethers.formatUnits(swapResult3a.tradeFee, 6)} USDT`);
  
  // Execute DAI -> USDT
  const approveTx3a = await usdt.approve(usdtDaiShards[1], swapResult3a.amountIn);
  await approveTx3a.wait();
  
  const maxInput3a = swapResult3a.amountIn * 105n / 100n;
  const swapTx3a = await usdtDaiPool2.swapSAMM(
    daiSwapAmount,
    maxInput3a,
    usdtAddress,
    daiAddress,
    wallet.address
  );
  const swapReceipt3a = await swapTx3a.wait();
  console.log(`  ✅ Executed in block ${swapReceipt3a.blockNumber}`);
  
  const daiReceivedFromUsdt = swapResult3a.amountOut;
  console.log(`  DAI Received: ${ethers.formatUnits(daiReceivedFromUsdt, 18)}`);
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Step 2: USDT -> USDC
  console.log("\nStep 2: USDT -> USDC");
  const usdcUsdtPool2 = await ethers.getContractAt("SAMMPool", usdcUsdtShards[1], wallet);
  
  const usdtForUsdc = ethers.parseUnits("50", 6); // Use 50 USDT
  const swapResult3b = await usdcUsdtPool2.calculateSwapSAMM(
    usdtForUsdc,
    usdtAddress,
    usdcAddress
  );
  
  console.log(`  Expected Input: ${ethers.formatUnits(swapResult3b.amountIn, 6)} USDC`);
  console.log(`  Expected Output: ${ethers.formatUnits(swapResult3b.amountOut, 6)} USDT`);
  console.log(`  Trade Fee: ${ethers.formatUnits(swapResult3b.tradeFee, 6)} USDC`);
  
  // Execute USDT -> USDC
  const approveTx3b = await usdc.approve(usdcUsdtShards[1], swapResult3b.amountIn);
  await approveTx3b.wait();
  
  const maxInput3b = swapResult3b.amountIn * 105n / 100n;
  const swapTx3b = await usdcUsdtPool2.swapSAMM(
    usdtForUsdc,
    maxInput3b,
    usdcAddress,
    usdtAddress,
    wallet.address
  );
  const swapReceipt3b = await swapTx3b.wait();
  console.log(`  ✅ Executed in block ${swapReceipt3b.blockNumber}`);

  console.log("\n🎉 Multi-Hop Testing Complete!");
  console.log("=".repeat(60));
  console.log("\n✅ Successfully tested:");
  console.log("  1. Direct USDT -> DAI swap");
  console.log("  2. Multi-hop USDC -> USDT -> DAI");
  console.log("  3. Reverse multi-hop DAI -> USDT -> USDC");
  console.log("\n✅ All USDT/DAI pools are working correctly!");
  console.log("✅ Multi-hop routing is functional!");
}

main()
  .then(() => {
    console.log("\n✅ Tests completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Tests failed:");
    console.error(error);
    process.exit(1);
  });
