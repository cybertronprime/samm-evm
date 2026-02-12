/**
 * Check wallet balances and mint tokens for February 10, 2026 deployment
 * This deployment matches the frontend configuration
 */

const { ethers } = require("ethers");

// Configuration
const USER_WALLET = "0x1eAbDF939a62E878DCb70544FD6bec51C58F99Ad";
const DEPLOYER_PRIVATE_KEY = "2571a342f4f03a8f341e14854624a242d85e7538dc47063382c883e59dfc3363";
const RPC_URL = "https://testnet.riselabs.xyz";

// Token addresses from February 10, 2026 deployment
const TOKENS = {
  WETH: {
    address: "0x0ec0b10b40832cD9805481F132f966B156d70Cc7",
    decimals: 18,
    mintAmount: "10" // 10 WETH
  },
  WBTC: {
    address: "0xEf6c9F206Ad4333Ca049C874ae6956f849e71479",
    decimals: 8,
    mintAmount: "1" // 1 WBTC
  },
  USDC: {
    address: "0xDA4aABea512d4030863652dbB21907B6eC97ad23",
    decimals: 6,
    mintAmount: "10000" // 10,000 USDC
  },
  USDT: {
    address: "0x89D668205724fbFBaAe1BDF32F0aA046f6bdD7Cd",
    decimals: 6,
    mintAmount: "10000" // 10,000 USDT
  },
  DAI: {
    address: "0x9DcC3d09865292A2D5c39e08EEa583dd29390522",
    decimals: 18,
    mintAmount: "10000" // 10,000 DAI
  },
  LINK: {
    address: "0xD4Afa6b83888aABbe74b288b4241F39Ad8A8e0bA",
    decimals: 18,
    mintAmount: "500" // 500 LINK
  },
  UNI: {
    address: "0xEebe649Cef7ed5b1fD4BE3222bA94f316eBdbE6c",
    decimals: 18,
    mintAmount: "1000" // 1,000 UNI
  },
  AAVE: {
    address: "0x92EfA27dBb61069d4f65a656E1e9781509982ba7",
    decimals: 18,
    mintAmount: "50" // 50 AAVE
  }
};

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function mint(address to, uint256 amount) external"
];

async function main() {
  console.log("\n💰 Checking and Minting Tokens (February 10, 2026 Deployment)");
  console.log("=".repeat(70));
  console.log(`User Wallet: ${USER_WALLET}`);
  console.log("=".repeat(70));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);

  console.log(`\nUsing wallet: ${wallet.address}`);
  
  // Check ETH balance
  const ethBalance = await provider.getBalance(USER_WALLET);
  console.log(`\n💎 Native ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);

  // Check current balances
  console.log("\n📊 Current Token Balances:");
  console.log("-".repeat(70));
  
  for (const [symbol, config] of Object.entries(TOKENS)) {
    try {
      const token = new ethers.Contract(config.address, ERC20_ABI, provider);
      const balance = await token.balanceOf(USER_WALLET);
      const formatted = ethers.formatUnits(balance, config.decimals);
      console.log(`${symbol.padEnd(6)}: ${formatted.padStart(20)} (${config.address})`);
    } catch (error) {
      console.log(`${symbol.padEnd(6)}: Error reading balance`);
    }
  }

  // Mint tokens
  console.log("\n💸 Minting Tokens...");
  console.log("-".repeat(70));

  let successCount = 0;
  let failCount = 0;

  for (const [symbol, config] of Object.entries(TOKENS)) {
    try {
      const token = new ethers.Contract(config.address, ERC20_ABI, wallet);
      const amount = ethers.parseUnits(config.mintAmount, config.decimals);

      console.log(`\n${symbol}:`);
      console.log(`  Minting ${config.mintAmount} ${symbol}...`);

      const tx = await token.mint(USER_WALLET, amount, { gasLimit: 100000 });
      console.log(`  TX: ${tx.hash}`);
      
      await tx.wait();
      console.log(`  ✅ Success!`);

      // Check new balance
      const newBalance = await token.balanceOf(USER_WALLET);
      const formatted = ethers.formatUnits(newBalance, config.decimals);
      console.log(`  New Balance: ${formatted} ${symbol}`);

      successCount++;
    } catch (error) {
      console.log(`  ❌ Failed: ${error.message.split('\n')[0]}`);
      failCount++;
    }
  }

  // Final summary
  console.log("\n" + "=".repeat(70));
  console.log("📊 Final Token Balances:");
  console.log("-".repeat(70));

  const finalEthBalance = await provider.getBalance(USER_WALLET);
  console.log(`ETH: ${ethers.formatEther(finalEthBalance)}`);

  for (const [symbol, config] of Object.entries(TOKENS)) {
    try {
      const token = new ethers.Contract(config.address, ERC20_ABI, provider);
      const balance = await token.balanceOf(USER_WALLET);
      const formatted = ethers.formatUnits(balance, config.decimals);
      console.log(`${symbol}: ${formatted}`);
    } catch (error) {
      console.log(`${symbol}: Error reading balance`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`✅ Success: ${successCount} tokens`);
  console.log(`❌ Failed: ${failCount} tokens`);
  console.log("\n🔍 View on explorer:");
  console.log(`   https://testnet.risescan.com/address/${USER_WALLET}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  });
