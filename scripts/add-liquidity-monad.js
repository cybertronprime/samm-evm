const { ethers } = require("hardhat");

async function main() {
  console.log("💧 Adding liquidity to existing Monad shards...");

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

  console.log("💧 Adding liquidity to USDC/USDT shards...");
  
  // Add liquidity to USDC/USDT shards with different amounts
  const usdcUsdtLiquidityAmounts = [
    { usdc: "100", usdt: "100" },   // Shard 1: 100 each
    { usdc: "500", usdt: "500" },   // Shard 2: 500 each  
    { usdc: "1000", usdt: "1000" }  // Shard 3: 1000 each
  ];
  
  for (let i = 0; i < usdcUsdtShards.length; i++) {
    console.log(`Processing USDC/USDT shard ${i + 1}...`);
    
    const pool = SAMMPool.attach(usdcUsdtShards[i]);
    const amount0 = ethers.parseUnits(usdcUsdtLiquidityAmounts[i].usdc, 6);
    const amount1 = ethers.parseUnits(usdcUsdtLiquidityAmounts[i].usdt, 6);
    
    try {
      // Approve tokens with longer delays
      console.log(`  Approving USDC...`);
      await usdc.approve(usdcUsdtShards[i], amount0);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log(`  Approving USDT...`);
      await usdt.approve(usdcUsdtShards[i], amount1);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Add liquidity
      console.log(`  Adding liquidity...`);
      await pool.addLiquidity(amount0, amount1, 0, 0, wallet.address, Math.floor(Date.now() / 1000) + 3600);
      console.log(`✅ Added liquidity to USDC/USDT shard ${i + 1}: ${usdcUsdtLiquidityAmounts[i].usdc} USDC + ${usdcUsdtLiquidityAmounts[i].usdt} USDT`);
      
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay between shards
    } catch (error) {
      console.error(`❌ Failed to add liquidity to USDC/USDT shard ${i + 1}:`, error.message);
    }
  }

  console.log("💧 Adding liquidity to USDC/DAI shards...");
  
  // Add liquidity to USDC/DAI shards with different amounts
  const usdcDaiLiquidityAmounts = [
    { usdc: "200", dai: "200" },   // Shard 1: 200 each
    { usdc: "800", dai: "800" }    // Shard 2: 800 each
  ];
  
  for (let i = 0; i < usdcDaiShards.length; i++) {
    console.log(`Processing USDC/DAI shard ${i + 1}...`);
    
    const pool = SAMMPool.attach(usdcDaiShards[i]);
    const amount0 = ethers.parseUnits(usdcDaiLiquidityAmounts[i].usdc, 6);
    const amount1 = ethers.parseUnits(usdcDaiLiquidityAmounts[i].dai, 18);
    
    try {
      // Approve tokens with longer delays
      console.log(`  Approving USDC...`);
      await usdc.approve(usdcDaiShards[i], amount0);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log(`  Approving DAI...`);
      await dai.approve(usdcDaiShards[i], amount1);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Add liquidity
      console.log(`  Adding liquidity...`);
      await pool.addLiquidity(amount0, amount1, 0, 0, wallet.address, Math.floor(Date.now() / 1000) + 3600);
      console.log(`✅ Added liquidity to USDC/DAI shard ${i + 1}: ${usdcDaiLiquidityAmounts[i].usdc} USDC + ${usdcDaiLiquidityAmounts[i].dai} DAI`);
      
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay between shards
    } catch (error) {
      console.error(`❌ Failed to add liquidity to USDC/DAI shard ${i + 1}:`, error.message);
    }
  }

  console.log("✅ Liquidity addition completed!");
}

main()
  .then(() => {
    console.log("\n✅ Liquidity addition script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Liquidity addition failed:");
    console.error(error);
    process.exit(1);
  });