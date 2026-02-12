/**
 * Fund User Wallet with Test Tokens
 * 
 * This script sends test tokens from the deployer wallet to a specified user wallet.
 * Tokens: WETH, WBTC, USDC, USDT, DAI, LINK, UNI, AAVE
 * 
 * Usage: node scripts/fund-user-wallet.js
 */

const { ethers } = require("ethers");

// Configuration
const USER_WALLET = "0x1eAbDF939a62E878DCb70544FD6bec51C58F99Ad";
const DEPLOYER_PRIVATE_KEY = "2571a342f4f03a8f341e14854624a242d85e7538dc47063382c883e59dfc3363";

// Token addresses from new deployment (2026-02-10)
const TOKEN_ADDRESSES = {
  WETH: "0x0ec0b10b40832cD9805481F132f966B156d70Cc7",
  WBTC: "0xEf6c9F206Ad4333Ca049C874ae6956f849e71479",
  USDC: "0xDA4aABea512d4030863652dbB21907B6eC97ad23",
  USDT: "0x89D668205724fbFBaAe1BDF32F0aA046f6bdD7Cd",
  DAI: "0x9DcC3d09865292A2D5c39e08EEa583dd29390522",
  LINK: "0xD4Afa6b83888aABbe74b288b4241F39Ad8A8e0bA",
  UNI: "0xEebe649Cef7ed5b1fD4BE3222bA94f316eBdbE6c",
  AAVE: "0x92EfA27dBb61069d4f65a656E1e9781509982ba7"
};

// Amount to send for each token (generous amounts for testing)
const AMOUNTS = {
  WETH: ethers.parseEther("10"),      // 10 WETH
  WBTC: ethers.parseUnits("1", 8),    // 1 WBTC (8 decimals)
  USDC: ethers.parseUnits("50000", 6), // 50,000 USDC (6 decimals)
  USDT: ethers.parseUnits("50000", 6), // 50,000 USDT (6 decimals)
  DAI: ethers.parseEther("50000"),     // 50,000 DAI
  LINK: ethers.parseEther("1000"),     // 1,000 LINK
  UNI: ethers.parseEther("1000"),      // 1,000 UNI
  AAVE: ethers.parseEther("100")       // 100 AAVE
};

// ERC20 ABI for transfer function
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

async function main() {
  console.log("🚀 Starting wallet funding process...\n");
  console.log(`Target Wallet: ${USER_WALLET}`);
  console.log(`Deployer Private Key: ${DEPLOYER_PRIVATE_KEY.substring(0, 10)}...`);
  console.log("");

  // Connect to RiseChain Testnet
  const provider = new ethers.JsonRpcProvider("https://testnet.riselabs.xyz");
  const deployer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
  
  console.log(`Deployer Address: ${deployer.address}`);
  const deployerBalance = await provider.getBalance(deployer.address);
  console.log(`Deployer ETH Balance: ${ethers.formatEther(deployerBalance)} ETH\n`);

  // Send native ETH first
  console.log("📤 Sending native ETH...");
  try {
    const ethAmount = ethers.parseEther("1"); // Send 1 ETH
    const ethTx = await deployer.sendTransaction({
      to: USER_WALLET,
      value: ethAmount,
      gasLimit: 21000
    });
    await ethTx.wait();
    console.log(`✅ Sent 1 ETH`);
    console.log(`   TX: ${ethTx.hash}\n`);
  } catch (error) {
    console.error(`❌ Failed to send ETH: ${error.message}\n`);
  }

  // Send each token
  for (const [symbol, address] of Object.entries(TOKEN_ADDRESSES)) {
    console.log(`📤 Sending ${symbol}...`);
    
    try {
      const token = new ethers.Contract(address, ERC20_ABI, deployer);
      const amount = AMOUNTS[symbol];
      
      // Check deployer balance
      const balance = await token.balanceOf(deployer.address);
      const decimals = await token.decimals();
      
      console.log(`   Deployer Balance: ${ethers.formatUnits(balance, decimals)} ${symbol}`);
      console.log(`   Amount to Send: ${ethers.formatUnits(amount, decimals)} ${symbol}`);
      
      if (balance < amount) {
        console.log(`   ⚠️  Insufficient balance, sending available amount instead`);
      }
      
      const actualAmount = balance < amount ? balance : amount;
      
      // Transfer tokens
      const tx = await token.transfer(USER_WALLET, actualAmount, {
        gasLimit: 100000
      });
      
      await tx.wait();
      
      console.log(`   ✅ Sent ${ethers.formatUnits(actualAmount, decimals)} ${symbol}`);
      console.log(`   TX: ${tx.hash}\n`);
      
    } catch (error) {
      console.error(`   ❌ Failed to send ${symbol}: ${error.message}\n`);
    }
  }

  // Check final balances
  console.log("\n📊 Final User Wallet Balances:");
  console.log("================================");
  
  const userEthBalance = await provider.getBalance(USER_WALLET);
  console.log(`ETH: ${ethers.formatEther(userEthBalance)}`);
  
  for (const [symbol, address] of Object.entries(TOKEN_ADDRESSES)) {
    try {
      const token = new ethers.Contract(address, ERC20_ABI, provider);
      const balance = await token.balanceOf(USER_WALLET);
      const decimals = await token.decimals();
      console.log(`${symbol}: ${ethers.formatUnits(balance, decimals)}`);
    } catch (error) {
      console.log(`${symbol}: Error reading balance`);
    }
  }
  
  console.log("\n✅ Wallet funding complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
