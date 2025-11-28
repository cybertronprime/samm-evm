const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Test USDT/DAI swaps across all shards
 */
async function main() {
  console.log("🧪 Testing USDT/DAI Swaps");
  console.log("=".repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log(`Tester: ${wallet.address}\n`);

  // Find the latest USDT/DAI deployment
  const deploymentDir = path.join(__dirname, "..", "deployment-data");
  const files = fs.readdirSync(deploymentDir);
  const usdtDaiFiles = files.filter(f => f.startsWith("usdt-dai-pools-"));
  
  if (usdtDaiFiles.length === 0) {
    console.log("❌ No USDT/DAI deployment found");
    return;
  }

  const latestFile = usdtDaiFiles.sort().reverse()[0];
  const deploymentPath = path.join(deploymentDir, latestFile);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  console.log(`📄 Using deployment: ${latestFile}\n`);

  // Get contract instances
  const usdt = await ethers.getContractAt("MockERC20", deployment.contracts.tokens[0].address, wallet);
  const dai = await ethers.getContractAt("MockERC20", deployment.contracts.tokens[1].address, wallet);

  // Check balances
  const usdtBalance = await usdt.balanceOf(wallet.address);
  const daiBalance = await dai.balanceOf(wallet.address);
  console.log("💰 Initial Balances:");
  console.log(`USDT: ${ethers.formatUnits(usdtBalance, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiBalance, 18)}\n`);

  // Test swaps on each shard
  const testResults = [];

  for (let i = 0; i < deployment.contracts.shards.length; i++) {
    const shardData = deployment.contracts.shards[i];
    console.log(`\n🔄 Testing Shard ${i + 1}: ${shardData.name}`);
    console.log(`Address: ${shardData.address}`);
    
    try {
      const pool = await ethers.getContractAt("SAMMPool", shardData.address, wallet);
      
      // Get reserves before
      const reservesBefore = await pool.getReserves();
      console.log(`Reserves Before: ${ethers.formatUnits(reservesBefore[0], 6)} USDT, ${ethers.formatUnits(reservesBefore[1], 18)} DAI`);
      
      // Test 1: USDT -> DAI (small amount)
      console.log("\n📊 Test 1: Swap 1 USDT -> DAI");
      const usdtIn = ethers.parseUnits("1", 6);
      
      // Calculate expected output
      const swapResult1 = await pool.calculateSwapSAMM(
        usdtIn,
        deployment.contracts.tokens[0].address,
        deployment.contracts.tokens[1].address
      );
      
      console.log(`Expected Input: ${ethers.formatUnits(swapResult1.amountIn, 18)} DAI`);
      console.log(`Expected Output: ${ethers.formatUnits(swapResult1.amountOut, 6)} USDT`);
      console.log(`Trade Fee: ${ethers.formatUnits(swapResult1.tradeFee, 18)} DAI`);
      
      // Approve and execute swap
      const approveTx = await dai.approve(shardData.address, swapResult1.amountIn);
      await approveTx.wait();
      
      const maxInput = swapResult1.amountIn * 105n / 100n; // 5% slippage
      const swapTx = await pool.swapSAMM(
        usdtIn,
        maxInput,
        deployment.contracts.tokens[1].address, // DAI in
        deployment.contracts.tokens[0].address, // USDT out
        wallet.address
      );
      const swapReceipt = await swapTx.wait();
      console.log(`✅ Swap executed in block ${swapReceipt.blockNumber}`);
      
      // Get reserves after
      const reservesAfter = await pool.getReserves();
      console.log(`Reserves After: ${ethers.formatUnits(reservesAfter[0], 6)} USDT, ${ethers.formatUnits(reservesAfter[1], 18)} DAI`);
      
      testResults.push({
        shard: i + 1,
        name: shardData.name,
        success: true,
        reservesBefore: {
          usdt: ethers.formatUnits(reservesBefore[0], 6),
          dai: ethers.formatUnits(reservesBefore[1], 18)
        },
        reservesAfter: {
          usdt: ethers.formatUnits(reservesAfter[0], 6),
          dai: ethers.formatUnits(reservesAfter[1], 18)
        }
      });
      
    } catch (error) {
      console.log(`❌ Test failed: ${error.message}`);
      testResults.push({
        shard: i + 1,
        name: shardData.name,
        success: false,
        error: error.message
      });
    }
    
    // Wait between tests
    if (i < deployment.contracts.shards.length - 1) {
      console.log("\nWaiting 3 seconds before next test...");
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Final balances
  const usdtBalanceFinal = await usdt.balanceOf(wallet.address);
  const daiBalanceFinal = await dai.balanceOf(wallet.address);
  console.log("\n💰 Final Balances:");
  console.log(`USDT: ${ethers.formatUnits(usdtBalanceFinal, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiBalanceFinal, 18)}`);
  
  console.log("\n📊 Test Summary:");
  console.log("=".repeat(60));
  const successCount = testResults.filter(r => r.success).length;
  console.log(`Total Tests: ${testResults.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${testResults.length - successCount}`);
  
  testResults.forEach(result => {
    if (result.success) {
      console.log(`\n✅ ${result.name}`);
      console.log(`   Before: ${result.reservesBefore.usdt} USDT, ${result.reservesBefore.dai} DAI`);
      console.log(`   After:  ${result.reservesAfter.usdt} USDT, ${result.reservesAfter.dai} DAI`);
    } else {
      console.log(`\n❌ ${result.name}`);
      console.log(`   Error: ${result.error}`);
    }
  });

  console.log("\n🎉 Testing Complete!");
}

main()
  .then(() => {
    console.log("\n✅ Tests completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Tests failed:");
    console.error(error);
    process.exit(1);
  });
