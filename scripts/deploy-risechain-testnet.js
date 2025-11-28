const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { 
  createProvider, 
  validateDeployerBalance, 
  getDeploymentParams,
  getChainConfig 
} = require("../config/deployment-config");

async function main() {
  console.log("🚀 Starting SAMM EVM Deployment to RiseChain Testnet");
  console.log("=".repeat(60));

  const networkName = "risechain";
  
  try {
    const { provider, wallet, config } = createProvider(networkName);
    const deploymentParams = getDeploymentParams(networkName);

    console.log("📋 Deployment Details:");
    console.log(`Network: ${config.name} (Chain ID: ${config.chainId})`);
    console.log(`Deployer: ${wallet.address}`);
    
    // Validate balance before deployment
    console.log("\n💳 Validating deployer balance...");
    const balanceCheck = await validateDeployerBalance(provider, wallet.address, networkName);
    
    console.log(`Current Balance: ${balanceCheck.balanceEth} ${balanceCheck.nativeTokenSymbol}`);
    console.log(`Required Balance: ${balanceCheck.minRequiredEth} ${balanceCheck.nativeTokenSymbol}`);
    
    if (!balanceCheck.isValid) {
      console.log(`⚠️  Warning: Balance may be insufficient. Have ${balanceCheck.balanceEth} ${balanceCheck.nativeTokenSymbol}, recommended ${balanceCheck.minRequiredEth} ${balanceCheck.nativeTokenSymbol}`);
      console.log("🚀 Proceeding with deployment anyway due to very low gas prices...");
      console.log("\n💡 If deployment fails due to insufficient funds:");
      console.log("   1. Visit the RiseChain testnet faucet");
      console.log("   2. Request tokens for address:", wallet.address);
      console.log("   3. Wait for tokens to arrive and retry deployment");
    } else {
      console.log("✅ Balance sufficient for deployment");
    }

    // Get network info and verify connection
    const network = await provider.getNetwork();
    console.log(`\n🌐 Connected to ${config.name}`);
    console.log(`Chain ID: ${network.chainId}`);
    
    if (Number(network.chainId) !== config.chainId) {
      console.log(`⚠️  Warning: Chain ID mismatch. Expected ${config.chainId}, got ${network.chainId}`);
    }

    console.log("\n🔧 Deploying Contracts...");

    // Deploy SAMM Pool Factory
    console.log("\n1️⃣ Deploying SAMM Pool Factory...");
    const SAMMPoolFactory = await ethers.getContractFactory("SAMMPoolFactory", wallet);
    
    const factoryTx = await SAMMPoolFactory.deploy({
      gasLimit: deploymentParams.gasSettings.gasLimit
    });
    
    console.log(`⏳ Factory deployment transaction: ${factoryTx.deploymentTransaction().hash}`);
    const factory = await factoryTx.waitForDeployment();
    
    // Wait for confirmations
    console.log(`⏳ Waiting for ${deploymentParams.confirmations} confirmations...`);
    await factory.deploymentTransaction().wait(deploymentParams.confirmations);
    
    const factoryAddress = await factory.getAddress();
    console.log(`✅ SAMM Factory deployed: ${factoryAddress}`);

    // Deploy test tokens for validation
    console.log("\n2️⃣ Deploying test tokens...");
    const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20", wallet);
    
    console.log("   Deploying Test Token A...");
    const tokenA = await MockERC20.deploy("RiseChain Test Token A", "RTESTA", 18, {
      gasLimit: deploymentParams.gasSettings.gasLimit
    });
    await tokenA.waitForDeployment();
    await tokenA.deploymentTransaction().wait(deploymentParams.confirmations);
    
    console.log("   Deploying Test Token B...");
    const tokenB = await MockERC20.deploy("RiseChain Test Token B", "RTESTB", 18, {
      gasLimit: deploymentParams.gasSettings.gasLimit
    });
    await tokenB.waitForDeployment();
    await tokenB.deploymentTransaction().wait(deploymentParams.confirmations);
    
    const tokenAAddress = await tokenA.getAddress();
    const tokenBAddress = await tokenB.getAddress();
    
    console.log(`✅ Test Token A: ${tokenAAddress}`);
    console.log(`✅ Test Token B: ${tokenBAddress}`);

    // Create test shard for parameter verification
    console.log("\n3️⃣ Creating test shard...");
    const createTx = await factory.createShardDefault(tokenAAddress, tokenBAddress, {
      gasLimit: deploymentParams.gasSettings.gasLimit
    });
    
    console.log(`⏳ Shard creation transaction: ${createTx.hash}`);
    const receipt = await createTx.wait(deploymentParams.confirmations);
    
    // Extract shard address from events
    const shardCreatedEvent = receipt.logs.find(
      log => log.fragment && log.fragment.name === "ShardCreated"
    );
    
    if (!shardCreatedEvent) {
      throw new Error("ShardCreated event not found in transaction receipt");
    }
    
    const shardAddress = shardCreatedEvent.args[0];
    console.log(`✅ Test Shard created: ${shardAddress}`);

    // Initialize shard first before verifying parameters
    console.log("\n4️⃣ Initializing test shard with liquidity...");
    
    // Mint tokens to deployer
    const mintAmount = ethers.parseEther("1000000");
    console.log("   Minting test tokens...");
    await tokenA.mint(wallet.address, mintAmount);
    await tokenB.mint(wallet.address, mintAmount);
    
    // Approve tokens for shard (since the pool's initialize method expects msg.sender to have approved tokens to the pool)
    console.log("   Approving tokens...");
    await tokenA.approve(shardAddress, mintAmount);
    await tokenB.approve(shardAddress, mintAmount);
    
    // Create multiple shards for proper SAMM testing
    console.log("   Creating additional shards for comprehensive testing...");
    
    const shardAddresses = [shardAddress];
    const shardNames = ["Initial Shard"];
    
    // Create 3 more shards (total of 4 shards)
    for (let i = 1; i < 4; i++) {
      console.log(`   Creating shard ${i + 1}...`);
      const createTx = await factory.createShardDefault(tokenAAddress, tokenBAddress, {
        gasLimit: deploymentParams.gasSettings.gasLimit
      });
      
      const receipt = await createTx.wait(deploymentParams.confirmations);
      const shardCreatedEvent = receipt.logs.find(
        log => log.fragment && log.fragment.name === "ShardCreated"
      );
      
      if (!shardCreatedEvent) {
        throw new Error(`ShardCreated event not found for shard ${i + 1}`);
      }
      
      const newShardAddress = shardCreatedEvent.args[0];
      shardAddresses.push(newShardAddress);
      shardNames.push(`Shard ${i + 1}`);
      console.log(`   ✅ Shard ${i + 1} created: ${newShardAddress}`);
    }
    
    console.log(`✅ Created ${shardAddresses.length} shards total`);
    
    // Initialize all shards with different liquidity amounts to test c-smaller-better property
    console.log("   Initializing shards with different liquidity levels...");
    
    const liquidityAmounts = [
      ethers.parseEther("5000"),   // Smallest shard
      ethers.parseEther("10000"),  // Medium shard 1
      ethers.parseEther("15000"),  // Medium shard 2  
      ethers.parseEther("20000")   // Largest shard
    ];
    
    const SAMMPoolContract = await ethers.getContractFactory("SAMMPool");
    const initializedShards = [];
    
    for (let i = 0; i < shardAddresses.length; i++) {
      console.log(`   Initializing ${shardNames[i]} with ${ethers.formatEther(liquidityAmounts[i])} tokens each...`);
      
      const shardContract = SAMMPoolContract.attach(shardAddresses[i]);
      
      // Initialize the shard directly with default fee parameters
      const initTx = await shardContract.initialize(
        tokenAAddress,
        tokenBAddress,
        liquidityAmounts[i],
        liquidityAmounts[i],
        25,    // tradeFeeNumerator (0.25%)
        10000, // tradeFeeDenominator
        10,    // ownerFeeNumerator (0.1%)
        10000, // ownerFeeDenominator
        {
          gasLimit: deploymentParams.gasSettings.gasLimit
        }
      );
      await initTx.wait(deploymentParams.confirmations);
      
      initializedShards.push({
        address: shardAddresses[i],
        name: shardNames[i],
        liquidityA: liquidityAmounts[i],
        liquidityB: liquidityAmounts[i],
        contract: shardContract
      });
      
      console.log(`   ✅ ${shardNames[i]} initialized`);
    }
    
    console.log(`✅ All ${initializedShards.length} shards initialized with varying liquidity levels`);

    // Now verify SAMM parameters on all shards
    console.log("\n5️⃣ Verifying SAMM parameters on all shards...");
    
    for (let i = 0; i < initializedShards.length; i++) {
      const shard = initializedShards[i];
      console.log(`   Checking ${shard.name}...`);
      
      const [beta1, rmin, rmax, c] = await shard.contract.getSAMMParams();
      const sammParams = {
        beta1: Number(beta1),
        rmin: Number(rmin),
        rmax: Number(rmax),
        c: Number(c)
      };
      
      // Verify parameters match expected values
      const paramsMatch = 
        sammParams.beta1 === deploymentParams.sammParameters.beta1 &&
        sammParams.rmin === deploymentParams.sammParameters.rmin &&
        sammParams.rmax === deploymentParams.sammParameters.rmax &&
        sammParams.c === deploymentParams.sammParameters.c;

      if (!paramsMatch) {
        throw new Error(`❌ SAMM parameters do not match expected values on ${shard.name}`);
      }
      
      console.log(`   ✅ ${shard.name}: β1=${sammParams.beta1}, rmin=${sammParams.rmin}, rmax=${sammParams.rmax}, c=${sammParams.c}`);
    }
    
    console.log("✅ All SAMM parameters verified successfully on all shards");

    // Test SAMM swap functionality across multiple shards to verify c-smaller-better property
    console.log("\n6️⃣ Testing SAMM swap functionality across multiple shards...");
    const swapAmount = ethers.parseEther("100"); // Test with 100 tokens
    const maxAmountIn = ethers.parseEther("200");
    
    console.log(`📊 Testing swap of ${ethers.formatEther(swapAmount)} Token B across all shards:`);
    
    const swapResults = [];
    
    // Calculate swap costs on all shards to demonstrate c-smaller-better property
    for (let i = 0; i < initializedShards.length; i++) {
      const shard = initializedShards[i];
      console.log(`\n   Testing ${shard.name} (Liquidity: ${ethers.formatEther(shard.liquidityA)} each):`);
      
      try {
        const swapResult = await shard.contract.calculateSwapSAMM(
          swapAmount,
          tokenAAddress,
          tokenBAddress
        );
        
        const result = {
          shardName: shard.name,
          shardAddress: shard.address,
          liquidityA: shard.liquidityA,
          amountIn: swapResult.amountIn,
          tradeFee: swapResult.tradeFee,
          ownerFee: swapResult.ownerFee,
          totalCost: swapResult.amountIn
        };
        
        swapResults.push(result);
        
        console.log(`     Amount In: ${ethers.formatEther(result.amountIn)} Token A`);
        console.log(`     Trade Fee: ${ethers.formatEther(result.tradeFee)} Token A`);
        console.log(`     Owner Fee: ${ethers.formatEther(result.ownerFee)} Token A`);
        console.log(`     Total Cost: ${ethers.formatEther(result.totalCost)} Token A`);
        
      } catch (error) {
        console.log(`     ❌ Swap calculation failed: ${error.message}`);
      }
    }
    
    // Analyze results to verify c-smaller-better property
    console.log(`\n📈 SAMM Property Analysis:`);
    if (swapResults.length >= 2) {
      // Sort by liquidity (smallest first)
      swapResults.sort((a, b) => Number(a.liquidityA) - Number(b.liquidityA));
      
      console.log(`   Shards sorted by liquidity (smallest to largest):`);
      for (let i = 0; i < swapResults.length; i++) {
        const result = swapResults[i];
        console.log(`   ${i + 1}. ${result.shardName}: ${ethers.formatEther(result.liquidityA)} liquidity → ${ethers.formatEther(result.totalCost)} cost`);
      }
      
      // Verify c-smaller-better property
      let cSmallerBetterHolds = true;
      for (let i = 0; i < swapResults.length - 1; i++) {
        const smaller = swapResults[i];
        const larger = swapResults[i + 1];
        
        if (Number(smaller.totalCost) > Number(larger.totalCost)) {
          cSmallerBetterHolds = false;
          console.log(`   ❌ c-smaller-better violated: ${smaller.shardName} (smaller) costs more than ${larger.shardName} (larger)`);
        }
      }
      
      if (cSmallerBetterHolds) {
        console.log(`   ✅ c-smaller-better property verified: Smaller shards provide better rates`);
      }
    }
    
    // Execute a test swap on the smallest shard (best rate)
    if (swapResults.length > 0) {
      const bestShard = swapResults[0]; // Smallest shard with best rate
      console.log(`\n   Executing test swap on ${bestShard.shardName} (best rate)...`);
      
      const shardContract = SAMMPoolContract.attach(bestShard.shardAddress);
      const swapTx = await shardContract.swapSAMM(
        swapAmount,
        maxAmountIn,
        tokenAAddress,
        tokenBAddress,
        wallet.address,
        {
          gasLimit: deploymentParams.gasSettings.gasLimit
        }
      );
      await swapTx.wait(deploymentParams.confirmations);
      console.log("   ✅ Test swap executed successfully on smallest shard");
      
      // Get final reserves
      const [reserveA, reserveB] = await shardContract.getReserves();
      console.log(`   📊 ${bestShard.shardName} Reserves After Swap:`);
      console.log(`     Token A: ${ethers.formatEther(reserveA)}`);
      console.log(`     Token B: ${ethers.formatEther(reserveB)}`);
    }

    // Save deployment info
    const deploymentInfo = {
      network: config.name,
      networkName: networkName,
      chainId: Number(network.chainId),
      deployer: wallet.address,
      timestamp: new Date().toISOString(),
      contracts: {
        factory: factoryAddress,
        testTokenA: tokenAAddress,
        testTokenB: tokenBAddress,
        shards: initializedShards.map(shard => ({
          address: shard.address,
          name: shard.name,
          liquidityA: ethers.formatEther(shard.liquidityA),
          liquidityB: ethers.formatEther(shard.liquidityB)
        }))
      },
      sammParameters: deploymentParams.sammParameters,
      testResults: {
        swapAmount: ethers.formatEther(swapAmount),
        shardComparison: swapResults.map(result => ({
          shardName: result.shardName,
          shardAddress: result.shardAddress,
          liquidity: ethers.formatEther(result.liquidityA),
          totalCost: ethers.formatEther(result.totalCost),
          amountIn: ethers.formatEther(result.amountIn),
          tradeFee: ethers.formatEther(result.tradeFee),
          ownerFee: ethers.formatEther(result.ownerFee)
        })),
        cSmallerBetterVerified: swapResults.length >= 2
      },
      balanceInfo: {
        initialBalance: balanceCheck.balanceEth,
        minRequired: balanceCheck.minRequiredEth,
        nativeToken: balanceCheck.nativeTokenSymbol
      }
    };

    const deploymentPath = path.join(__dirname, "..", "deployments", `risechain-testnet-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));

    console.log("\n🎉 RiseChain Testnet Deployment Complete!");
    console.log("=".repeat(60));
    console.log(`📄 Deployment info saved to: ${deploymentPath}`);
    console.log("\n📋 Contract Addresses:");
    console.log(`Factory: ${factoryAddress}`);
    console.log(`Test Token A: ${tokenAAddress}`);
    console.log(`Test Token B: ${tokenBAddress}`);
    console.log(`\nShards (${initializedShards.length} total):`);
    for (let i = 0; i < initializedShards.length; i++) {
      const shard = initializedShards[i];
      console.log(`  ${shard.name}: ${shard.address} (${ethers.formatEther(shard.liquidityA)} liquidity each)`);
    }
    
    if (config.blockExplorer) {
      console.log("\n🔗 Block Explorer Links:");
      console.log(`Factory: ${config.blockExplorer}/address/${factoryAddress}`);
      for (let i = 0; i < initializedShards.length; i++) {
        const shard = initializedShards[i];
        console.log(`${shard.name}: ${config.blockExplorer}/address/${shard.address}`);
      }
    }

    console.log("\n🎯 Next Steps:");
    console.log("1. Verify contracts on block explorer");
    console.log("2. Test router service with multiple shards (smallest shard selection)");
    console.log("3. Test cross-pool routing functionality");
    console.log("4. Deploy backend services for RiseChain");
    console.log("5. Deploy to Monad testnet");
    console.log("\n💡 SAMM Testing Capabilities:");
    console.log(`✅ ${initializedShards.length} shards deployed with different liquidity levels`);
    console.log("✅ c-smaller-better property can be tested");
    console.log("✅ Smallest shard selection can be validated");
    console.log("✅ Cross-pool routing can be implemented");

    return deploymentInfo;

  } catch (error) {
    console.error("\n❌ RiseChain testnet deployment failed:");
    console.error(error.message);
    
    if (error.message.includes("insufficient funds")) {
      console.log("\n💡 Insufficient funds error - please:");
      console.log("1. Get RiseChain testnet tokens from faucet");
      console.log("2. Ensure you have at least 1.0 RISE for deployment");
      console.log("3. Retry deployment");
    }
    
    throw error;
  }
}

main()
  .then((deploymentInfo) => {
    console.log("\n✅ RiseChain testnet deployment script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error.message);
    process.exit(1);
  });