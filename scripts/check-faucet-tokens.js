/**
 * Check what tokens are configured in the TokenFaucet contract
 */

const { ethers } = require("ethers");

const TOKEN_FAUCET_ADDRESS = "0x1758716f8ccb77B514d801eF00C690F6F5CFce84";
const RPC_URL = "https://testnet.riselabs.xyz";

const FAUCET_ABI = [
  {
    inputs: [],
    name: 'getAllTokens',
    outputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenAddress', type: 'address' },
          { internalType: 'string', name: 'symbol', type: 'string' },
          { internalType: 'uint256', name: 'amountPerRequest', type: 'uint256' },
          { internalType: 'uint8', name: 'decimals', type: 'uint8' },
        ],
        internalType: 'struct TokenFaucet.TokenInfo[]',
        name: '',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

async function main() {
  console.log("🔍 Checking TokenFaucet Configuration\n");
  console.log(`Faucet Address: ${TOKEN_FAUCET_ADDRESS}\n`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const faucet = new ethers.Contract(TOKEN_FAUCET_ADDRESS, FAUCET_ABI, provider);

  try {
    const tokens = await faucet.getAllTokens();

    console.log("📋 Tokens configured in faucet:\n");
    console.log("=".repeat(80));

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const amount = ethers.formatUnits(token.amountPerRequest, token.decimals);

      console.log(`${i + 1}. ${token.symbol}`);
      console.log(`   Address: ${token.tokenAddress}`);
      console.log(`   Amount:  ${amount} ${token.symbol}`);
      console.log(`   Decimals: ${token.decimals}`);
      console.log("");
    }

    console.log("=".repeat(80));
    console.log(`\n✅ Total tokens: ${tokens.length}`);

  } catch (error) {
    console.error("❌ Error querying faucet:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
