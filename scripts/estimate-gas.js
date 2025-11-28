const { ethers } = require("hardhat");
const { 
  createProvider, 
  estimateDeploymentCosts, 
  validateDeployerBalance,
  getChainConfig 
} = require("../config/deployment-config");

/**
 * Estimate gas costs for SAMM deployment on a specific network
 * @param {string} networkName - Target network (sepolia, monad, risechain)
 */
async function estimateGasForNetwork(networkName) {
  console.log(`\n🔍 Estimating gas costs for ${networkName.toUpperCase()}...`);
  console.log("=".repeat(50));

  try {
    const { provider, wallet, config } = createProvider(networkName);
    
    // Test connection
    console.log("📡 Testing network connection...");
    const network = await provider.getNetwork();
    console.log(`✅ Connected to ${config.name} (Chain ID: ${network.chainId})`);
    
    // Get deployer info
    console.log(`\n👤 Deployer: ${wallet.address}`);
    
    // Estimate costs
    const costs = await estimateDeploymentCosts(provider, networkName);
    console.log(`\n💰 Gas Cost Estimation:`);
    console.log(`   Current Gas Price: ${costs.gasPrice} gwei`);
    console.log(`   Estimated Total Gas: ${costs.totalGasEstimate.toLocaleString()}`);
    console.log(`   Estimated Cost: ${costs.totalCostEth} ${costs.nativeTokenSymbol}`);
    console.log(`   Minimum Required: ${costs.minBalanceRequiredEth} ${costs.nativeTokenSymbol}`);
    
    // Detailed gas breakdown
    console.log(`\n📊 Gas Breakdown:`);
    if (costs.estimatedGasUsage) {
      Object.entries(costs.estimatedGasUsage).forEach(([operation, gas]) => {
        const costWei = gas * (costs.totalCostWei / costs.totalGasEstimate);
        const costEth = ethers.formatEther(costWei);
        console.log(`   ${operation}: ${gas.toLocaleString()} gas (~${costEth} ${costs.nativeTokenSymbol})`);
      });
    }
    
    // Validate balance
    const balanceCheck = await validateDeployerBalance(provider, wallet.address, networkName);
    console.log(`\n💳 Balance Validation:`);
    console.log(`   Current Balance: ${balanceCheck.balanceEth} ${balanceCheck.nativeTokenSymbol}`);
    console.log(`   Required Balance: ${balanceCheck.minRequiredEth} ${balanceCheck.nativeTokenSymbol}`);
    
    if (balanceCheck.isValid) {
      console.log(`   ✅ Balance sufficient for deployment`);
    } else {
      console.log(`   ❌ Insufficient balance`);
      console.log(`   💸 Shortfall: ${balanceCheck.shortfallEth} ${balanceCheck.nativeTokenSymbol}`);
    }
    
    return {
      networkName,
      config,
      costs,
      balanceCheck,
      canDeploy: balanceCheck.isValid
    };
    
  } catch (error) {
    console.error(`❌ Error estimating gas for ${networkName}:`, error.message);
    return {
      networkName,
      error: error.message,
      canDeploy: false
    };
  }
}

/**
 * Estimate gas costs for all supported networks
 */
async function estimateAllNetworks() {
  console.log("🚀 SAMM Multi-Chain Gas Estimation");
  console.log("=".repeat(60));
  
  const networks = ["sepolia", "monad", "risechain"];
  const results = [];
  
  for (const network of networks) {
    const result = await estimateGasForNetwork(network);
    results.push(result);
  }
  
  // Summary
  console.log("\n📋 DEPLOYMENT READINESS SUMMARY");
  console.log("=".repeat(60));
  
  results.forEach(result => {
    const status = result.canDeploy ? "✅ READY" : "❌ NOT READY";
    const reason = result.error ? `(${result.error})` : 
                  !result.canDeploy ? "(Insufficient balance)" : "";
    console.log(`${result.networkName.toUpperCase()}: ${status} ${reason}`);
  });
  
  const readyNetworks = results.filter(r => r.canDeploy).length;
  console.log(`\n🎯 ${readyNetworks}/${networks.length} networks ready for deployment`);
  
  return results;
}

// CLI execution
async function main() {
  const networkArg = process.argv[2];
  
  if (networkArg && networkArg !== "all") {
    await estimateGasForNetwork(networkArg);
  } else {
    await estimateAllNetworks();
  }
}

// Export for use in other scripts
module.exports = {
  estimateGasForNetwork,
  estimateAllNetworks
};

// Run if called directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Gas estimation failed:", error);
      process.exit(1);
    });
}