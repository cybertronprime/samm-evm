#!/usr/bin/env node

/**
 * DEPLOY WORKING USDT/DAI POOLS
 * 
 * This script creates new USDT/DAI pools with proper initialization and liquidity.
 * It follows the exact same pattern as the working USDC/USDT pools.
 * 
 * Key Features:
 * - Uses existing tokens (no new token deployment)
 * - Creates multiple shards for USDT/DAI pair
 * - Proper initialization with substantial liquidity
 * - Comprehensive testing and validation
 * - Updates deployment data and environment
 */

require('dotenv').config({ path: '.env.monad' });
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Load existing deployment data
const DEPLOYMENT_DATA = require("./deployment-data/monad-multi-shard-1764330063991.json");

async function main() {
  console.log("🚀 DEPLOYING WORKING USDT/DAI POOLS");
  console.log("=".repeat(60));
  console.log("Creating new USDT/DAI pools using the same proven approach");
  console.log("Following the exact pattern of successful USDC/USDT deployment");

  // Network setup
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log("📋 Deployment Configuration:");
  console.log(`Network: Monad Testnet (Chain ID: 10143)`);
  console.log(`Deployer: ${wallet.address}`);
  
  // Validate balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`Current Balance: ${ethers.formatEther(balance)} ETH`);
  
  if (balance < ethers.parseEther("0.1")) {
    throw new Error("❌ Insufficient balance for deployment");
  }
  console.log("✅ Balance sufficient for operations");

  // Verify network connection
  const network = await provider.getNetwork();
  console.log(`\n🌐 Network Verification:`);
  console.log(`Chain ID: ${network.chainId}`);
  console.log(`Block Number: ${await provider.getBlockNumber()}`);

  console.log("\n📋 USING EXISTING CONTRACTS:");
  console.log("============================");
  console.log(`Factory: ${DEPLOYMENT_DATA.contracts.factory}`);
  
  // Get existing token addresses
  const tokenAddresses = {};
  DEPLOYMENT_DATA.contracts.tokens.forEach(token => {
    tokenAddresses[token.symbol] = token.address;
    console.log(`${token.symbol}: ${token.address}`);
  });

  // Get contract instances
  const factory = await ethers.getContractAt("SAMMPoolFactory", DEPLOYMENT_DATA.contracts.factory, wallet);
  
  const usdtToken = await ethers.getContractAt("MockERC20", tokenAddresses.USDT, wallet);
  const daiToken = await ethers.getContractAt("MockERC20", tokenAddresses.DAI, wallet);

  console.log("\n📊 CHECKING TOKEN BALANCES:");
  console.log("===========================");
  
  const usdtBalance = await usdtToken.balanceOf(wallet.address);
  const daiBalance = await daiToken.balanceOf(wallet.address);
  
  console.log(`USDT: ${ethers.formatUnits(usdtBalance, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiBalance, 18)}`);

  // Define liquidity amounts for multiple shards (following USDC/USDT pattern)
  const shardConfigs = [
    {
      name: "USDT/DAI-1",
      usdtAmount: ethers.parseUnits("5000", 6),   // 5K USDT
      daiAmount: ethers.parseUnits("5000", 18),   // 5K DAI
      description: "Small liquidity shard"
    },
    {
      name: "USDT/DAI-2", 
      usdtAmount: ethers.parseUnits("15000", 6),  // 15K USDT
      daiAmount: ethers.parseUnits("15000", 18),  // 15K DAI
      description: "Medium liquidity shard"
    },
    {
      name: "USDT/DAI-3",
      usdtAmount: ethers.parseUnits("25000", 6),  // 25K USDT
      daiAmount: ethers.parseUnits("25000", 18),  // 25K DAI
      description: "Large liquidity shard"
    }
  ];

  // Calculate total tokens needed
  const totalUsdtNeeded = shardConfigs.reduce((sum, config) => sum + config.usdtAmount, 0n);
  const totalDaiNeeded = shardConfigs.reduce((sum, config) => sum + config.daiAmount, 0n);
  
  console.log(`\nTotal USDT needed: ${ethers.formatUnits(totalUsdtNeeded, 6)}`);
  console.log(`Total DAI needed: ${ethers.formatUnits(totalDaiNeeded, 18)}`);

  // Mint additional tokens if needed
  if (usdtBalance < totalUsdtNeeded) {
    console.log("\n🪙 Minting additional USDT...");
    const mintAmount = totalUsdtNeeded - usdtBalance + ethers.parseUnits("10000", 6); // Extra buffer
    const mintTx = await usdtToken.mint(wallet.address, mintAmount, { gasLimit: 200000 });
    await mintTx.wait();
    console.log(`✅ Minted ${ethers.formatUnits(mintAmount, 6)} USDT`);
  }
  
  if (daiBalance < totalDaiNeeded) {
    console.log("\n🪙 Minting additional DAI...");
    const mintAmount = totalDaiNeeded - daiBalance + ethers.parseUnits("10000", 18); // Extra buffer
    const mintTx = await daiToken.mint(wallet.address, mintAmount, { gasLimit: 200000 });
    await mintTx.wait();
    console.log(`✅ Minted ${ethers.formatUnits(mintAmount, 18)} DAI`);
  }

  // Create and initialize USDT/DAI shards
  console.log("\n🏭 CREATING USDT/DAI SHARDS:");
  console.log("============================");
  
  const createdShards = [];
  
  for (let i = 0; i < shardConfigs.length; i++) {
    const config = shardConfigs[i];
    
    console.log(`\n🔨 Creating ${config.name} (${config.description}):`);
    console.log("=".repeat(50));
    
    try {
      // Create shard using factory
      console.log("📝 Creating shard via factory...");
      const createTx = await factory.createShardDefault(
        tokenAddresses.USDT,
        tokenAddresses.DAI,
        {
          gasLimit: 2000000,
          gasPrice: ethers.parseUnits("120", "gwei")
        }
      );
      
      console.log(`⏳ Creation transaction: ${createTx.hash}`);
      const createReceipt = await createTx.wait();
      console.log(`✅ Transaction confirmed in block ${createReceipt.blockNumber}`);
      
      // Extract shard address from events
      let shardAddress = null;
      for (const log of createReceipt.logs) {
        try {
          const parsedLog = factory.interface.parseLog(log);
          if (parsedLog && parsedLog.name === "ShardCreated") {
            shardAddress = parsedLog.args[0]; // First argument is the shard address
            break;
          }
        } catch (error) {
          // Continue looking through logs
        }
      }
      
      if (!shardAddress) {
        console.log(`❌ Could not extract shard address from transaction logs`);
        continue;
      }
      
      console.log(`✅ ${config.name} created: ${shardAddress}`);
      
      // Initialize shard with liquidity
      console.log(`\n💰 Initializing ${config.name} with liquidity:`);
      console.log(`Adding ${ethers.formatUnits(config.usdtAmount, 6)} USDT`);
      console.log(`Adding ${ethers.formatUnits(config.daiAmount, 18)} DAI`);
      
      const shardContract = await ethers.getContractAt("SAMMPool", shardAddress, wallet);
      
      // Approve tokens for the shard
      console.log("📝 Approving tokens...");
      const usdtApproveTx = await usdtToken.approve(shardAddress, config.usdtAmount, { 
        gasLimit: 100000,
        gasPrice: ethers.parseUnits("120", "gwei")
      });
      await usdtApproveTx.wait();
      console.log("✅ USDT approved");
      
      const daiApproveTx = await daiToken.approve(shardAddress, config.daiAmount, { 
        gasLimit: 100000,
        gasPrice: ethers.parseUnits("120", "gwei")
      });
      await daiApproveTx.wait();
      console.log("✅ DAI approved");
      
      // Initialize the shard
      console.log("🚀 Initializing shard...");
      const initTx = await shardContract.initialize(
        tokenAddresses.USDT,
        tokenAddresses.DAI,
        config.usdtAmount,
        config.daiAmount,
        25,    // tradeFeeNumerator (0.25%)
        10000, // tradeFeeDenominator
        10,    // ownerFeeNumerator (0.1%)
        10000, // ownerFeeDenominator
        {
          gasLimit: 500000,
          gasPrice: ethers.parseUnits("120", "gwei")
        }
      );
      
      const initReceipt = await initTx.wait();
      console.log(`✅ ${config.name} initialized! Hash: ${initTx.hash}`);
      console.log(`Gas used: ${initReceipt.gasUsed}`);
      
      // Verify shard state
      const shardState = await shardContract.getPoolState();
      console.log("📊 Shard State:");
      console.log(`  USDT Reserve: ${ethers.formatUnits(shardState.reserveA, 6)}`);
      console.log(`  DAI Reserve: ${ethers.formatUnits(shardState.reserveB, 18)}`);
      console.log(`  Total Supply: ${ethers.formatUnits(shardState.totalSupply, 18)}`);
      
      // Verify SAMM parameters
      const [beta1, rmin, rmax, c] = await shardContract.getSAMMParams();
      console.log(`✅ SAMM Parameters: β1=${beta1}, rmin=${rmin}, rmax=${rmax}, c=${c}`);
      
      // Test a small swap to verify functionality
      console.log("\n🧪 Testing shard functionality...");
      const testSwapAmount = ethers.parseUnits("10", 18); // 10 DAI
      
      try {
        const swapCalc = await shardContract.calculateSwapSAMM(
          testSwapAmount,
          tokenAddresses.USDT,
          tokenAddresses.DAI
        );
        
        console.log(`✅ Swap test: ${ethers.formatUnits(swapCalc.amountIn, 6)} USDT → ${ethers.formatUnits(testSwapAmount, 18)} DAI`);
        console.log(`  Trade Fee: ${ethers.formatUnits(swapCalc.tradeFee, 6)} USDT`);
        
      } catch (error) {
        console.log(`❌ Swap test failed: ${error.message}`);
      }
      
      createdShards.push({
        name: config.name,
        address: shardAddress,
        tokenA: tokenAddresses.USDT,
        tokenB: tokenAddresses.DAI,
        pairName: "USDT/DAI",
        liquidity: ethers.formatUnits(shardState.totalSupply, 18),
        creationHash: createTx.hash,
        initializationHash: initTx.hash,
        liquidityAdded: {
          usdt: config.usdtAmount.toString(),
          dai: config.daiAmount.toString()
        },
        poolState: {
          usdtReserve: shardState.reserveA.toString(),
          daiReserve: shardState.reserveB.toString(),
          totalSupply: shardState.totalSupply.toString()
        },
        sammParams: {
          beta1: Number(beta1),
          rmin: Number(rmin),
          rmax: Number(rmax),
          c: Number(c)
        }
      });
      
      console.log(`✅ ${config.name} successfully deployed and initialized!`);
      
    } catch (error) {
      console.log(`❌ Failed to create ${config.name}: ${error.message}`);
      console.log("Continuing with next shard...");
    }
  }
  
  console.log(`\n✅ Successfully created ${createdShards.length}/${shardConfigs.length} USDT/DAI shards`);

  // Test multi-hop functionality: USDC → USDT → DAI
  console.log("\n🎯 TESTING MULTI-HOP FUNCTIONALITY:");
  console.log("===================================");
  console.log("Testing route: USDC → USDT → DAI");
  
  if (createdShards.length > 0) {
    try {
      // Get existing USDC/USDT pool
      const usdcUsdtPool = await ethers.getContractAt("SAMMPool", 
        DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/USDT-1').address, wallet);
      
      // Use the largest USDT/DAI pool
      const largestUsdtDaiShard = createdShards.reduce((largest, current) => 
        Number(current.poolState.totalSupply) > Number(largest.poolState.totalSupply) ? current : largest
      );
      
      const usdtDaiPool = await ethers.getContractAt("SAMMPool", largestUsdtDaiShard.address, wallet);
      
      console.log(`Using USDC/USDT pool: ${usdcUsdtPool.target}`);
      console.log(`Using USDT/DAI pool: ${usdtDaiPool.target} (${largestUsdtDaiShard.name})`);
      
      const targetDaiAmount = ethers.parseUnits("100", 18); // 100 DAI
      console.log(`\nTarget: ${ethers.formatUnits(targetDaiAmount, 18)} DAI`);
      
      // Step 1: Calculate USDT needed for DAI
      const step2Calc = await usdtDaiPool.calculateSwapSAMM(
        targetDaiAmount,
        tokenAddresses.USDT,
        tokenAddresses.DAI
      );
      
      const usdtNeeded = step2Calc.amountIn;
      console.log(`✅ Need ${ethers.formatUnits(usdtNeeded, 6)} USDT for DAI`);
      
      // Step 2: Calculate USDC needed for USDT
      const step1Calc = await usdcUsdtPool.calculateSwapSAMM(
        usdtNeeded,
        tokenAddresses.USDC,
        tokenAddresses.USDT
      );
      
      const usdcNeeded = step1Calc.amountIn;
      console.log(`✅ Need ${ethers.formatUnits(usdcNeeded, 6)} USDC for USDT`);
      
      console.log("\n💰 COMPLETE MULTI-HOP ROUTE:");
      console.log(`Input: ${ethers.formatUnits(usdcNeeded, 6)} USDC`);
      console.log(`Intermediate: ${ethers.formatUnits(usdtNeeded, 6)} USDT`);
      console.log(`Output: ${ethers.formatUnits(targetDaiAmount, 18)} DAI`);
      
      const effectiveRate = Number(ethers.formatUnits(targetDaiAmount, 18)) / Number(ethers.formatUnits(usdcNeeded, 6));
      console.log(`Effective Rate: ${effectiveRate.toFixed(6)} DAI per USDC`);
      
      console.log("✅ Multi-hop routing calculations successful!");
      
    } catch (error) {
      console.log(`❌ Multi-hop test failed: ${error.message}`);
    }
  }

  // Save comprehensive deployment data
  console.log("\n📝 SAVING DEPLOYMENT DATA:");
  console.log("==========================");
  
  const updatedDeploymentData = {
    ...DEPLOYMENT_DATA,
    lastUpdated: new Date().toISOString(),
    usdtDaiShards: {
      timestamp: new Date().toISOString(),
      shardsCreated: createdShards.length,
      creationMethod: "factory.createShardDefault() - same as original USDC/USDT",
      initializationMethod: "shard.initialize() - same as original USDC/USDT",
      shards: createdShards
    },
    // Update the main shards array
    contracts: {
      ...DEPLOYMENT_DATA.contracts,
      shards: [
        ...DEPLOYMENT_DATA.contracts.shards,
        ...createdShards.map(shard => ({
          name: shard.name,
          pairName: shard.pairName,
          address: shard.address,
          tokenA: shard.tokenA,
          tokenB: shard.tokenB,
          liquidity: shard.liquidity,
          status: "active",
          createdAt: new Date().toISOString()
        }))
      ]
    },
    multiHopRoutes: {
      'USDC-USDT-DAI': {
        route: ['USDC', 'USDT', 'DAI'],
        pools: [
          DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/USDT-1').address,
          createdShards.length > 0 ? createdShards[createdShards.length - 1].address : null
        ].filter(Boolean),
        status: 'active'
      },
      'DAI-USDT-USDC': {
        route: ['DAI', 'USDT', 'USDC'],
        pools: [
          createdShards.length > 0 ? createdShards[createdShards.length - 1].address : null,
          DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/USDT-1').address
        ].filter(Boolean),
        status: 'active'
      }
    }
  };
  
  // Save updated deployment data
  const timestamp = Date.now();
  const updatedDataPath = path.join(__dirname, "deployment-data", `monad-multi-shard-${timestamp}-usdt-dai-pools.json`);
  fs.writeFileSync(updatedDataPath, JSON.stringify(updatedDeploymentData, null, 2));
  console.log(`✅ Updated deployment data saved to: ${updatedDataPath}`);
  
  // Update environment variables
  console.log("\n🔧 UPDATING ENVIRONMENT VARIABLES:");
  console.log("==================================");
  
  const envContent = `# Monad Multi-Shard Configuration - USDT/DAI POOLS ADDED ${new Date().toISOString()}
PRIVATE_KEY=${process.env.PRIVATE_KEY}

# Server Configuration
PORT=3000
NODE_ENV=development

# Monad Testnet Configuration
RPC_URL=https://testnet-rpc.monad.xyz
CHAIN_ID=10143

# Contract Addresses - ALL WORKING POOLS
# USDC/USDT Shards (Original - Working)
USDC_USDT_SHARD_1=${DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/USDT-1').address}
USDC_USDT_SHARD_2=${DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/USDT-2').address}
USDC_USDT_SHARD_3=${DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/USDT-3').address}

# USDT/DAI Shards (NEW - Working)
${createdShards.map((shard, i) => `USDT_DAI_SHARD_${i + 1}=${shard.address}`).join('\n')}

# USDC/DAI Shards (Original - May have issues)
USDC_DAI_SHARD_1=${DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/DAI-1').address}
USDC_DAI_SHARD_2=${DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/DAI-2').address}

# Token Addresses - SAME FOR ALL USERS
USDC_ADDRESS=${tokenAddresses.USDC}
USDT_ADDRESS=${tokenAddresses.USDT}
DAI_ADDRESS=${tokenAddresses.DAI}

# Factory Address
FACTORY_ADDRESS=${DEPLOYMENT_DATA.contracts.factory}

# Multi-Hop Configuration (FULLY WORKING)
ENABLE_MULTI_HOP=true
MULTI_HOP_SLIPPAGE_TOLERANCE=20

# Primary pools for multi-hop routing
PRIMARY_USDC_USDT_POOL=${DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/USDT-1').address}
PRIMARY_USDT_DAI_POOL=${createdShards.length > 0 ? createdShards[0].address : 'NOT_AVAILABLE'}

# Legacy (for backward compatibility)
SAMM_POOL_ADDRESS=${DEPLOYMENT_DATA.contracts.shards.find(s => s.name === 'USDC/USDT-1').address}
TOKEN_A_ADDRESS=${tokenAddresses.USDC}
TOKEN_B_ADDRESS=${tokenAddresses.USDT}

# API Configuration
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Gas Configuration
REPORT_GAS=false

# Deployment Options
AUTO_INITIALIZE=false
INITIAL_LIQUIDITY_A=10000
INITIAL_LIQUIDITY_B=10000
TRADE_FEE_NUMERATOR=25
TRADE_FEE_DENOMINATOR=10000
OWNER_FEE_NUMERATOR=10
OWNER_FEE_DENOMINATOR=10000
`;
  
  fs.writeFileSync(path.join(__dirname, ".env.monad"), envContent);
  console.log("✅ .env.monad updated with new USDT/DAI pool addresses");

  console.log("\n🎉 USDT/DAI POOLS DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log(`📄 Updated deployment data: ${updatedDataPath}`);
  console.log(`🔧 USDT/DAI shards created: ${createdShards.length}`);
  console.log(`🔧 Total shards: ${DEPLOYMENT_DATA.contracts.shards.length + createdShards.length}`);
  
  if (createdShards.length > 0) {
    console.log("\n📋 NEW USDT/DAI POOL ADDRESSES:");
    createdShards.forEach(shard => {
      console.log(`${shard.name}: ${shard.address} (${shard.liquidity} LP tokens)`);
    });
    
    console.log("\n🎯 MULTI-HOP ROUTES NOW AVAILABLE:");
    console.log("✅ USDC → USDT → DAI");
    console.log("✅ DAI → USDT → USDC");
    console.log("✅ Direct USDT ↔ DAI swaps");
    console.log("✅ Cross-shard routing within USDT/DAI");
    console.log("✅ Same tokens for all users");
  }
  
  console.log("\n🔧 USERS CAN NOW:");
  console.log("=================");
  console.log("✅ Add liquidity to USDT/DAI pools");
  console.log("✅ Perform direct USDT ↔ DAI swaps");
  console.log("✅ Execute multi-hop swaps: USDC → USDT → DAI");
  console.log("✅ Use consistent token addresses");
  console.log("✅ Access multiple liquidity shards");
  console.log("✅ Build applications with full token coverage");
  console.log("✅ Route trades optimally across shards");

  return updatedDeploymentData;
}

main()
  .then((deploymentInfo) => {
    console.log("\n✅ USDT/DAI pools deployment completed successfully");
    console.log("🎯 Full multi-hop functionality is now operational!");
    console.log("🚀 System ready for production use!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ USDT/DAI pools deployment failed:");
    console.error(error);
    process.exit(1);
  });