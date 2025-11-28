/**
 * Send Test Tokens for Property Tests
 * Sends tokens to specified address for cross-pool router property testing
 */

const { ethers } = require('hardhat');
require('dotenv').config();

// Configuration
const TARGET_ADDRESS = '0x0fb795cfc581666932abafe438bd3ce6702da69c';
const AMOUNT_TO_SEND = ethers.parseEther('1000'); // 1000 tokens each

async function main() {
  console.log('🚀 Sending test tokens for property tests...');
  console.log(`Target address: ${TARGET_ADDRESS}`);
  
  try {
    // Get signer
    const [deployer] = await ethers.getSigners();
    console.log(`Deployer address: ${deployer.address}`);
    console.log(`Deployer balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

    // Load deployment data
    const deploymentData = require('../deployment-data/risechain-multi-shard-1764273559148.json');
    
    // Get token contracts
    const tokens = [];
    for (const tokenInfo of deploymentData.contracts.tokens) {
      try {
        const tokenContract = await ethers.getContractAt('MockERC20', tokenInfo.address);
        tokens.push({
          symbol: tokenInfo.symbol,
          address: tokenInfo.address,
          contract: tokenContract
        });
        console.log(`✅ Loaded ${tokenInfo.symbol} token at ${tokenInfo.address}`);
      } catch (error) {
        console.log(`❌ Failed to load ${tokenInfo.symbol} token: ${error.message}`);
      }
    }

    if (tokens.length === 0) {
      console.log('❌ No tokens loaded. Deploying mock tokens for testing...');
      
      // Deploy mock tokens for testing
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      
      const mockUSDC = await MockERC20.deploy('USD Coin', 'USDC', 6);
      await mockUSDC.waitForDeployment();
      
      const mockUSDT = await MockERC20.deploy('Tether USD', 'USDT', 6);
      await mockUSDT.waitForDeployment();
      
      const mockDAI = await MockERC20.deploy('Dai Stablecoin', 'DAI', 18);
      await mockDAI.waitForDeployment();
      
      tokens.push(
        { symbol: 'USDC', address: await mockUSDC.getAddress(), contract: mockUSDC },
        { symbol: 'USDT', address: await mockUSDT.getAddress(), contract: mockUSDT },
        { symbol: 'DAI', address: await mockDAI.getAddress(), contract: mockDAI }
      );
      
      console.log('✅ Mock tokens deployed for testing');
    }

    // Send tokens to target address
    console.log('\n📤 Sending tokens...');
    
    for (const token of tokens) {
      try {
        // Check if deployer has tokens to send
        const deployerBalance = await token.contract.balanceOf(deployer.address);
        console.log(`Deployer ${token.symbol} balance: ${ethers.formatUnits(deployerBalance, await token.contract.decimals())}`);
        
        if (deployerBalance < AMOUNT_TO_SEND) {
          // Mint tokens if deployer doesn't have enough
          console.log(`Minting ${token.symbol} tokens for deployer...`);
          try {
            const mintTx = await token.contract.mint(deployer.address, AMOUNT_TO_SEND * 10n);
            await mintTx.wait();
            console.log(`✅ Minted ${token.symbol} tokens`);
          } catch (mintError) {
            console.log(`⚠️  Could not mint ${token.symbol} tokens: ${mintError.message}`);
            continue;
          }
        }
        
        // Transfer tokens to target address
        const decimals = await token.contract.decimals();
        const amountToSend = ethers.parseUnits('1000', decimals);
        
        console.log(`Sending ${ethers.formatUnits(amountToSend, decimals)} ${token.symbol} to ${TARGET_ADDRESS}...`);
        
        const transferTx = await token.contract.transfer(TARGET_ADDRESS, amountToSend);
        await transferTx.wait();
        
        // Verify transfer
        const targetBalance = await token.contract.balanceOf(TARGET_ADDRESS);
        console.log(`✅ ${token.symbol} sent successfully. Target balance: ${ethers.formatUnits(targetBalance, decimals)}`);
        
      } catch (error) {
        console.log(`❌ Failed to send ${token.symbol}: ${error.message}`);
      }
    }

    // Send some ETH for gas
    console.log('\n💰 Sending ETH for gas...');
    try {
      const ethAmount = ethers.parseEther('1.0'); // 1 ETH
      const ethTx = await deployer.sendTransaction({
        to: TARGET_ADDRESS,
        value: ethAmount
      });
      await ethTx.wait();
      
      const targetEthBalance = await ethers.provider.getBalance(TARGET_ADDRESS);
      console.log(`✅ ETH sent successfully. Target ETH balance: ${ethers.formatEther(targetEthBalance)}`);
      
    } catch (error) {
      console.log(`❌ Failed to send ETH: ${error.message}`);
    }

    // Summary
    console.log('\n📊 Final balances for', TARGET_ADDRESS);
    console.log('='.repeat(50));
    
    const ethBalance = await ethers.provider.getBalance(TARGET_ADDRESS);
    console.log(`ETH: ${ethers.formatEther(ethBalance)}`);
    
    for (const token of tokens) {
      try {
        const balance = await token.contract.balanceOf(TARGET_ADDRESS);
        const decimals = await token.contract.decimals();
        console.log(`${token.symbol}: ${ethers.formatUnits(balance, decimals)}`);
      } catch (error) {
        console.log(`${token.symbol}: Error reading balance`);
      }
    }
    
    console.log('\n✅ Test tokens sent successfully!');
    console.log('🧪 Ready for property tests');

  } catch (error) {
    console.error('❌ Error sending test tokens:', error);
    process.exit(1);
  }
}

// Handle script execution
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { main };