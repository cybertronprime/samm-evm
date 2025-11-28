const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🔍 Validating Deployment Readiness");
  console.log("=" .repeat(50));

  let allChecks = true;

  // Check 1: Environment Configuration
  console.log("\n1️⃣ Checking Environment Configuration...");
  
  const requiredEnvVars = ["SEPOLIA_RPC_URL", "PRIVATE_KEY"];
  for (const envVar of requiredEnvVars) {
    if (process.env[envVar]) {
      console.log(`   ✅ ${envVar} is set`);
    } else {
      console.log(`   ❌ ${envVar} is missing`);
      allChecks = false;
    }
  }

  // Check 2: Network Connection
  console.log("\n2️⃣ Checking Network Connection...");
  
  try {
    const network = await ethers.provider.getNetwork();
    console.log(`   ✅ Connected to ${network.name} (Chain ID: ${network.chainId})`);
    
    if (network.chainId !== 11155111n) {
      console.log(`   ⚠️  Warning: Not connected to Sepolia (expected Chain ID: 11155111)`);
    }
  } catch (error) {
    console.log(`   ❌ Network connection failed: ${error.message}`);
    allChecks = false;
  }

  // Check 3: Account Balance
  console.log("\n3️⃣ Checking Account Balance...");
  
  try {
    const [deployer] = await ethers.getSigners();
    const balance = await ethers.provider.getBalance(deployer.address);
    const balanceEth = ethers.formatEther(balance);
    
    console.log(`   Account: ${deployer.address}`);
    console.log(`   Balance: ${balanceEth} ETH`);
    
    if (balance >= ethers.parseEther("0.1")) {
      console.log(`   ✅ Sufficient balance for deployment`);
    } else {
      console.log(`   ❌ Insufficient balance (need at least 0.1 ETH)`);
      allChecks = false;
    }
  } catch (error) {
    console.log(`   ❌ Account check failed: ${error.message}`);
    allChecks = false;
  }

  // Check 4: Contract Compilation
  console.log("\n4️⃣ Checking Contract Compilation...");
  
  try {
    const contracts = [
      "SAMMPoolFactory",
      "SAMMPool", 
      "SAMMFees",
      "MockERC20"
    ];
    
    for (const contractName of contracts) {
      try {
        await ethers.getContractFactory(contractName);
        console.log(`   ✅ ${contractName} compiled successfully`);
      } catch (error) {
        console.log(`   ❌ ${contractName} compilation failed`);
        allChecks = false;
      }
    }
  } catch (error) {
    console.log(`   ❌ Compilation check failed: ${error.message}`);
    allChecks = false;
  }

  // Check 5: Gas Price Estimation
  console.log("\n5️⃣ Checking Gas Prices...");
  
  try {
    const feeData = await ethers.provider.getFeeData();
    const gasPriceGwei = ethers.formatUnits(feeData.gasPrice || 0n, "gwei");
    
    console.log(`   Gas Price: ${gasPriceGwei} Gwei`);
    
    if (feeData.gasPrice && feeData.gasPrice < ethers.parseUnits("100", "gwei")) {
      console.log(`   ✅ Gas prices are reasonable`);
    } else {
      console.log(`   ⚠️  Warning: High gas prices detected`);
    }
  } catch (error) {
    console.log(`   ❌ Gas price check failed: ${error.message}`);
  }

  // Check 6: Deployment Directories
  console.log("\n6️⃣ Checking Deployment Setup...");
  
  const dirs = ["deployments", "test-reports"];
  for (const dir of dirs) {
    const dirPath = path.join(__dirname, "..", dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`   ✅ Created ${dir} directory`);
    } else {
      console.log(`   ✅ ${dir} directory exists`);
    }
  }

  // Check 7: Test Local Deployment
  console.log("\n7️⃣ Testing Local Deployment (Dry Run)...");
  
  try {
    // Test contract deployment locally
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const deployTx = await MockERC20.getDeployTransaction("Test", "TEST", 18);
    const gasEstimate = await ethers.provider.estimateGas(deployTx);
    
    console.log(`   ✅ Mock deployment gas estimate: ${gasEstimate.toLocaleString()}`);
    
    // Test SAMM factory deployment
    const SAMMPoolFactory = await ethers.getContractFactory("SAMMPoolFactory");
    const factoryDeployTx = await SAMMPoolFactory.getDeployTransaction();
    const factoryGasEstimate = await ethers.provider.estimateGas(factoryDeployTx);
    
    console.log(`   ✅ Factory deployment gas estimate: ${factoryGasEstimate.toLocaleString()}`);
    
    const totalGas = gasEstimate + factoryGasEstimate;
    const estimatedCost = totalGas * (feeData?.gasPrice || ethers.parseUnits("20", "gwei"));
    const estimatedCostEth = ethers.formatEther(estimatedCost);
    
    console.log(`   📊 Estimated deployment cost: ${estimatedCostEth} ETH`);
    
  } catch (error) {
    console.log(`   ❌ Dry run failed: ${error.message}`);
    allChecks = false;
  }

  // Final Summary
  console.log("\n" + "=" .repeat(50));
  
  if (allChecks) {
    console.log("🎉 All checks passed! Ready for Sepolia deployment");
    console.log("\n🚀 To deploy, run:");
    console.log("   npm run deploy:sepolia");
    console.log("\n🧪 To test after deployment, run:");
    console.log("   npm run test:sepolia");
  } else {
    console.log("❌ Some checks failed. Please fix the issues above before deploying.");
    console.log("\n📋 Common fixes:");
    console.log("   • Copy .env.example to .env and configure");
    console.log("   • Add Sepolia ETH to your account");
    console.log("   • Check your RPC URL and private key");
    console.log("   • Run 'npm run compile' to compile contracts");
  }

  return allChecks;
}

main()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error("❌ Validation failed:");
    console.error(error);
    process.exit(1);
  });