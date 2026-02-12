/**
 * Use Token Faucet to Get Test Tokens
 * 
 * This script calls the TokenFaucet contract to request test tokens.
 * The faucet distributes tokens to the caller's address.
 * 
 * Usage: node scripts/use-token-faucet.js
 */

const { ethers } = require("ethers");

// Configuration
const USER_PRIVATE_KEY = "2571a342f4f03a8f341e14854624a242d85e7538dc47063382c883e59dfc3363";
const TOKEN_FAUCET_ADDRESS = "0x983A8fe1408bBba8a1EF02641E5ECD05b9a4BA1c";

// TokenFaucet ABI
const TOKEN_FAUCET_ABI = [
  {
    inputs: [],
    name: 'requestTokens',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'canRequest',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'timeUntilNextRequest',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getAllTokens',
    outputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenAddress', type: 'address' },
          { internalType: 'string', name: 'symbol', type: 'string' },
          { internalType: 'uint256', name: 'amount', type: 'uint256' },
          { internalType: 'bool', name: 'isActive', type: 'bool' },
        ],
        internalType: 'struct TokenFaucet.TokenInfo[]',
        name: '',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'cooldownPeriod',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// ERC20 ABI for checking balances
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

async function main() {
  console.log("🚰 Using Token Faucet to Request Test Tokens\n");

  // Connect to RiseChain Testnet
  const provider = new ethers.JsonRpcProvider("https://testnet.riselabs.xyz");
  const user = new ethers.Wallet(USER_PRIVATE_KEY, provider);
  
  console.log(`User Address: ${user.address}`);
  const userBalance = await provider.getBalance(user.address);
  console.log(`User ETH Balance: ${ethers.formatEther(userBalance)} ETH\n`);

  // Connect to TokenFaucet
  const faucet = new ethers.Contract(TOKEN_FAUCET_ADDRESS, TOKEN_FAUCET_ABI, user);

  // Check if user can request tokens
  console.log("📋 Checking faucet eligibility...");
  const canRequest = await faucet.canRequest(user.address);
  
  if (!canRequest) {
    const timeUntilNext = await faucet.timeUntilNextRequest(user.address);
    console.log(`❌ Cannot request tokens yet. Wait ${timeUntilNext} seconds.\n`);
    
    // Show current balances anyway
    await showBalances(provider, user.address);
    return;
  }

  console.log("✅ Eligible to request tokens!\n");

  // Get available tokens from faucet
  console.log("📋 Available tokens from faucet:");
  const tokens = await faucet.getAllTokens();
  for (const token of tokens) {
    if (token.isActive) {
      const decimals = token.symbol === 'WBTC' ? 8 : (token.symbol.includes('USD') ? 6 : 18);
      console.log(`   ${token.symbol}: ${ethers.formatUnits(token.amount, decimals)}`);
    }
  }
  console.log("");

  // Get cooldown period
  const cooldown = await faucet.cooldownPeriod();
  console.log(`⏱️  Cooldown Period: ${cooldown} seconds (${Number(cooldown) / 3600} hours)\n`);

  // Request tokens
  console.log("📤 Requesting tokens from faucet...");
  try {
    const tx = await faucet.requestTokens({
      gasLimit: 500000
    });
    
    console.log(`   TX Hash: ${tx.hash}`);
    console.log("   Waiting for confirmation...");
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log("   ✅ Tokens received successfully!\n");
    } else {
      console.log("   ❌ Transaction failed\n");
      return;
    }
  } catch (error) {
    console.error(`   ❌ Failed to request tokens: ${error.message}\n`);
    
    // Check if it's a cooldown error
    if (error.message.includes("Cooldown")) {
      const timeUntilNext = await faucet.timeUntilNextRequest(user.address);
      console.log(`   ⏱️  You need to wait ${timeUntilNext} seconds before requesting again.\n`);
    }
    return;
  }

  // Show final balances
  await showBalances(provider, user.address);
}

async function showBalances(provider, userAddress) {
  console.log("📊 Current Token Balances:");
  console.log("================================");
  
  const userEthBalance = await provider.getBalance(userAddress);
  console.log(`ETH: ${ethers.formatEther(userEthBalance)}`);
  
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
  
  for (const [symbol, address] of Object.entries(TOKEN_ADDRESSES)) {
    try {
      const token = new ethers.Contract(address, ERC20_ABI, provider);
      const balance = await token.balanceOf(userAddress);
      const decimals = await token.decimals();
      console.log(`${symbol}: ${ethers.formatUnits(balance, decimals)}`);
    } catch (error) {
      console.log(`${symbol}: Error reading balance`);
    }
  }
  
  console.log("\n✅ Done!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
