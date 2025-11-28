const { ethers } = require('hardhat');
require('dotenv').config();

async function checkBalance() {
    try {
        console.log('🔍 Checking Monad Balance...');
        console.log('RPC URL:', process.env.MONAD_RPC_URL);
        
        const provider = new ethers.JsonRpcProvider(process.env.MONAD_RPC_URL);
        const deployer = '0x004566C322f5F1CBC0594928556441f8D38EA589';
        
        console.log('Deployer Address:', deployer);
        
        // Check network
        const network = await provider.getNetwork();
        console.log('Network:', network.name, 'Chain ID:', network.chainId.toString());
        
        // Check balance
        const balance = await provider.getBalance(deployer);
        const balanceEth = ethers.formatEther(balance);
        
        console.log('Raw Balance:', balance.toString());
        console.log('Balance in MON:', balanceEth);
        
    } catch (error) {
        console.error('❌ Error checking balance:', error.message);
    }
}

checkBalance();