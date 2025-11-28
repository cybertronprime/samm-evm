/**
 * Send RiseChain Testnet Tokens for Property Tests
 * Connects to RiseChain testnet and sends tokens from deployed contracts
 */

const { ethers } = require('hardhat');
require('dotenv').config();

// Configuration
const TARGET_ADDRESS = '0x0fb795cfc581666932abafe438bd3ce6702da69c';
const AMOUNT_TO_SEND = ethers.parseUnits('1000', 6); // 1000 tokens (6 decimals for USDC/USDT)
const DAI_AMOUNT_TO_SEND = ethers.parseEther('1000'); // 1000 DAI (18 decimals)

async function main() {
  console.log('🚀 Sending RiseChain testnet tokens for property tests...');
  console.log(`Target address: ${TARGET_ADDRESS}`);
  
  try {
    // Connect to RiseChain testnet
    const provider = new ethers.JsonRpcProvider(process.env.RISECHAIN_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    console.log(`Deployer address: ${wallet.address}`);
    
    // Check network
    const network = await provider.getNetwork();
    console.log(`Connected to chain ID: ${network.chainId}`);
    
    if (Number(network.chainId) !== 11155931) {
      throw new Error(`Expected RiseChain testnet (11155931), got ${network.chainId}`);
    }
    
    // Check deployer balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`Deployer ETH balance: ${ethers.formatEther(balance)}`);
    
    if (balance < ethers.parseEther('0.1')) {
      console.log('⚠️  Low ETH balance. You may need more ETH for gas fees.');
    }

    // Load deployment data
    const deploymentData = require('../deployment-data/risechain-multi-shard-1764273559148.json');
    
    console.log('\n📤 Sending tokens from RiseChain deployment...');
    
    // Get token contracts
    const tokens = [];
    for (const tokenInfo of deploymentData.contracts.tokens) {
      console.log(`\n🔍 Processing ${tokenInfo.symbol} at ${tokenInfo.address}:`);
      
      try {
        // Check if contract exists on RiseChain
        const code = await provider.getCode(tokenInfo.address);
        if (code === '0x') {
          console.log(`  ❌ Contract not found on RiseChain testnet`);
          continue;
        }
        
        // Try to connect to the token contract
        const tokenContract = new ethers.Contract(
          tokenInfo.address,
          [
            'function name() view returns (string)',
            'function symbol() view returns (string)',
            'function decimals() view returns (uint8)',
            'function totalSupply() view returns (uint256)',
            'function balanceOf(address) view returns (uint256)',
            'function transfer(address to, uint256 amount) returns (bool)',
            'function mint(address to, uint256 amount) returns (bool)'
          ],
          wallet
        );
        
        // Get token info
        const name = await tokenContract.name();
        const symbol = await tokenContract.symbol();
        const decimals = await tokenContract.decimals();
        const totalSupply = await tokenContract.totalSupply();
        
        console.log(`  ✅ Token found: ${name} (${symbol})`);
        console.log(`    Decimals: ${decimals}`);
        console.log(`    Total Supply: ${ethers.formatUnits(totalSupply, decimals)}`);
        
        // Check deployer balance
        const deployerBalance = await tokenContract.balanceOf(wallet.address);
        console.log(`    Deployer balance: ${ethers.formatUnits(deployerBalance, decimals)}`);
        
        tokens.push({
          symbol: tokenInfo.symbol,
          address: tokenInfo.address,
          contract: tokenContract,
          decimals: Number(decimals),
          deployerBalance
        });
        
      } catch (error) {
        console.log(`  ❌ Error accessing ${tokenInfo.symbol}: ${error.message}`);
      }
    }

    if (tokens.length === 0) {
      throw new Error('No accessible tokens found on RiseChain testnet');
    }

    // Send tokens to target address
    console.log('\n📤 Transferring tokens...');
    
    for (const token of tokens) {
      try {
        console.log(`\n💰 Sending ${token.symbol}...`);
        
        // Determine amount to send based on decimals
        const amountToSend = token.decimals === 18 ? DAI_AMOUNT_TO_SEND : AMOUNT_TO_SEND;
        
        // Check if deployer has enough tokens
        if (token.deployerBalance < amountToSend) {
          console.log(`  ⚠️  Insufficient balance. Has ${ethers.formatUnits(token.deployerBalance, token.decimals)}, need ${ethers.formatUnits(amountToSend, token.decimals)}`);
          
          // Try to mint more tokens
          console.log(`  🔨 Attempting to mint tokens...`);
          try {
            const mintTx = await token.contract.mint(wallet.address, amountToSend * 2n);
            await mintTx.wait();
            console.log(`  ✅ Minted additional ${token.symbol} tokens`);
          } catch (mintError) {
            console.log(`  ❌ Could not mint tokens: ${mintError.message}`);
            console.log(`  📤 Sending available balance instead...`);
            // Send whatever balance is available (but leave some for gas)
            const availableToSend = token.deployerBalance > ethers.parseUnits('1', token.decimals) 
              ? token.deployerBalance - ethers.parseUnits('1', token.decimals)
              : token.deployerBalance / 2n;
            
            if (availableToSend > 0) {
              const transferTx = await token.contract.transfer(TARGET_ADDRESS, availableToSend);
              await transferTx.wait();
              console.log(`  ✅ Sent ${ethers.formatUnits(availableToSend, token.decimals)} ${token.symbol}`);
            }
            continue;
          }
        }
        
        // Transfer tokens
        console.log(`  📤 Transferring ${ethers.formatUnits(amountToSend, token.decimals)} ${token.symbol}...`);
        
        const transferTx = await token.contract.transfer(TARGET_ADDRESS, amountToSend);
        const receipt = await transferTx.wait();
        
        console.log(`  ✅ Transfer successful! Tx: ${receipt.hash}`);
        
        // Verify transfer
        const targetBalance = await token.contract.balanceOf(TARGET_ADDRESS);
        console.log(`  📊 Target ${token.symbol} balance: ${ethers.formatUnits(targetBalance, token.decimals)}`);
        
      } catch (error) {
        console.log(`  ❌ Failed to send ${token.symbol}: ${error.message}`);
      }
    }

    // Send LP tokens from pools
    console.log('\n🏊 Sending LP tokens from SAMM pools...');
    
    for (const shard of deploymentData.contracts.shards) {
      try {
        console.log(`\n💧 Processing ${shard.name}...`);
        
        // Check if pool contract exists
        const code = await provider.getCode(shard.address);
        if (code === '0x') {
          console.log(`  ❌ Pool contract not found on RiseChain testnet`);
          continue;
        }
        
        // Connect to SAMM pool contract
        const poolContract = new ethers.Contract(
          shard.address,
          [
            'function balanceOf(address) view returns (uint256)',
            'function transfer(address to, uint256 amount) returns (bool)',
            'function totalSupply() view returns (uint256)',
            'function name() view returns (string)',
            'function symbol() view returns (string)'
          ],
          wallet
        );
        
        // Get pool info
        const totalSupply = await poolContract.totalSupply();
        const deployerLPBalance = await poolContract.balanceOf(wallet.address);
        
        console.log(`  📊 Total LP supply: ${ethers.formatEther(totalSupply)}`);
        console.log(`  💰 Deployer LP balance: ${ethers.formatEther(deployerLPBalance)}`);
        
        if (deployerLPBalance > 0) {
          // Send half of LP tokens to target address
          const amountToSend = deployerLPBalance / 2n;
          
          console.log(`  📤 Sending ${ethers.formatEther(amountToSend)} LP tokens...`);
          
          const transferTx = await poolContract.transfer(TARGET_ADDRESS, amountToSend);
          const receipt = await transferTx.wait();
          
          console.log(`  ✅ LP transfer successful! Tx: ${receipt.hash}`);
          
          // Verify transfer
          const targetLPBalance = await poolContract.balanceOf(TARGET_ADDRESS);
          console.log(`  📊 Target LP balance: ${ethers.formatEther(targetLPBalance)}`);
        } else {
          console.log(`  ⚠️  No LP tokens available to send`);
        }
        
      } catch (error) {
        console.log(`  ❌ Failed to process ${shard.name}: ${error.message}`);
      }
    }

    // Send some ETH for gas
    console.log('\n💰 Sending ETH for gas...');
    try {
      const ethAmount = ethers.parseEther('0.1'); // 0.1 ETH should be enough for testing
      const ethTx = await wallet.sendTransaction({
        to: TARGET_ADDRESS,
        value: ethAmount
      });
      const receipt = await ethTx.wait();
      
      console.log(`✅ ETH sent successfully! Tx: ${receipt.hash}`);
      
      const targetEthBalance = await provider.getBalance(TARGET_ADDRESS);
      console.log(`📊 Target ETH balance: ${ethers.formatEther(targetEthBalance)}`);
      
    } catch (error) {
      console.log(`❌ Failed to send ETH: ${error.message}`);
    }

    // Final summary
    console.log('\n📊 Final balances for', TARGET_ADDRESS);
    console.log('='.repeat(50));
    
    const ethBalance = await provider.getBalance(TARGET_ADDRESS);
    console.log(`ETH: ${ethers.formatEther(ethBalance)}`);
    
    for (const token of tokens) {
      try {
        const balance = await token.contract.balanceOf(TARGET_ADDRESS);
        console.log(`${token.symbol}: ${ethers.formatUnits(balance, token.decimals)}`);
      } catch (error) {
        console.log(`${token.symbol}: Error reading balance`);
      }
    }
    
    console.log('\nLP Tokens:');
    for (const shard of deploymentData.contracts.shards) {
      try {
        const poolContract = new ethers.Contract(
          shard.address,
          ['function balanceOf(address) view returns (uint256)'],
          provider
        );
        const balance = await poolContract.balanceOf(TARGET_ADDRESS);
        console.log(`${shard.name}: ${ethers.formatEther(balance)}`);
      } catch (error) {
        console.log(`${shard.name}: Error reading balance`);
      }
    }
    
    console.log('\n✅ RiseChain testnet tokens sent successfully!');
    console.log('🧪 Ready for cross-pool router property tests');

  } catch (error) {
    console.error('❌ Error sending RiseChain tokens:', error);
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