const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const { 
  createProvider, 
  validateDeployerBalance, 
  getChainConfig,
  chainConfigs 
} = require("../config/deployment-config");

/**
 * Validate setup for a specific network
 * @param {string} networkName - Network to validate
 */
async function validateNetworkSetup(networkName) {
  console.log(`\n🔍 Validating ${networkName.toUpperCase()} setup...`);
  console.log("-".repeat(40));

  const validation = {
    networkName,
    timestamp: new Date().toISOString(),
    checks: {},
    overall: false
  };

  try {
    // Check 1: Configuration exists
    console.log("1️⃣ Checking configuration...");
    const config = getChainConfig(networkName);
    validation.checks.configuration = {
      passed: true,
      details: `Found config for ${config.name} (Chain ID: ${config.chainId})`
    };
    console.log(`   ✅ Configuration found for ${config.name}`);

    // Check 2: Environment variables
    console.log("2️⃣ Checking environment variables...");
    const requiredEnvVars = [
      'PRIVATE_KEY',
      `${networkName.toUpperCase()}_RPC_URL`
    ];

    const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
    
    if (missingEnvVars.length > 0) {
      validation.checks.environment = {
        passed: false,
        details: `Missing environment variables: ${missingEnvVars.join(", ")}`
      };
      console.log(`   ❌ Missing: ${missingEnvVars.join(", ")}`);
    } else {
      validation.checks.environment = {
        passed: true,
        details: "All required environment variables present"
      };
      console.log("   ✅ All environment variables present");
    }

    // Check 3: Network connectivity
    console.log("3️⃣ Testing network connectivity...");
    try {
      const { provider, wallet } = createProvider(networkName);
      const network = await provider.getNetwork();
      
      validation.checks.connectivity = {
        passed: true,
        details: `Connected to Chain ID ${network.chainId}`,
        chainId: Number(network.chainId),
        expectedChainId: config.chainId
      };

      if (Number(network.chainId) === config.chainId) {
        console.log(`   ✅ Connected to correct network (Chain ID: ${network.chainId})`);
      } else {
        console.log(`   ⚠️  Chain ID mismatch: got ${network.chainId}, expected ${config.chainId}`);
        validation.checks.connectivity.warning = "Chain ID mismatch";
      }

      // Check 4: Deployer balance
      console.log("4️⃣ Checking deployer balance...");
      const balanceCheck = await validateDeployerBalance(provider, wallet.address, networkName);
      
      validation.checks.balance = {
        passed: balanceCheck.isValid,
        details: `${balanceCheck.balanceEth} ${balanceCheck.nativeTokenSymbol} (required: ${balanceCheck.minRequiredEth})`,
        balance: balanceCheck.balanceEth,
        required: balanceCheck.minRequiredEth,
        shortfall: balanceCheck.shortfallEth
      };

      if (balanceCheck.isValid) {
        console.log(`   ✅ Sufficient balance: ${balanceCheck.balanceEth} ${balanceCheck.nativeTokenSymbol}`);
      } else {
        console.log(`   ❌ Insufficient balance: ${balanceCheck.balanceEth} ${balanceCheck.nativeTokenSymbol}`);
        console.log(`      Need ${balanceCheck.shortfallEth} more ${balanceCheck.nativeTokenSymbol}`);
      }

      // Check 5: Gas price estimation
      console.log("5️⃣ Testing gas price estimation...");
      try {
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || ethers.parseUnits("20", "gwei");
        
        validation.checks.gasEstimation = {
          passed: true,
          details: `Current gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`,
          gasPrice: ethers.formatUnits(gasPrice, "gwei")
        };
        console.log(`   ✅ Gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
      } catch (error) {
        validation.checks.gasEstimation = {
          passed: false,
          details: `Gas estimation failed: ${error.message}`
        };
        console.log(`   ❌ Gas estimation failed: ${error.message}`);
      }

    } catch (error) {
      validation.checks.connectivity = {
        passed: false,
        details: `Connection failed: ${error.message}`
      };
      console.log(`   ❌ Connection failed: ${error.message}`);
    }

  } catch (error) {
    validation.checks.configuration = {
      passed: false,
      details: `Configuration error: ${error.message}`
    };
    console.log(`   ❌ Configuration error: ${error.message}`);
  }

  // Overall validation
  const allChecks = Object.values(validation.checks);
  validation.overall = allChecks.every(check => check.passed);
  
  const status = validation.overall ? "✅ READY" : "❌ NOT READY";
  console.log(`\n${networkName.toUpperCase()}: ${status}`);

  return validation;
}

/**
 * Validate setup for all networks
 */
async function validateAllNetworks() {
  console.log("🌐 SAMM Multi-Chain Setup Validation");
  console.log("=".repeat(60));

  const networks = Object.keys(chainConfigs);
  const results = [];

  for (const network of networks) {
    const result = await validateNetworkSetup(network);
    results.push(result);
  }

  // Generate summary report
  console.log("\n📊 VALIDATION SUMMARY");
  console.log("=".repeat(60));

  const readyNetworks = results.filter(r => r.overall);
  const notReadyNetworks = results.filter(r => !r.overall);

  console.log(`✅ Ready for deployment: ${readyNetworks.length}/${networks.length} networks`);
  
  if (readyNetworks.length > 0) {
    console.log("\n🟢 Ready Networks:");
    readyNetworks.forEach(result => {
      console.log(`   ${result.networkName.toUpperCase()}`);
    });
  }

  if (notReadyNetworks.length > 0) {
    console.log("\n🔴 Networks with Issues:");
    notReadyNetworks.forEach(result => {
      console.log(`   ${result.networkName.toUpperCase()}:`);
      Object.entries(result.checks).forEach(([check, details]) => {
        if (!details.passed) {
          console.log(`     ❌ ${check}: ${details.details}`);
        }
      });
    });
  }

  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: networks.length,
      ready: readyNetworks.length,
      notReady: notReadyNetworks.length
    },
    networks: results
  };

  const reportPath = path.join(__dirname, "..", "validation-reports", `setup-validation-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n📄 Detailed report saved to: ${reportPath}`);

  // Recommendations
  if (notReadyNetworks.length > 0) {
    console.log("\n💡 RECOMMENDATIONS:");
    
    notReadyNetworks.forEach(result => {
      console.log(`\n${result.networkName.toUpperCase()}:`);
      
      Object.entries(result.checks).forEach(([check, details]) => {
        if (!details.passed) {
          switch (check) {
            case 'environment':
              console.log(`   • Set missing environment variables in .env file`);
              break;
            case 'connectivity':
              console.log(`   • Check RPC URL and network connectivity`);
              break;
            case 'balance':
              console.log(`   • Add ${details.shortfall} ${result.checks.balance?.shortfall ? 'tokens' : ''} to deployer wallet`);
              break;
            case 'gasEstimation':
              console.log(`   • Check network status and RPC endpoint`);
              break;
          }
        }
      });
    });
  }

  return report;
}

// CLI execution
async function main() {
  const networkArg = process.argv[2];
  
  if (networkArg && networkArg !== "all") {
    if (chainConfigs[networkArg]) {
      await validateNetworkSetup(networkArg);
    } else {
      console.error(`❌ Unknown network: ${networkArg}`);
      console.log(`Available networks: ${Object.keys(chainConfigs).join(", ")}`);
      process.exit(1);
    }
  } else {
    await validateAllNetworks();
  }
}

// Export for use in other scripts
module.exports = {
  validateNetworkSetup,
  validateAllNetworks
};

// Run if called directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Validation failed:", error.message);
      process.exit(1);
    });
}