const { ethers } = require("ethers");
require("dotenv").config();

// February 10, 2026 deployment - CORRECT token addresses
const TOKENS = {
  WETH: {
    address: "0x0ec0b10b40832cD9805481F132f966B156d70Cc7",
    symbol: "WETH",
    decimals: 18,
    amount: "10" // 10 WETH
  },
  WBTC: {
    address: "0xEf6c9F206Ad4333Ca049C874ae6956f849e71479",
    symbol: "WBTC",
    decimals: 8,
    amount: "1" // 1 WBTC
  },
  USDC: {
    address: "0xDA4aABea512d4030863652dbB21907B6eC97ad23",
    symbol: "USDC",
    decimals: 6,
    amount: "50000" // 50,000 USDC
  },
  USDT: {
    address: "0x89D668205724fbFBaAe1BDF32F0aA046f6bdD7Cd",
    symbol: "USDT",
    decimals: 6,
    amount: "50000" // 50,000 USDT
  },
  DAI: {
    address: "0x9DcC3d09865292A2D5c39e08EEa583dd29390522",
    symbol: "DAI",
    decimals: 18,
    amount: "50000" // 50,000 DAI
  },
  LINK: {
    address: "0xD4Afa6b83888aABbe74b288b4241F39Ad8A8e0bA",
    symbol: "LINK",
    decimals: 18,
    amount: "1000" // 1,000 LINK
  },
  UNI: {
    address: "0xEebe649Cef7ed5b1fD4BE3222bA94f316eBdbE6c",
    symbol: "UNI",
    decimals: 18,
    amount: "1000" // 1,000 UNI
  },
  AAVE: {
    address: "0x92EfA27dBb61069d4f65a656E1e9781509982ba7",
    symbol: "AAVE",
    decimals: 18,
    amount: "100" // 100 AAVE
  }
};

const TOKEN_ABI = [
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address account) external view returns (uint256)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
];

async function main() {
  const recipientAddress = process.env.RECIPIENT_ADDRESS || "0x1eAbDF939a62E878DCb70544FD6bec51C58F99Ad";
  const rpcUrl = process.env.RISECHAIN_RPC_URL || "https://testnet.riselabs.xyz";
  const privateKey = process.env.PRIVATE_KEY;
  
  if (!privateKey) {
    console.error("\n❌ Error: PRIVATE_KEY not found in environment");
    console.error("   Set it with: export PRIVATE_KEY=your_private_key");
    process.exit(1);
  }
  
  console.log("\n🪙 Minting Tokens - February 10, 2026 Deployment");
  console.log("=".repeat(70));
  
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  
  console.log(`Deployer Wallet: ${wallet.address}`);
  console.log(`Recipient: ${recipientAddress}`);
  console.log(`RPC: ${rpcUrl}\n`);
  
  let successCount = 0;
  let failCount = 0;
  const results = [];
  
  for (const [tokenName, tokenData] of Object.entries(TOKENS)) {
    console.log(`\n💰 Minting ${tokenData.amount} ${tokenData.symbol}...`);
    console.log(`   Address: ${tokenData.address}`);
    
    try {
      const tokenContract = new ethers.Contract(tokenData.address, TOKEN_ABI, wallet);
      const amount = ethers.parseUnits(tokenData.amount, tokenData.decimals);
      
      // Check balance before
      const balanceBefore = await tokenContract.balanceOf(recipientAddress);
      const formattedBefore = ethers.formatUnits(balanceBefore, tokenData.decimals);
      console.log(`   Balance before: ${formattedBefore} ${tokenData.symbol}`);
      
      // Mint tokens
      const tx = await tokenContract.mint(recipientAddress, amount);
      console.log(`   📝 Transaction: ${tx.hash}`);
      console.log(`   ⏳ Waiting for confirmation...`);
      
      const receipt = await tx.wait();
      console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
      console.log(`   ⛽ Gas used: ${receipt.gasUsed.toString()}`);
      
      // Check balance after
      const balanceAfter = await tokenContract.balanceOf(recipientAddress);
      const formattedAfter = ethers.formatUnits(balanceAfter, tokenData.decimals);
      console.log(`   💼 Balance after: ${formattedAfter} ${tokenData.symbol}`);
      
      successCount++;
      results.push({
        token: tokenData.symbol,
        success: true,
        balance: formattedAfter,
        tx: tx.hash
      });
      
    } catch (error) {
      failCount++;
      console.log(`   ❌ Failed: ${error.message.split('\n')[0]}`);
      results.push({
        token: tokenData.symbol,
        success: false,
        error: error.message.split('\n')[0]
      });
    }
  }
  
  console.log("\n" + "=".repeat(70));
  console.log(`\n✨ Minting Complete!`);
  console.log(`   ✅ Success: ${successCount} tokens`);
  console.log(`   ❌ Failed: ${failCount} tokens\n`);
  
  if (successCount > 0) {
    console.log("📊 Final Balances:");
    results.filter(r => r.success).forEach(r => {
      console.log(`   ${r.token}: ${r.balance}`);
    });
  }
  
  if (failCount > 0) {
    console.log("\n⚠️  Failed Tokens:");
    results.filter(r => !r.success).forEach(r => {
      console.log(`   ${r.token}: ${r.error}`);
    });
  }
  
  console.log(`\n🔍 View on Explorer:`);
  console.log(`   https://testnet.risescan.com/address/${recipientAddress}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  });
