#!/usr/bin/env node

/**
 * Simple Multi-Hop Swap Test
 */

require('dotenv').config({ path: '.env.monad' });
const { ethers } = require('ethers');

console.log('🚀 Simple Multi-Hop Swap Test');
console.log('Environment check:');
console.log('- PRIVATE_KEY exists:', !!process.env.PRIVATE_KEY);
console.log('- RPC URL: https://testnet-rpc.monad.xyz');

async function testConnection() {
  try {
    const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
    const blockNumber = await provider.getBlockNumber();
    console.log('✅ Connected to Monad. Block:', blockNumber);
    
    if (process.env.PRIVATE_KEY) {
      const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
      console.log('✅ Wallet address:', wallet.address);
      
      const balance = await provider.getBalance(wallet.address);
      console.log('✅ Wallet balance:', ethers.formatEther(balance), 'ETH');
    }
    
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
  }
}

testConnection();