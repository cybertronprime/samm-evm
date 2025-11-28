require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("ethers");

async function analyzeCsmallerBetterProperty() {
  console.log("🔍 ANALYZING C-SMALLER-BETTER PROPERTY");
  console.log("=".repeat(80));
  console.log("Testing SAMM's core theorem: smaller shards should have lower fees");
  console.log("=".repeat(80));

  try {
    const rpcUrl = process.env.RISECHAIN_RPC_URL;
    const privateKey = process.env.PRIVATE_KEY;
    
    const provider = new ethers.JsonRpcProvider(rpcUrl, {
      chainId: 11155931,
      name: "risechain-testnet",
      ensAddress: null
    });
    
    const wallet = new ethers.Wallet(privateKey, provider);
    
    // Use the deployed shards from our previous test
    const shards = [
      {
        name: "USDC/USDT-1 (Smallest)",
        address: "0x36A3950Ed31A2875dA4df2588528BDA6d9F4709A",
        expectedLiquidity: "100.0"
      },
      {
        name: "USDC/USDT-2 (Medium)",
        address: "0x28784E66A02Eee695086Cd05F67d9B9866AA68F0",
        expectedLiquidity: "500.0"
      },
      {
        name: "USDC/USDT-3 (Largest)",
        address: "0x7C68ebB44C1EA6CF3c48F12AB8BF77BD5A834Db7",
        expectedLiquidity: "1000.0"
      }
    ];
    
    // Load ABI
    const fs = require('fs');
    const path = require('path');
    
    const sammPoolArtifact = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'artifacts', 'contracts', 'SAMMPool.sol', 'SAMMPool.json')
    ));
    
    console.log("\n📊 TESTING MULTIPLE SWAP AMOUNTS ACROSS DIFFERENT SHARD SIZES");
    console.log("-".repeat(80));
    
    const testAmounts = [
      ethers.parseEther("0.1"),
      ethers.parseEther("0.5"),
      ethers.parseEther("1.0"),
      ethers.parseEther("2.0"),
      ethers.parseEther("5.0")
    ];
    
    const results = [];
    
    for (let i = 0; i < shards.length; i++) {
      const shardData = shards[i];
      console.log(`\n🔍 Testing ${shardData.name}:`);
      console.log(`Address: ${shardData.address}`);
      
      const shard = new ethers.Contract(shardData.address, sammPoolArtifact.abi, wallet);
      
      try {
        // Get current reserves
        const [reserveA, reserveB] = await shard.getReserves();
        const actualLiquidityA = ethers.formatEther(reserveA);
        const actualLiquidityB = ethers.formatEther(reserveB);
        
        console.log(`Current Liquidity: ${actualLiquidityA} / ${actualLiquidityB}`);
        
        // Get shard tokens
        const tokenA = await shard.tokenA();
        const tokenB = await shard.tokenB();
        
        const shardResults = {
          shardName: shardData.name,
          address: shardData.address,
          liquidityA: actualLiquidityA,
          liquidityB: actualLiquidityB,
          swapTests: []
        };
        
        // Test different swap amounts
        for (let j = 0; j < testAmounts.length; j++) {
          const swapAmount = testAmounts[j];
          const swapAmountFormatted = ethers.formatEther(swapAmount);
          
          try {
            const swapResult = await shard.calculateSwapSAMM(
              swapAmount,
              tokenA,
              tokenB
            );
            
            const amountIn = ethers.formatEther(swapResult.amountIn);
            const tradeFee = ethers.formatEther(swapResult.tradeFee);
            const ownerFee = ethers.formatEther(swapResult.ownerFee);
            const totalFee = parseFloat(tradeFee) + parseFloat(ownerFee);
            const feePercentage = (totalFee / parseFloat(amountIn)) * 100;
            
            console.log(`  ${swapAmountFormatted} tokens -> Fee: ${feePercentage.toFixed(3)}% (${totalFee.toFixed(6)} total)`);
            
            shardResults.swapTests.push({
              swapAmount: swapAmountFormatted,
              amountIn: amountIn,
              tradeFee: tradeFee,
              ownerFee: ownerFee,
              totalFee: totalFee,
              feePercentage: feePercentage
            });
            
          } catch (error) {
            console.log(`  ${swapAmountFormatted} tokens -> ERROR: ${error.message}`);
            shardResults.swapTests.push({
              swapAmount: swapAmountFormatted,
              error: error.message
            });
          }
        }
        
        results.push(shardResults);
        
      } catch (error) {
        console.log(`❌ Failed to test ${shardData.name}: ${error.message}`);
      }
    }
    
    // Analysis: C-Smaller-Better Property Verification
    console.log("\n🎯 C-SMALLER-BETTER PROPERTY ANALYSIS");
    console.log("=".repeat(80));
    
    // Compare fees for same swap amounts across different shard sizes
    for (let swapIndex = 0; swapIndex < testAmounts.length; swapIndex++) {
      const swapAmountFormatted = ethers.formatEther(testAmounts[swapIndex]);
      console.log(`\n📊 Comparing ${swapAmountFormatted} token swaps across shards:`);
      
      const validResults = results.filter(r => 
        r.swapTests[swapIndex] && !r.swapTests[swapIndex].error
      );
      
      if (validResults.length >= 2) {
        // Sort by liquidity (smallest first)
        validResults.sort((a, b) => parseFloat(a.liquidityA) - parseFloat(b.liquidityA));
        
        console.log("  Shard Size → Fee Percentage:");
        for (const result of validResults) {
          const test = result.swapTests[swapIndex];
          console.log(`    ${result.liquidityA} liquidity → ${test.feePercentage.toFixed(3)}%`);
        }
        
        // Verify c-smaller-better property
        let propertyHolds = true;
        for (let i = 1; i < validResults.length; i++) {
          const smallerShardFee = validResults[i-1].swapTests[swapIndex].feePercentage;
          const largerShardFee = validResults[i].swapTests[swapIndex].feePercentage;
          
          if (smallerShardFee >= largerShardFee) {
            propertyHolds = false;
            console.log(`    ❌ Property violation: ${validResults[i-1].shardName} (${smallerShardFee.toFixed(3)}%) >= ${validResults[i].shardName} (${largerShardFee.toFixed(3)}%)`);
          }
        }
        
        if (propertyHolds) {
          console.log(`    ✅ C-smaller-better property HOLDS for ${swapAmountFormatted} token swaps`);
        }
      } else {
        console.log(`    ⚠️  Insufficient data for comparison`);
      }
    }
    
    // Overall Analysis
    console.log("\n🏆 OVERALL C-SMALLER-BETTER PROPERTY ANALYSIS");
    console.log("=".repeat(80));
    
    // Calculate average fee reduction from largest to smallest shard
    const validSwapTests = [];
    for (let i = 0; i < testAmounts.length; i++) {
      const validResults = results.filter(r => 
        r.swapTests[i] && !r.swapTests[i].error
      );
      
      if (validResults.length >= 2) {
        validResults.sort((a, b) => parseFloat(a.liquidityA) - parseFloat(b.liquidityA));
        const smallestFee = validResults[0].swapTests[i].feePercentage;
        const largestFee = validResults[validResults.length - 1].swapTests[i].feePercentage;
        const feeReduction = ((largestFee - smallestFee) / largestFee) * 100;
        
        validSwapTests.push({
          swapAmount: ethers.formatEther(testAmounts[i]),
          smallestShardFee: smallestFee,
          largestShardFee: largestFee,
          feeReduction: feeReduction
        });
      }
    }
    
    if (validSwapTests.length > 0) {
      console.log("Fee reduction by using smallest vs largest shard:");
      let totalReduction = 0;
      
      for (const test of validSwapTests) {
        console.log(`  ${test.swapAmount} tokens: ${test.feeReduction.toFixed(1)}% reduction (${test.largestShardFee.toFixed(3)}% → ${test.smallestShardFee.toFixed(3)}%)`);
        totalReduction += test.feeReduction;
      }
      
      const avgReduction = totalReduction / validSwapTests.length;
      console.log(`\n🎯 Average fee reduction: ${avgReduction.toFixed(1)}%`);
      
      if (avgReduction > 0) {
        console.log("✅ C-SMALLER-BETTER PROPERTY CONFIRMED!");
        console.log("✅ Smaller shards consistently provide better rates");
        console.log("✅ SAMM's routing incentive mechanism is working correctly");
      } else {
        console.log("❌ C-smaller-better property may not be working correctly");
      }
    }
    
    // Fee Structure Explanation
    console.log("\n📚 FEE STRUCTURE EXPLANATION");
    console.log("=".repeat(80));
    console.log("Trade Fee: Dynamic fee based on SAMM algorithm");
    console.log("  - Calculated using: tf_SAMM(RA,RB,OA) = (RB/RA) × OA × max{rmin, β1×(OA/RA) + rmax}");
    console.log("  - Varies with shard size and trade amount");
    console.log("  - Smaller shards = lower trade fees");
    console.log("");
    console.log("Owner Fee: Fixed percentage fee (0.05%)");
    console.log("  - Goes to the pool owner");
    console.log("  - Same across all shards");
    console.log("");
    console.log("Total Fee = Trade Fee + Owner Fee");
    console.log("C-smaller-better: Smaller shards have lower total fees");
    
    return {
      results: results,
      validSwapTests: validSwapTests,
      propertyConfirmed: validSwapTests.length > 0 && validSwapTests.every(t => t.feeReduction > 0)
    };
    
  } catch (error) {
    console.error("❌ Analysis failed:", error.message);
    throw error;
  }
}

analyzeCsmallerBetterProperty()
  .then((result) => {
    console.log("\n✅ C-SMALLER-BETTER PROPERTY ANALYSIS COMPLETED");
    if (result.propertyConfirmed) {
      console.log("🏆 SAMM's c-smaller-better property is working correctly!");
      console.log("🏆 Smaller shards provide better rates, incentivizing optimal routing!");
    } else {
      console.log("⚠️  C-smaller-better property needs investigation");
    }
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Analysis failed:", error.message);
    process.exit(1);
  });