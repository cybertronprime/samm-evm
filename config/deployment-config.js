const { ethers } = require("ethers");
const chainConfigs = require("./chains.json");

/**
 * Get chain configuration by network name
 * @param {string} networkName - The network name (sepolia, monad, risechain)
 * @returns {object} Chain configuration
 */
function getChainConfig(networkName) {
  const config = chainConfigs[networkName];
  if (!config) {
    throw new Error(`Unsupported network: ${networkName}`);
  }
  return config;
}

/**
 * Validate deployment environment variables
 * @param {string} networkName - The network name
 * @returns {object} Validated environment configuration
 */
function validateEnvironment(networkName) {
  const config = getChainConfig(networkName);
  
  // Check for required environment variables
  const requiredEnvVars = {
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    [`${networkName.toUpperCase()}_RPC_URL`]: process.env[`${networkName.toUpperCase()}_RPC_URL`]
  };

  const missing = Object.entries(requiredEnvVars)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    privateKey: process.env.PRIVATE_KEY,
    rpcUrl: process.env[`${networkName.toUpperCase()}_RPC_URL`] || config.rpcUrl,
    etherscanApiKey: process.env.ETHERSCAN_API_KEY
  };
}

/**
 * Calculate estimated gas costs for deployment
 * @param {object} provider - Ethers provider
 * @param {string} networkName - The network name
 * @returns {object} Gas cost estimates
 */
async function estimateDeploymentCosts(provider, networkName) {
  const config = getChainConfig(networkName);
  
  try {
    // Get current gas price
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits("20", "gwei");
    
    // Estimated gas usage for SAMM deployment
    const estimatedGasUsage = {
      mockTokens: BigInt("2000000"), // 2M gas for 2 mock tokens
      sammFactory: BigInt("3000000"), // 3M gas for factory
      sammPool: BigInt("2500000"), // 2.5M gas for pool creation
      initialization: BigInt("500000"), // 500K gas for initialization
      buffer: BigInt("1000000") // 1M gas buffer
    };

    const totalGasEstimate = Object.values(estimatedGasUsage)
      .reduce((sum, gas) => sum + gas, BigInt("0"));

    const totalCostWei = totalGasEstimate * gasPrice;
    const totalCostEth = ethers.formatEther(totalCostWei);
    const minBalanceRequired = ethers.parseEther(config.deploymentConfig.minBalance);

    return {
      gasPrice: ethers.formatUnits(gasPrice, "gwei"),
      estimatedGasUsage,
      totalGasEstimate,
      totalCostWei,
      totalCostEth,
      minBalanceRequired,
      minBalanceRequiredEth: config.deploymentConfig.minBalance,
      nativeTokenSymbol: config.nativeToken.symbol
    };
  } catch (error) {
    console.warn(`Warning: Could not estimate gas costs for ${networkName}:`, error.message);
    return {
      gasPrice: "unknown",
      totalCostEth: "unknown",
      minBalanceRequiredEth: config.deploymentConfig.minBalance,
      nativeTokenSymbol: config.nativeToken.symbol
    };
  }
}

/**
 * Validate deployer balance
 * @param {object} provider - Ethers provider
 * @param {string} deployerAddress - Deployer wallet address
 * @param {string} networkName - The network name
 * @returns {object} Balance validation result
 */
async function validateDeployerBalance(provider, deployerAddress, networkName) {
  const config = getChainConfig(networkName);
  const costs = await estimateDeploymentCosts(provider, networkName);
  
  try {
    const balance = await provider.getBalance(deployerAddress);
    const balanceEth = ethers.formatEther(balance);
    const minRequired = ethers.parseEther(config.deploymentConfig.minBalance);
    
    const isValid = balance >= minRequired;
    const shortfall = isValid ? BigInt("0") : minRequired - balance;
    
    return {
      isValid,
      balance,
      balanceEth,
      minRequired,
      minRequiredEth: config.deploymentConfig.minBalance,
      shortfall,
      shortfallEth: ethers.formatEther(shortfall),
      nativeTokenSymbol: config.nativeToken.symbol,
      estimatedCosts: costs
    };
  } catch (error) {
    throw new Error(`Failed to check balance for ${networkName}: ${error.message}`);
  }
}

/**
 * Get deployment parameters for a specific network
 * @param {string} networkName - The network name
 * @returns {object} Deployment parameters
 */
function getDeploymentParams(networkName) {
  const config = getChainConfig(networkName);
  
  return {
    sammParameters: config.sammParameters,
    gasSettings: config.gasSettings,
    confirmations: config.deploymentConfig.confirmations,
    timeout: config.deploymentConfig.timeout,
    blockExplorer: config.blockExplorer
  };
}

/**
 * Create provider for a specific network
 * @param {string} networkName - The network name
 * @returns {object} Ethers provider and wallet
 */
function createProvider(networkName) {
  const env = validateEnvironment(networkName);
  const config = getChainConfig(networkName);
  
  const provider = new ethers.JsonRpcProvider(env.rpcUrl);
  const wallet = new ethers.Wallet(env.privateKey, provider);
  
  return { provider, wallet, config };
}

module.exports = {
  getChainConfig,
  validateEnvironment,
  estimateDeploymentCosts,
  validateDeployerBalance,
  getDeploymentParams,
  createProvider,
  chainConfigs
};