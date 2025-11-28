require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("ethers");
const { createProvider, validateDeployerBalance } = require("../config/deployment-config");

async function testRiseChainConnection() {
  console.log("🔍 Testing RiseChain Testnet Connection");
  console.log("=".repeat(50));

  try {
    const { provider, wallet, config } = createProvider("risechain");
    
    console.log("📋 Connection Details:");
    console.log(`Network: ${config.name}`);
    console.log(`Chain ID: ${config.chainId}`);
    console.log(`RPC URL: ${process.env.RISECHAIN_RPC_URL}`);
    console.log(`Deployer: ${wallet.address}`);
    
    // Test connection
    const network = await provider.getNetwork();
    console.log(`\n✅ Connected to Chain ID: ${network.chainId}`);
    
    // Check balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`💰 Current Balance: ${ethers.formatEther(balance)} ETH`);
    
    // Get latest block
    const blockNumber = await provider.getBlockNumber();
    console.log(`📦 Latest Block: ${blockNumber}`);
    
    // Test gas price
    const feeData = await provider.getFeeData();
    console.log(`⛽ Gas Price: ${ethers.formatUnits(feeData.gasPrice, "gwei")} gwei`);
    
    console.log("\n🎯 Deployer Address for Faucet:");
    console.log(`${wallet.address}`);
    console.log("\n💡 To get testnet tokens:");
    console.log("1. Visit RiseChain testnet faucet (if available)");
    console.log("2. Request tokens for the above address");
    console.log("3. Wait for tokens to arrive");
    console.log("4. Run deployment script");
    
    return true;
  } catch (error) {
    console.error("❌ Connection test failed:", error.message);
    return false;
  }
}

testRiseChainConnection()
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error("❌ Test failed:", error.message);
    process.exit(1);
  });