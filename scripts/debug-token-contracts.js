/**
 * Debug Token Contracts
 * Investigate why token transfers are failing
 */

const { ethers } = require('hardhat');
require('dotenv').config();

async function main() {
  console.log('🔍 Debugging token contracts...');
  
  try {
    const [deployer] = await ethers.getSigners();
    console.log(`Deployer: ${deployer.address}`);
    
    // Load deployment data
    const deploymentData = require('../deployment-data/risechain-multi-shard-1764273559148.json');
    
    console.log('\n📋 Checking token contracts from deployment data:');
    
    for (const tokenInfo of deploymentData.contracts.tokens) {
      console.log(`\n🔍 Checking ${tokenInfo.symbol} at ${tokenInfo.address}:`);
      
      try {
        // Check if contract exists
        const code = await ethers.provider.getCode(tokenInfo.address);
        console.log(`  Contract code length: ${code.length}`);
        
        if (code === '0x') {
          console.log(`  ❌ No contract deployed at this address!`);
          continue;
        }
        
        // Try different contract interfaces
        console.log(`  ✅ Contract exists, trying interfaces...`);
        
        // Try MockERC20 interface
        try {
          const mockToken = await ethers.getContractAt('MockERC20', tokenInfo.address);
          const name = await mockToken.name();
          const symbol = await mockToken.symbol();
          const decimals = await mockToken.decimals();
          const totalSupply = await mockToken.totalSupply();
          
          console.log(`  ✅ MockERC20 interface works:`);
          console.log(`    Name: ${name}`);
          console.log(`    Symbol: ${symbol}`);
          console.log(`    Decimals: ${decimals}`);
          console.log(`    Total Supply: ${ethers.formatUnits(totalSupply, decimals)}`);
          
          // Check deployer balance
          const balance = await mockToken.balanceOf(deployer.address);
          console.log(`    Deployer balance: ${ethers.formatUnits(balance, decimals)}`);
          
        } catch (mockError) {
          console.log(`  ❌ MockERC20 interface failed: ${mockError.message}`);
          
          // Try basic ERC20 interface
          try {
            const erc20 = await ethers.getContractAt('IERC20', tokenInfo.address);
            const totalSupply = await erc20.totalSupply();
            console.log(`  ✅ Basic ERC20 interface works, total supply: ${totalSupply}`);
            
            const balance = await erc20.balanceOf(deployer.address);
            console.log(`    Deployer balance: ${balance}`);
            
          } catch (erc20Error) {
            console.log(`  ❌ Basic ERC20 interface failed: ${erc20Error.message}`);
          }
        }
        
      } catch (error) {
        console.log(`  ❌ Error checking contract: ${error.message}`);
      }
    }
    
    console.log('\n🔍 Checking SAMM pool contracts:');
    
    for (const shard of deploymentData.contracts.shards) {
      console.log(`\n🔍 Checking shard ${shard.name} at ${shard.address}:`);
      
      try {
        const code = await ethers.provider.getCode(shard.address);
        console.log(`  Contract code length: ${code.length}`);
        
        if (code === '0x') {
          console.log(`  ❌ No contract deployed at this address!`);
          continue;
        }
        
        // Try SAMMPool interface
        try {
          const sammPool = await ethers.getContractAt('SAMMPool', shard.address);
          const tokenA = await sammPool.tokenA();
          const tokenB = await sammPool.tokenB();
          const reserves = await sammPool.getReserves();
          
          console.log(`  ✅ SAMMPool interface works:`);
          console.log(`    Token A: ${tokenA}`);
          console.log(`    Token B: ${tokenB}`);
          console.log(`    Reserve A: ${reserves[0]}`);
          console.log(`    Reserve B: ${reserves[1]}`);
          
          // Check if this pool has LP tokens we can send
          const totalSupply = await sammPool.totalSupply();
          const deployerLPBalance = await sammPool.balanceOf(deployer.address);
          
          console.log(`    Total LP Supply: ${ethers.formatEther(totalSupply)}`);
          console.log(`    Deployer LP Balance: ${ethers.formatEther(deployerLPBalance)}`);
          
        } catch (sammError) {
          console.log(`  ❌ SAMMPool interface failed: ${sammError.message}`);
        }
        
      } catch (error) {
        console.log(`  ❌ Error checking shard: ${error.message}`);
      }
    }
    
    console.log('\n🔍 Network information:');
    const network = await ethers.provider.getNetwork();
    console.log(`Chain ID: ${network.chainId}`);
    console.log(`Network name: ${network.name}`);
    
    const blockNumber = await ethers.provider.getBlockNumber();
    console.log(`Current block: ${blockNumber}`);
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}