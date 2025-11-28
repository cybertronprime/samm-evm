const { ethers } = require("hardhat");

async function main() {
  console.log("🔍 Testing USDT/DAI Initialization");
  
  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  // Use the deployed contracts
  const factoryAddress = "0x7A2627B69E55FC770305a90B77c7E1e6fE017c7B";
  const usdtAddress = "0x281DcB2448F1F3128B1B3a05BEdad5Fe5faD84FC";
  const daiAddress = "0x001cf2eadf44Ea89198fA4A9c9e5cf1b327391EF";
  const shardAddress = "0x2559897a0DdA736E6BaBb0C62551dB59e2Cb9Ea1";

  const factory = await ethers.getContractAt("SAMMPoolFactory", factoryAddress, wallet);
  const usdt = await ethers.getContractAt("MockERC20", usdtAddress, wallet);
  const dai = await ethers.getContractAt("MockERC20", daiAddress, wallet);
  const shard = await ethers.getContractAt("SAMMPool", shardAddress, wallet);

  console.log(`\nShard Info:`);
  const info = await factory.getShardInfo(shardAddress);
  console.log(`Token A: ${info.tokenA}`);
  console.log(`Token B: ${info.tokenB}`);
  console.log(`USDT: ${usdtAddress}`);
  console.log(`DAI: ${daiAddress}`);

  console.log(`\nToken Order Check:`);
  console.log(`Is USDT tokenA? ${info.tokenA.toLowerCase() === usdtAddress.toLowerCase()}`);
  console.log(`Is DAI tokenB? ${info.tokenB.toLowerCase() === daiAddress.toLowerCase()}`);

  // Check balances
  const usdtBalance = await usdt.balanceOf(wallet.address);
  const daiBalance = await dai.balanceOf(wallet.address);
  console.log(`\nWallet Balances:`);
  console.log(`USDT: ${ethers.formatUnits(usdtBalance, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiBalance, 18)}`);

  // Check allowances
  const usdtAllowance = await usdt.allowance(wallet.address, factoryAddress);
  const daiAllowance = await dai.allowance(wallet.address, factoryAddress);
  console.log(`\nFactory Allowances:`);
  console.log(`USDT: ${ethers.formatUnits(usdtAllowance, 6)}`);
  console.log(`DAI: ${ethers.formatUnits(daiAllowance, 18)}`);

  // Try to initialize with correct token order
  const usdtAmount = ethers.parseUnits("10000", 6);
  const daiAmount = ethers.parseUnits("10000", 18);

  console.log(`\nAttempting initialization...`);
  console.log(`Amount A (for ${info.tokenA}): ${info.tokenA.toLowerCase() === usdtAddress.toLowerCase() ? ethers.formatUnits(usdtAmount, 6) + " USDT" : ethers.formatUnits(daiAmount, 18) + " DAI"}`);
  console.log(`Amount B (for ${info.tokenB}): ${info.tokenB.toLowerCase() === daiAddress.toLowerCase() ? ethers.formatUnits(daiAmount, 18) + " DAI" : ethers.formatUnits(usdtAmount, 6) + " USDT"}`);

  // Determine correct order
  let amountA, amountB;
  if (info.tokenA.toLowerCase() === usdtAddress.toLowerCase()) {
    amountA = usdtAmount;
    amountB = daiAmount;
  } else {
    amountA = daiAmount;
    amountB = usdtAmount;
  }

  console.log(`\nApproving tokens...`);
  await (await usdt.approve(factoryAddress, usdtAmount)).wait();
  console.log(`✅ USDT approved`);
  await (await dai.approve(factoryAddress, daiAmount)).wait();
  console.log(`✅ DAI approved`);

  console.log(`\nInitializing shard...`);
  const tx = await factory.initializeShard(shardAddress, amountA, amountB);
  await tx.wait();
  console.log(`✅ Shard initialized!`);

  // Check reserves
  const reserves = await shard.getReserves();
  console.log(`\nReserves:`);
  console.log(`Reserve A: ${ethers.formatUnits(reserves[0], info.tokenA.toLowerCase() === usdtAddress.toLowerCase() ? 6 : 18)}`);
  console.log(`Reserve B: ${ethers.formatUnits(reserves[1], info.tokenB.toLowerCase() === daiAddress.toLowerCase() ? 18 : 6)}`);
}

main()
  .then(() => {
    console.log("\n✅ Test completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test failed:");
    console.error(error);
    process.exit(1);
  });
