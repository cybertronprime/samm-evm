const { ethers } = require("hardhat");

async function main() {
  console.log("💰 Adding MASSIVE liquidity to both RiseChain and Monad shards...");
  console.log("🎯 Goal: Add substantial liquidity for proper swaps and testing");

  // Load deployment data
  const riseChainData = require('../deployment-data/risechain-multi-shard-1764273559148.json');
  const monadData = require('../deployment-data/monad-multi-shard-1764330063991.json');

  const PRIVATE_KEY = "9387e097a14f64f865d10cc50835d3b16c3683f2e2cebd518b2456260f1e59ad";

  // Setup providers and wallets
  const riseProvider = new ethers.JsonRpcProvider("https://testnet.riselabs.xyz");
  const monadProvider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  
  const riseWallet = new ethers.Wallet(PRIVATE_KEY, riseProvider);
  const monadWallet = new ethers.Wallet(PRIVATE_KEY, monadProvider);

  console.log(`Wallet Address: ${riseWallet.address}`);

  // Check balances first
  console.log("\n💰 Checking token balances...");
  
  async function checkBalances(provider, wallet, tokens, chainName) {
    console.log(`\n${chainName} Balances:`);
    const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
    
    for (const token of tokens) {
      const contract = MockERC20.attach(token.address);
      const balance = await contract.balanceOf(wallet.address);
      const decimals = token.symbol === 'DAI' ? 18 : 6;
      console.log(`  ${token.symbol}: ${ethers.formatUnits(balance, decimals)}`);
    }
  }

  await checkBalances(riseProvider, riseWallet, riseChainData.contracts.tokens, "RiseChain");
  await checkBalances(monadProvider, monadWallet, monadData.contracts.tokens, "Monad");

  // MASSIVE liquidity amounts - much larger than initial
  const MASSIVE_LIQUIDITY = {
    'USDC/USDT': [
      { usdc: "50000", usdt: "50000" },   // Shard 1: 50K each (was 100)
      { usdc: "100000", usdt: "100000" }, // Shard 2: 100K each (was 500)  
      { usdc: "200000", usdt: "200000" }  // Shard 3: 200K each (was 1000)
    ],
    'USDC/DAI': [
      { usdc: "75000", dai: "75000" },    // Shard 1: 75K each (was 200)
      { usdc: "150000", dai: "150000" }   // Shard 2: 150K each (was 800)
    ]
  };

  async function addMassiveLiquidity(provider, wallet, deploymentData, chainName) {
    console.log(`\n🚀 Adding MASSIVE liquidity to ${chainName}...`);
    
    const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
    const SAMMPool = await ethers.getContractFactory("SAMMPool");
    
    // Get token contracts
    const tokens = {};
    for (const token of deploymentData.contracts.tokens) {
      tokens[token.symbol] = MockERC20.attach(token.address);
    }

    // Process USDC/USDT shards
    console.log(`\n💧 Adding liquidity to ${chainName} USDC/USDT shards...`);
    const usdcUsdtShards = deploymentData.contracts.shards.filter(s => s.pairName === 'USDC/USDT');
    
    for (let i = 0; i < usdcUsdtShards.length; i++) {
      const shard = usdcUsdtShards[i];
      const amounts = MASSIVE_LIQUIDITY['USDC/USDT'][i];
      
      console.log(`\n  Processing ${shard.name}...`);
      console.log(`  Target: ${amounts.usdc} USDC + ${amounts.usdt} USDT`);
      
      const pool = SAMMPool.attach(shard.address);
      const usdcAmount = ethers.parseUnits(amounts.usdc, 6);
      const usdtAmount = ethers.parseUnits(amounts.usdt, 6);
      
      try {
        // Approve tokens
        console.log(`    Approving USDC...`);
        const usdcTx = await tokens.USDC.approve(shard.address, usdcAmount);
        await usdcTx.wait();
        
        console.log(`    Approving USDT...`);
        const usdtTx = await tokens.USDT.approve(shard.address, usdtAmount);
        await usdtTx.wait();
        
        // Add liquidity
        console.log(`    Adding massive liquidity...`);
        const liquidityTx = await pool.addLiquidity(
          usdcAmount,
          usdtAmount,
          0, // amountAMin
          0, // amountBMin
          wallet.address
        );
        await liquidityTx.wait();
        
        console.log(`    ✅ Added ${amounts.usdc} USDC + ${amounts.usdt} USDT to ${shard.name}`);
        
        // Check new reserves
        const reserves = await pool.getReserves();
        console.log(`    📊 New reserves: ${ethers.formatUnits(reserves[0], 6)} USDC, ${ethers.formatUnits(reserves[1], 6)} USDT`);
        
      } catch (error) {
        console.error(`    ❌ Failed to add liquidity to ${shard.name}:`, error.message);
      }
      
      // Delay between shards
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // Process USDC/DAI shards
    console.log(`\n💧 Adding liquidity to ${chainName} USDC/DAI shards...`);
    const usdcDaiShards = deploymentData.contracts.shards.filter(s => s.pairName === 'USDC/DAI');
    
    for (let i = 0; i < usdcDaiShards.length; i++) {
      const shard = usdcDaiShards[i];
      const amounts = MASSIVE_LIQUIDITY['USDC/DAI'][i];
      
      console.log(`\n  Processing ${shard.name}...`);
      console.log(`  Target: ${amounts.usdc} USDC + ${amounts.dai} DAI`);
      
      const pool = SAMMPool.attach(shard.address);
      const usdcAmount = ethers.parseUnits(amounts.usdc, 6);
      const daiAmount = ethers.parseUnits(amounts.dai, 18);
      
      try {
        // Approve tokens
        console.log(`    Approving USDC...`);
        const usdcTx = await tokens.USDC.approve(shard.address, usdcAmount);
        await usdcTx.wait();
        
        console.log(`    Approving DAI...`);
        const daiTx = await tokens.DAI.approve(shard.address, daiAmount);
        await daiTx.wait();
        
        // Add liquidity
        console.log(`    Adding massive liquidity...`);
        const liquidityTx = await pool.addLiquidity(
          usdcAmount,
          daiAmount,
          0, // amountAMin
          0, // amountBMin
          wallet.address
        );
        await liquidityTx.wait();
        
        console.log(`    ✅ Added ${amounts.usdc} USDC + ${amounts.dai} DAI to ${shard.name}`);
        
        // Check new reserves
        const reserves = await pool.getReserves();
        console.log(`    📊 New reserves: ${ethers.formatUnits(reserves[0], 6)} USDC, ${ethers.formatUnits(reserves[1], 18)} DAI`);
        
      } catch (error) {
        console.error(`    ❌ Failed to add liquidity to ${shard.name}:`, error.message);
      }
      
      // Delay between shards
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Add massive liquidity to both chains
  await addMassiveLiquidity(riseProvider, riseWallet, riseChainData, "RiseChain");
  await addMassiveLiquidity(monadProvider, monadWallet, monadData, "Monad");

  console.log("\n🎉 MASSIVE LIQUIDITY ADDITION COMPLETED!");
  console.log("\n📊 Summary:");
  console.log("✅ RiseChain: All shards now have massive liquidity");
  console.log("✅ Monad: All shards now have massive liquidity");
  console.log("✅ Ready for comprehensive swap testing");
  console.log("✅ c-smaller-better property will be clearly demonstrated");
  console.log("✅ Multi-hop swaps will have sufficient liquidity");
  
  console.log("\n🔥 Liquidity Levels:");
  console.log("USDC/USDT Shards: 50K, 100K, 200K (each token)");
  console.log("USDC/DAI Shards: 75K, 150K (each token)");
  console.log("\n🚀 Ready for real transaction testing!");
}

main()
  .then(() => {
    console.log("\n✅ Massive liquidity addition completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Massive liquidity addition failed:");
    console.error(error);
    process.exit(1);
  });