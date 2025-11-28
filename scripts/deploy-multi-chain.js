const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { 
  createProvider, 
  validateDeployerBalance, 
  getDeploymentParams,
  getChainConfig,
  chainConfigs 
} = require("../config/deployment-config");
const { estimateGasForNetwork } = require("./estimate-gas");

/**
 * Deploy SAMM to a specific network
 * @param {string} networkName - Target network name
 * @param {object} options - Deployment options
 */
async function deployToNetwork(networkName, options = {}) {
  console.log(`\n🚀 Starting SAMM deployment to ${networkName.toUpperCase()}`);
  console.log("=".repeat(60));

  const { provider, wallet, config } = createProvider(networkName);
  const deploymentParams = getDeploymentParams(networkName);

  console.log("📋 Deployment Details:");
  console.log(`Network: ${config.name} (Chain ID: ${config.chainId})`);
  console.log(`Deployer: ${wallet.address}`);
  
  // Pre-deployment validation
  if (!options.skipValidation) {
    console.log("\n🔍 Pre-deployment validation...");
    
    // Validate balance
    const balanceCheck = await validateDeployerBalance(provider, wallet.address, networkName);
    console.log(`Balance: ${balanceCheck.balanceEth} ${balanceCheck.nativeTokenSymbol}`);
    console.log(`Required: ${balanceCheck.minRequiredEth} ${balanceCheck.nativeTokenSymbol}`);
    
    if (!balanceCheck.isValid) {
      throw new Error(`❌ Insufficient balance. Need ${balanceCheck.shortfallEth} more ${balanceCheck.nativeTokenSymbol}`);
    }
    console.log("✅ Balance validation passed");
    
    // Test network connection
    const network = await provider.getNetwork();
    console.log(`✅ Connected to ${config.name} (Chain ID: ${network.chainId})`);
  }

  const deploymentStart = Date.now();
  const deploymentResults = {
    networkName,
    config: config.name,
    chainId: config.chainId,
    deployer: wallet.address,
    startTime: new Date().toISOString(),
    contracts: {},
    transactions: {},
    gasUsed: {},
    errors: []
  };

  try {
    // Deploy SAMM Pool Factory
    console.log("\n1️⃣ Deploying SAMM Pool Factory...");
    const SAMMPoolFactory = await ethers.getContractFactory("SAMMPoolFactory", wallet);
    
    const factoryTx = await SAMMPoolFactory.deploy({
      gasLimit: deploymentParams.gasSettings.gasLimit
    });
    
    console.log(`⏳ Factory deployment tx: ${factoryTx.deploymentTransaction().hash}`);
    const factory = await factoryTx.waitForDeployment();
    await factory.deploymentTransaction().wait(deploymentParams.confirmations);
    
    const factoryAddress = await factory.getAddress();
    console.log(`✅ SAMM Factory deployed: ${factoryAddress}`);
    
    deploymentResults.contracts.factory = factoryAddress;
    deploymentResults.transactions.factory = factoryTx.deploymentTransaction().hash;
    deploymentResults.gasUsed.factory = factoryTx.deploymentTransaction().gasLimit;

    // Deploy test tokens (for validation)
    if (options.deployTestTokens !== false) {
      console.log("\n2️⃣ Deploying test tokens...");
      const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
      
      const tokenA = await MockERC20.deploy(`${config.name} Test Token A`, `${networkName.toUpperCase()}A`, 18);
      await tokenA.waitForDeployment();
      
      const tokenB = await MockERC20.deploy(`${config.name} Test Token B`, `${networkName.toUpperCase()}B`, 18);
      await tokenB.waitForDeployment();
      
      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();
      
      console.log(`✅ Test Token A: ${tokenAAddress}`);
      console.log(`✅ Test Token B: ${tokenBAddress}`);
      
      deploymentResults.contracts.testTokenA = tokenAAddress;
      deploymentResults.contracts.testTokenB = tokenBAddress;

      // Create test shard for parameter verification
      console.log("\n3️⃣ Creating test shard...");
      const createTx = await factory.createShardDefault(tokenAAddress, tokenBAddress);
      const receipt = await createTx.wait(deploymentParams.confirmations);
      
      const shardCreatedEvent = receipt.logs.find(
        log => log.fragment && log.fragment.name === "ShardCreated"
      );
      const shardAddress = shardCreatedEvent.args[0];
      console.log(`✅ Test Shard created: ${shardAddress}`);
      
      deploymentResults.contracts.testShard = shardAddress;
      deploymentResults.transactions.testShard = createTx.hash;

      // Verify SAMM parameters
      console.log("\n4️⃣ Verifying SAMM parameters...");
      const SAMMPool = await ethers.getContractFactory("SAMMPool");
      const shard = SAMMPool.attach(shardAddress);
      
      const [beta1, rmin, rmax, c] = await shard.getSAMMParams();
      const sammParams = {
        beta1: Number(beta1),
        rmin: Number(rmin),
        rmax: Number(rmax),
        c: Number(c)
      };
      
      console.log(`✅ SAMM Parameters:`);
      console.log(`   β1: ${sammParams.beta1} (expected: ${deploymentParams.sammParameters.beta1})`);
      console.log(`   rmin: ${sammParams.rmin} (expected: ${deploymentParams.sammParameters.rmin})`);
      console.log(`   rmax: ${sammParams.rmax} (expected: ${deploymentParams.sammParameters.rmax})`);
      console.log(`   c: ${sammParams.c} (expected: ${deploymentParams.sammParameters.c})`);

      // Verify parameters match
      const paramsMatch = 
        sammParams.beta1 === deploymentParams.sammParameters.beta1 &&
        sammParams.rmin === deploymentParams.sammParameters.rmin &&
        sammParams.rmax === deploymentParams.sammParameters.rmax &&
        sammParams.c === deploymentParams.sammParameters.c;

      if (!paramsMatch) {
        throw new Error("❌ SAMM parameters do not match expected values");
      }
      
      deploymentResults.sammParameters = sammParams;
      console.log("✅ All SAMM parameters verified");
    }

    deploymentResults.endTime = new Date().toISOString();
    deploymentResults.duration = Date.now() - deploymentStart;
    deploymentResults.success = true;

    console.log(`\n🎉 ${config.name} deployment completed successfully!`);
    console.log(`⏱️  Total time: ${(deploymentResults.duration / 1000).toFixed(2)}s`);
    
    return deploymentResults;

  } catch (error) {
    deploymentResults.endTime = new Date().toISOString();
    deploymentResults.duration = Date.now() - deploymentStart;
    deploymentResults.success = false;
    deploymentResults.errors.push(error.message);
    
    console.error(`❌ ${config.name} deployment failed:`, error.message);
    throw error;
  }
}

/**
 * Deploy SAMM to multiple networks
 * @param {string[]} networks - Array of network names
 * @param {object} options - Deployment options
 */
async function deployMultiChain(networks, options = {}) {
  console.log("🌐 SAMM Multi-Chain Deployment");
  console.log("=".repeat(60));
  console.log(`Target networks: ${networks.join(", ")}`);
  
  const results = [];
  const errors = [];

  // Pre-flight checks
  if (!options.skipPreFlight) {
    console.log("\n🔍 Pre-flight checks...");
    for (const network of networks) {
      try {
        const gasEstimate = await estimateGasForNetwork(network);
        if (!gasEstimate.canDeploy) {
          errors.push(`${network}: ${gasEstimate.error || "Insufficient balance"}`);
        }
      } catch (error) {
        errors.push(`${network}: ${error.message}`);
      }
    }
    
    if (errors.length > 0) {
      console.error("\n❌ Pre-flight check failures:");
      errors.forEach(error => console.error(`   ${error}`));
      
      if (!options.continueOnError) {
        throw new Error("Pre-flight checks failed. Use --continue-on-error to proceed anyway.");
      }
    } else {
      console.log("✅ All pre-flight checks passed");
    }
  }

  // Deploy to each network
  for (const network of networks) {
    try {
      const result = await deployToNetwork(network, options);
      results.push(result);
    } catch (error) {
      const failedResult = {
        networkName: network,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
      results.push(failedResult);
      
      if (!options.continueOnError) {
        throw error;
      }
    }
  }

  // Save comprehensive deployment report
  const report = {
    deploymentType: "multi-chain",
    timestamp: new Date().toISOString(),
    networks: networks,
    options: options,
    results: results,
    summary: {
      total: networks.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    }
  };

  const reportPath = path.join(__dirname, "..", "deployments", `multi-chain-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Summary
  console.log("\n📊 DEPLOYMENT SUMMARY");
  console.log("=".repeat(60));
  results.forEach(result => {
    const status = result.success ? "✅ SUCCESS" : "❌ FAILED";
    const info = result.success ? 
      `(${(result.duration / 1000).toFixed(2)}s)` : 
      `(${result.error})`;
    console.log(`${result.networkName.toUpperCase()}: ${status} ${info}`);
  });
  
  console.log(`\n🎯 ${report.summary.successful}/${report.summary.total} networks deployed successfully`);
  console.log(`📄 Full report saved to: ${reportPath}`);

  return report;
}

// CLI execution
async function main() {
  const args = process.argv.slice(2);
  const networkArg = args[0];
  
  const options = {
    skipValidation: args.includes("--skip-validation"),
    skipPreFlight: args.includes("--skip-preflight"),
    continueOnError: args.includes("--continue-on-error"),
    deployTestTokens: !args.includes("--no-test-tokens")
  };

  if (!networkArg || networkArg === "help") {
    console.log("Usage: node deploy-multi-chain.js <network|all> [options]");
    console.log("\nNetworks: sepolia, monad, risechain, all");
    console.log("\nOptions:");
    console.log("  --skip-validation    Skip balance validation");
    console.log("  --skip-preflight     Skip pre-flight checks");
    console.log("  --continue-on-error  Continue deployment even if some networks fail");
    console.log("  --no-test-tokens     Skip test token deployment");
    return;
  }

  if (networkArg === "all") {
    const allNetworks = Object.keys(chainConfigs);
    await deployMultiChain(allNetworks, options);
  } else if (chainConfigs[networkArg]) {
    await deployToNetwork(networkArg, options);
  } else {
    throw new Error(`Unsupported network: ${networkArg}`);
  }
}

// Export for use in other scripts
module.exports = {
  deployToNetwork,
  deployMultiChain
};

// Run if called directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Deployment failed:", error.message);
      process.exit(1);
    });
}