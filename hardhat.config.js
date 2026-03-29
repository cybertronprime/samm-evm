require("@nomicfoundation/hardhat-toolbox");
require("dotenv/config");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://sepolia.infura.io/v3/YOUR_INFURA_KEY",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 11155111,
      gasPrice: "auto",
    },
    monad: {
      url: process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 41455, // Monad testnet chain ID
      gasPrice: "auto",
      timeout: 60000,
    },
    risechain: {
      url: process.env.RISECHAIN_RPC_URL || "https://testnet.riselabs.xyz",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 11155931, // RISE testnet chain ID
      gasPrice: "auto",
      timeout: 60000,
    },
    // Arc Testnet — EVM-compatible, USDC is native gas token
    // Note: Chainlink contracts (@chainlink/contracts ^1.3.0 or later) are required for integrations
    arc: {
      url: process.env.ARC_RPC_URL || "https://testnet-rpc.arc.network",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      // Arc testnet chain ID — set ARC_CHAIN_ID env var once officially published
      chainId: process.env.ARC_CHAIN_ID ? parseInt(process.env.ARC_CHAIN_ID, 10) : 32659,
      gasPrice: "auto",
      timeout: 60000,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
};
