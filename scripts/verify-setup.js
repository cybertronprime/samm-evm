const fs = require("fs");
const path = require("path");
const { chainConfigs } = require("../config/deployment-config");

/**
 * Quick setup verification without network calls
 */
function verifySetup() {
  console.log("🔍 SAMM Multi-Chain Setup Verification");
  console.log("=".repeat(50));

  const checks = [];

  // Check 1: Configuration files exist
  console.log("\n1️⃣ Checking configuration files...");
  
  const configPath = path.join(__dirname, "..", "config", "chains.json");
  if (fs.existsSync(configPath)) {
    console.log("✅ chains.json exists");
    checks.push(true);
  } else {
    console.log("❌ chains.json missing");
    checks.push(false);
  }

  // Check 2: Hardhat config
  const hardhatConfigPath = path.join(__dirname, "..", "hardhat.config.js");
  if (fs.existsSync(hardhatConfigPath)) {
    console.log("✅ hardhat.config.js exists");
    checks.push(true);
  } else {
    console.log("❌ hardhat.config.js missing");
    checks.push(false);
  }

  // Check 3: Deployment scripts
  console.log("\n2️⃣ Checking deployment scripts...");
  
  const scripts = [
    "deploy-sepolia.js",
    "deploy-monad.js", 
    "deploy-risechain.js",
    "deploy-multi-chain.js",
    "estimate-gas.js",
    "validate-multi-chain-setup.js",
    "test-end-to-end-sepolia.js"
  ];

  scripts.forEach(script => {
    const scriptPath = path.join(__dirname, script);
    if (fs.existsSync(scriptPath)) {
      console.log(`✅ ${script} exists`);
      checks.push(true);
    } else {
      console.log(`❌ ${script} missing`);
      checks.push(false);
    }
  });

  // Check 4: Chain configurations
  console.log("\n3️⃣ Checking chain configurations...");
  
  Object.entries(chainConfigs).forEach(([network, config]) => {
    console.log(`✅ ${network}: ${config.name} (Chain ID: ${config.chainId})`);
    checks.push(true);
  });

  // Check 5: Required directories
  console.log("\n4️⃣ Checking directory structure...");
  
  const dirs = ["config", "scripts", "contracts"];
  dirs.forEach(dir => {
    const dirPath = path.join(__dirname, "..", dir);
    if (fs.existsSync(dirPath)) {
      console.log(`✅ ${dir}/ directory exists`);
      checks.push(true);
    } else {
      console.log(`❌ ${dir}/ directory missing`);
      checks.push(false);
    }
  });

  // Check 6: Package.json scripts
  console.log("\n5️⃣ Checking package.json scripts...");
  
  const packagePath = path.join(__dirname, "..", "package.json");
  if (fs.existsSync(packagePath)) {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    const requiredScripts = [
      "validate:setup",
      "estimate:gas", 
      "deploy:multi",
      "test:e2e:sepolia"
    ];
    
    requiredScripts.forEach(script => {
      if (pkg.scripts && pkg.scripts[script]) {
        console.log(`✅ npm script: ${script}`);
        checks.push(true);
      } else {
        console.log(`❌ npm script missing: ${script}`);
        checks.push(false);
      }
    });
  }

  // Summary
  const passed = checks.filter(Boolean).length;
  const total = checks.length;
  
  console.log("\n📊 SETUP VERIFICATION SUMMARY");
  console.log("=".repeat(50));
  console.log(`✅ Passed: ${passed}/${total} checks`);
  
  if (passed === total) {
    console.log("\n🎉 Setup verification complete! Ready for deployment.");
    console.log("\nNext steps:");
    console.log("1. Set up .env file with your private key and RPC URLs");
    console.log("2. Fund your wallet with testnet tokens");
    console.log("3. Run: npm run test:e2e:sepolia");
    return true;
  } else {
    console.log("\n⚠️ Some checks failed. Please fix issues before proceeding.");
    return false;
  }
}

// Run verification
if (require.main === module) {
  const success = verifySetup();
  process.exit(success ? 0 : 1);
}

module.exports = { verifySetup };