const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const deploymentFile = "production-risechain-1770744587343.json";
const deploymentPath = path.join(__dirname, "..", "deployment-data", deploymentFile);
const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

const GAS_LIMIT = 12000000;

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 COMPREHENSIVE ALL-POOLS TESTING");
  console.log("=".repeat(80));
  
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Tester: ${deployer.address}`);
  console.log(`Factory: ${deployment.contracts.factory}`);
  console.log(`Router: ${deployment.contracts.router}`);
  
  // Load all tokens
  const tokens = {};
  for (const [symbol, data] of Object.entries(deployment.contracts.tokens)) {
    tokens[symbol] = await hre.ethers.getContractAt("MockERC20", data.address);
  }
  
  const router = await hre.ethers.getContractAt("CrossPoolRouter", deployment.contracts.router);
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  
  // Approve all tokens
  console.log("\n📝 Approving tokens...");
  for (const [symbol, token] of Object.entries(tokens)) {
    const decimals = await token.decimals();
    await token.approve(deployment.contracts.router, hre.ethers.parseUnits("1000000", decimals));
  }
  console.log("✅ All tokens approved");
  
  let totalTests = 0;
  let passedTests = 0;
  
  // Test all pool pairs
  for (const [pairName, shards] of Object.entries(deployment.contracts.shards)) {
    console.log("\n" + "=".repeat(80));
    console.log(`📊 TESTING ${pairName} (${shards.length} shards)`);
    console.log("=".repeat(80));
    
    // Display shard info
    shards.forEach((shard, i) => {
      console.log(`   ${i + 1}. ${shard.name}: ${shard.liquidityUSD.toLocaleString()}`);
      console.log(`      ${shard.tokenA}: ${shard.amountA}, ${shard.tokenB}: ${shard.amountB}`);
    });
    
    const [token0Symbol, token1Symbol] = pairName.split("-");
    const token0 = tokens[token0Symbol];
    const token1 = tokens[token1Symbol];
    const decimals0 = await token0.decimals();
    const decimals1 = await token1.decimals();
    
    // Test both directions with small amounts (0.001 of each token)
    const tests = [
      { 
        tokenIn: token0, tokenOut: token1, 
        tokenInSymbol: token0Symbol, tokenOutSymbol: token1Symbol,
        amountOut: hre.ethers.parseUnits("0.001", decimals1),
        maxAmountIn: hre.ethers.parseUnits("1000000", decimals0),
        decimalsIn: decimals0, decimalsOut: decimals1
      },
      { 
        tokenIn: token1, tokenOut: token0,
        tokenInSymbol: token1Symbol, tokenOutSymbol: token0Symbol,
        amountOut: hre.ethers.parseUnits("0.001", decimals0),
        maxAmountIn: hre.ethers.parseUnits("1000000", decimals1),
        decimalsIn: decimals1, decimalsOut: decimals0
      }
    ];
    
    for (const test of tests) {
      totalTests++;
      
      console.log(`\n🔄 ${test.tokenInSymbol} → ${test.tokenOutSymbol}`);
      
      try {
        // First get a quote
        const quote = await router.quoteSwap([{
          tokenIn: test.tokenIn.target,
          tokenOut: test.tokenOut.target,
          amountOut: test.amountOut
        }]);
        
        console.log(`   📋 Quote: ${hre.ethers.formatUnits(quote.expectedAmountIn, test.decimalsIn)} ${test.tokenInSymbol} for ${hre.ethers.formatUnits(test.amountOut, test.decimalsOut)} ${test.tokenOutSymbol}`);
        console.log(`   📍 Selected shard: ${quote.selectedShards[0]}`);
        
        // Use quote with 20% slippage tolerance
        const maxAmountIn = (quote.expectedAmountIn * 120n) / 100n;
        
        const balanceInBefore = await test.tokenIn.balanceOf(deployer.address);
        const balanceOutBefore = await test.tokenOut.balanceOf(deployer.address);
        
        const tx = await router.swapExactOutput({
          hops: [{
            tokenIn: test.tokenIn.target,
            tokenOut: test.tokenOut.target,
            amountOut: test.amountOut
          }],
          maxAmountIn,
          deadline,
          recipient: deployer.address
        }, { gasLimit: GAS_LIMIT });
        
        await tx.wait();
        
        const balanceInAfter = await test.tokenIn.balanceOf(deployer.address);
        const balanceOutAfter = await test.tokenOut.balanceOf(deployer.address);
        
        const spent = balanceInBefore - balanceInAfter;
        const received = balanceOutAfter - balanceOutBefore;
        
        console.log(`   ✅ Swap successful`);
        console.log(`   ${test.tokenInSymbol} spent: ${hre.ethers.formatUnits(spent, test.decimalsIn)}`);
        console.log(`   ${test.tokenOutSymbol} received: ${hre.ethers.formatUnits(received, test.decimalsOut)}`);
        
        passedTests++;
      } catch (error) {
        console.log(`   ❌ Swap failed: ${error.message}`);
        if (error.message.includes("reverted")) {
          // Try to get more details
          try {
            const quote = await router.quoteSwap([{
              tokenIn: test.tokenIn.target,
              tokenOut: test.tokenOut.target,
              amountOut: test.amountOut
            }]);
            console.log(`   ℹ️  Quote succeeded: ${hre.ethers.formatUnits(quote.expectedAmountIn, test.decimalsIn)} ${test.tokenInSymbol}`);
            console.log(`   ℹ️  But swap execution failed - possible slippage or state change`);
          } catch (quoteError) {
            console.log(`   ℹ️  Quote also failed: ${quoteError.message.slice(0, 80)}`);
          }
        }
      }
    }
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("📊 FINAL RESULTS");
  console.log("=".repeat(80));
  console.log(`Total tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}/${totalTests} (${((passedTests/totalTests)*100).toFixed(1)}%)`);
  
  if (passedTests === totalTests) {
    console.log(`\n🎉 ALL TESTS PASSED!`);
  } else {
    console.log(`\n⚠️  ${totalTests - passedTests} test(s) failed`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
