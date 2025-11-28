#!/usr/bin/env node

/**
 * Start the unified SAMM multi-chain backend
 * Handles both RiseChain and Monad with all APIs
 */

require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting SAMM Unified Multi-Chain Backend');
console.log('============================================');

const child = spawn('node', ['src/multi-chain-server.js'], {
  cwd: path.join(__dirname, 'services'),
  env: {
    ...process.env,
    MULTI_CHAIN_PORT: 3000
  },
  stdio: 'inherit'
});

child.on('error', (error) => {
  console.error('❌ Error starting backend:', error);
  process.exit(1);
});

child.on('exit', (code) => {
  console.log(`📊 Backend exited with code ${code}`);
  process.exit(code);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down backend...');
  child.kill('SIGTERM');
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});