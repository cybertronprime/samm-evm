#!/usr/bin/env node

/**
 * SAMM Multi-Service Startup Script
 * Starts all backend services for comprehensive API testing
 */

require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

const services = [
  {
    name: 'Multi-Shard Backend (RiseChain)',
    script: 'src/multi-shard-backend.js',
    port: 3000,
    env: {
      ...process.env,
      PORT: 3000,
      RPC_URL: 'https://testnet.riselabs.xyz',
      CHAIN_ID: 11155931
    }
  },
  {
    name: 'Multi-Chain Server',
    script: 'src/multi-chain-server.js', 
    port: 3002,
    env: {
      ...process.env,
      MULTI_CHAIN_PORT: 3002
    }
  }
];

const processes = [];

function startService(service) {
  console.log(`🚀 Starting ${service.name} on port ${service.port}...`);
  
  const child = spawn('node', [service.script], {
    cwd: path.join(__dirname, 'services'),
    env: service.env,
    stdio: 'inherit'
  });

  child.on('error', (error) => {
    console.error(`❌ Error starting ${service.name}:`, error);
  });

  child.on('exit', (code) => {
    console.log(`📊 ${service.name} exited with code ${code}`);
  });

  processes.push({ name: service.name, process: child });
  return child;
}

function startAllServices() {
  console.log('🌟 SAMM Multi-Service Startup');
  console.log('================================');
  
  services.forEach((service, index) => {
    setTimeout(() => {
      startService(service);
    }, index * 2000); // Stagger startup by 2 seconds
  });

  // Print service URLs after startup
  setTimeout(() => {
    console.log('\n🔗 Service URLs:');
    console.log('================');
    services.forEach(service => {
      console.log(`${service.name}: http://localhost:${service.port}`);
    });
    console.log('\n📋 Health Checks:');
    services.forEach(service => {
      console.log(`${service.name}: http://localhost:${service.port}/health`);
    });
  }, 5000);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down all services...');
  processes.forEach(({ name, process }) => {
    console.log(`Stopping ${name}...`);
    process.kill('SIGTERM');
  });
  process.exit(0);
});

process.on('SIGTERM', () => {
  processes.forEach(({ process }) => {
    process.kill('SIGTERM');
  });
  process.exit(0);
});

startAllServices();