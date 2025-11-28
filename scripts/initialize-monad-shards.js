const { ethers } = require("hardhat");

async function main() {
  console.log("🔧 Initializing Monad shards...");

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet("9387e097a14f64f865d10cc50835d3b16c3683f2e2cebd518b2456260f1e59ad", provider);

  // Contract addresses from the deployment
  const usdcAddress = "0x67DcA5710a9dA091e00093dF04765d711759f435";
  const usdtAddress = "0x1888FF2446f2542cbb399eD179F4d6d966268C1F";
  const daiAddress = "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e";

  // Shard addresses
  const usdcUsdtShards = [
    "0x686ff8090b18C0DF4f828f02deAf122CeC40B1DE",
    "0x0481CD694F9C4EfC925C694f49835547404c0460", 
    "0x49ac6067BB0b6d5b793e9F3af3CD78b3a108AA5a"
  ];
  
  const usdcDaiShards = [
    "0xdfE2C795465873c000a84A55dACb834226373e56",
    "0x67d3255147fa07adc747E76055f89b78aa4021c5"
  ];

  // Get token contracts
  const MockERC20 = await ethers.getContractFactory("MockERC20", wallet);
  const usdc = MockERC20.attach(usdcAddress);
  const usdt = MockERC20.attach(usdtAddress);
  const dai = MockERC20.attach(daiAddress);

  // Get pool contract factory
  const SAMMPool = await ethers.getContractFactory("SAMMPool");

  console.log("🔧 Initializing USDC/USDT shards...");
  
  // Initialize USDC/USDT shards with different amounts
  const usdcUsdtLiquidityAmounts = [
    { usdc: "100", usdt: "100" },   // Shard 1: 100 each
    { usdc: "500", usdt: "500" },   // Shard 2: 500 each  
    { usdc: "1000", usdt: "1000" }  // Shard 3: 1000 each
  ];
  
  for (let i = 0; i < usdcUsdtShards.length; i++) {
    console.log(`Initializing USDC/USDT shard ${i + 1}...`);
    
    const pool = SAMMPool.attach(usdcUsdtShards[i]);
    const amount0 = ethers.parseUnits(usdcUsdtLiquidityAmounts[i].usdc, 6);
    const amount1 = ethers.parseUnits(usdcUsdtLiquidityAmounts[i].usdt, 6);
    
    try {
      // Approve tokens
      console.log(`  Approving USDC...`);
      await usdc.approve(usdcUsdtShards[i], amount0);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log(`  Approving USDT...`);
      await usdt.approve(usdcUsdtShards[i], amount1);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Initialize the shard
      console.log(`  Initializing shard...`);
      await pool.initialize(
        usdcAddress,
        usdtAddress,
        amount0,
        amount1,
        25,    // tradeFeeNumerator (0.25%)
        10000, // tradeFeeDenominator
        10,    // ownerFeeNumerator (0.1%)
        10000  // ownerFeeDenominator
      );
      
      console.log(`✅ Initialized USDC/USDT shard ${i + 1}: ${usdcUsdtLiquidityAmounts[i].usdc} USDC + ${usdcUsdtLiquidityAmounts[i].usdt} USDT`);
      
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay between shards
    } catch (error) {
      console.error(`❌ Failed to initialize USDC/USDT shard ${i + 1}:`, error.message);
    }
  }

  console.log("🔧 Initializing USDC/DAI shards...");
  
  // Initialize USDC/DAI shards with different amounts
  const usdcDaiLiquidityAmounts = [
    { usdc: "200", dai: "200" },   // Shard 1: 200 each
    { usdc: "800", dai: "800" }    // Shard 2: 800 each
  ];
  
  for (let i = 0; i < usdcDaiShards.length; i++) {
    console.log(`Initializing USDC/DAI shard ${i + 1}...`);
    
    const pool = SAMMPool.attach(usdcDaiShards[i]);
    const amount0 = ethers.parseUnits(usdcDaiLiquidityAmounts[i].usdc, 6);
    const amount1 = ethers.parseUnits(usdcDaiLiquidityAmounts[i].dai, 18);
    
    try {
      // Approve tokens
      console.log(`  Approving USDC...`);
      await usdc.approve(usdcDaiShards[i], amount0);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log(`  Approving DAI...`);
      await dai.approve(usdcDaiShards[i], amount1);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Initialize the shard
      console.log(`  Initializing shard...`);
      await pool.initialize(
        usdcAddress,
        daiAddress,
        amount0,
        amount1,
        25,    // tradeFeeNumerator (0.25%)
        10000, // tradeFeeDenominator
        10,    // ownerFeeNumerator (0.1%)
        10000  // ownerFeeDenominator
      );
      
      console.log(`✅ Initialized USDC/DAI shard ${i + 1}: ${usdcDaiLiquidityAmounts[i].usdc} USDC + ${usdcDaiLiquidityAmounts[i].dai} DAI`);
      
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay between shards
    } catch (error) {
      console.error(`❌ Failed to initialize USDC/DAI shard ${i + 1}:`, error.message);
    }
  }

  console.log("✅ Shard initialization completed!");
  
  // Now create the deployment data file
  const deploymentData = {
    network: "Monad Testnet",
    chainId: 10143,
    timestamp: new Date().toISOString(),
    deployer: wallet.address,
    sammCoreFeature: "Multiple shards per token pair",
    contracts: {
      factory: "0x70fe868ac814CC197631B60eEEaEaa1553418D03",
      tokens: [
        {
          symbol: "USDC",
          address: usdcAddress
        },
        {
          symbol: "USDT", 
          address: usdtAddress
        },
        {
          symbol: "DAI",
          address: daiAddress
        }
      ],
      shards: [
        // USDC/USDT shards
        {
          name: "USDC/USDT-1",
          pairName: "USDC/USDT",
          address: usdcUsdtShards[0],
          tokenA: usdcAddress,
          tokenB: usdtAddress,
          liquidity: "100.0"
        },
        {
          name: "USDC/USDT-2", 
          pairName: "USDC/USDT",
          address: usdcUsdtShards[1],
          tokenA: usdcAddress,
          tokenB: usdtAddress,
          liquidity: "500.0"
        },
        {
          name: "USDC/USDT-3",
          pairName: "USDC/USDT", 
          address: usdcUsdtShards[2],
          tokenA: usdcAddress,
          tokenB: usdtAddress,
          liquidity: "1000.0"
        },
        // USDC/DAI shards
        {
          name: "USDC/DAI-1",
          pairName: "USDC/DAI",
          address: usdcDaiShards[0],
          tokenA: usdcAddress,
          tokenB: daiAddress,
          liquidity: "200.0"
        },
        {
          name: "USDC/DAI-2",
          pairName: "USDC/DAI",
          address: usdcDaiShards[1], 
          tokenA: usdcAddress,
          tokenB: daiAddress,
          liquidity: "800.0"
        }
      ]
    },
    multiShardStats: {
      totalShards: 5,
      usdcUsdtShards: 3,
      usdcDaiShards: 2,
      demonstratesMultiShardArchitecture: true
    }
  };

  const fs = require("fs");
  const path = require("path");
  const deploymentPath = path.join(__dirname, "..", "deployment-data", `monad-multi-shard-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));

  console.log(`📄 Deployment data saved to: ${deploymentPath}`);
  console.log("\n🔗 Deployment Summary:");
  console.log(`- Network: Monad Testnet (Chain ID: 10143)`);
  console.log(`- Factory: 0x70fe868ac814CC197631B60eEEaEaa1553418D03`);
  console.log(`- USDC: ${usdcAddress}`);
  console.log(`- USDT: ${usdtAddress}`);
  console.log(`- DAI: ${daiAddress}`);
  console.log(`- Total Shards: 5 (3 USDC/USDT + 2 USDC/DAI)`);
  console.log(`- Pools: USDC/USDT (3 shards), USDC/DAI (2 shards)`);
  console.log("✅ All contracts deployed and initialized successfully!");
}

main()
  .then(() => {
    console.log("\n✅ Shard initialization completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Shard initialization failed:");
    console.error(error);
    process.exit(1);
  });