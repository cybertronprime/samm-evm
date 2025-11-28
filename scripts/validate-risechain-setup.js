require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("ethers");
const { 
  createProvider, 
  validateDeployerBalance, 
  getChainConfig 
} = require("../config/deployment-config");

async function validateRiseChainSetup() {
  console.log("🔍 RiseChain Testnet Setup Validation");
  console.log("=".repeat(50));

  const networkName = "risechain";
  
  try {
    // Check 1: Configuration
    console.log("1️⃣ Checking configuration...");
    const config = getChainConfig(networkName);
    console.log(`✅ Found config for ${config.name} (Chain ID: ${config.chainId})`);

    // Check 2: Environment variables
    console.log("\n2️⃣ Checking environment variables...");
    const requiredEnvVars = ['PRIVATE_KEY', 'RISECHAIN_RPC_URL'];
    const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
    
    if (missingEnvVars.length > 0) {
      console.log(`❌ Missing environment variables: ${missingEnvVars.join(", ")}`);
      console.log("\n💡 Please set the following in your .env file:");
      missingEnvVars.forEach(envVar => {
        console.log(`   ${envVar}=your_${envVar.toLowerCase()}_here`);
      });
      return false;
    }
    console.log("✅ All required environment variables present");

    // Check 3: Network connectivity
    console.log("\n3️⃣ Testing network connectivity...");
    const { provider, wallet } = createProvider(networkName);
    
    try {
      const network = await provider.getNetwork();
      console.log(`✅ Connected to Chain ID ${network.chainId}`);
      
      if (Number(network.chainId) !== config.chainId) {
        console.log(`⚠️  Chain ID mismatch: got ${network.chainId}, expected ${config.chainId}`);
        console.log("   This might indicate wrong RPC URL or network configuration");
      }
    } catch (error) {
      console.log(`❌ Connection failed: ${error.message}`);
      console.log("\n💡 Troubleshooting:");
      console.log("   1. Check RISECHAIN_RPC_URL in .env file");
      console.log("   2. Verify RiseChain testnet is accessible");
      console.log("   3. Try alternative RPC endpoints");
      return false;
    }

    // Check 4: Deployer balance
    console.log("\n4️⃣ Checking deployer balance...");
    console.log(`Deployer address: ${wallet.address}`);
    
    try {
      const balanceCheck = await validateDeployerBalance(provider, wallet.address, networkName);
      
      console.log(`Current balance: ${balanceCheck.balanceEth} ${balanceCheck.nativeTokenSymbol}`);
      console.log(`Required balance: ${balanceCheck.minRequiredEth} ${balanceCheck.nativeTokenSymbol}`);
      
      if (balanceCheck.isValid) {
        console.log("✅ Sufficient balance for deployment");
      } else {
        console.log(`❌ Insufficient balance`);
        console.log(`   Need ${balanceCheck.shortfallEth} more ${balanceCheck.nativeTokenSymbol}`);
        console.log("\n💡 To get RiseChain testnet tokens:");
        console.log("   1. Visit RiseChain testnet faucet");
        console.log("   2. Request tokens for:", wallet.address);
        console.log("   3. Wait for tokens and retry validation");
        return false;
      }
    } catch (error) {
      console.log(`❌ Balance check failed: ${error.message}`);
      return false;
    }

    // Check 5: Gas estimation
    console.log("\n5️⃣ Testing gas price estimation...");
    try {
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits("20", "gwei");
      console.log(`✅ Current gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
    } catch (error) {
      console.log(`⚠️  Gas estimation warning: ${error.message}`);
      console.log("   Deployment may still work with default gas settings");
    }

    console.log("\n🎉 RiseChain testnet setup validation PASSED!");
    console.log("✅ Ready for SAMM deployment");
    
    console.log("\n🚀 To deploy SAMM to RiseChain testnet:");
    console.log("   npm run deploy:risechain");
    console.log("   or");
    console.log("   node scripts/deploy-risechain-testnet.js");
    
    return true;

  } catch (error) {
    console.error(`❌ Validation failed: ${error.message}`);
    return false;
  }
}

// CLI execution
async function main() {
  const isValid = await validateRiseChainSetup();
  process.exit(isValid ? 0 : 1);
}

// Export for use in other scripts
module.exports = {
  validateRiseChainSetup
};

// Run if called directly
if (require.main === module) {
  main();
}