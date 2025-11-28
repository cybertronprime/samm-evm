const hre = require("hardhat");

async function main() {
  console.log("Deploying SAMM Pool...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // Deploy or get existing token addresses
  // For testnet, you might want to deploy mock tokens
  // For mainnet, use actual token addresses

  let tokenA, tokenB;

  if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
    console.log("\nDeploying mock tokens for local testing...");

    // Deploy MockERC20 tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");

    console.log("Deploying Token A...");
    tokenA = await MockERC20.deploy("Token A", "TKNA", 18);
    await tokenA.waitForDeployment();
    console.log("Token A deployed to:", await tokenA.getAddress());

    console.log("Deploying Token B...");
    tokenB = await MockERC20.deploy("Token B", "TKNB", 18);
    await tokenB.waitForDeployment();
    console.log("Token B deployed to:", await tokenB.getAddress());

    // Mint initial tokens to deployer
    const MINT_AMOUNT = ethers.parseEther("1000000");
    console.log("\nMinting initial tokens...");
    await tokenA.mint(deployer.address, MINT_AMOUNT);
    await tokenB.mint(deployer.address, MINT_AMOUNT);
    console.log("Minted 1,000,000 tokens to deployer");
  } else {
    // For testnets/mainnet, specify token addresses
    console.log("\nUsing existing tokens (update addresses as needed):");
    const tokenAAddress = process.env.TOKEN_A_ADDRESS;
    const tokenBAddress = process.env.TOKEN_B_ADDRESS;

    if (!tokenAAddress || !tokenBAddress) {
      throw new Error("Please set TOKEN_A_ADDRESS and TOKEN_B_ADDRESS in .env file");
    }

    tokenA = await ethers.getContractAt("IERC20", tokenAAddress);
    tokenB = await ethers.getContractAt("IERC20", tokenBAddress);
    console.log("Token A:", tokenAAddress);
    console.log("Token B:", tokenBAddress);
  }

  // Deploy SAMMPool
  console.log("\nDeploying SAMM Pool...");
  const SAMMPool = await ethers.getContractFactory("SAMMPool");
  const sammPool = await SAMMPool.deploy(
    await tokenA.getAddress(),
    await tokenB.getAddress(),
    "SAMM LP Token",
    "SAMM-LP"
  );

  await sammPool.waitForDeployment();
  const poolAddress = await sammPool.getAddress();
  console.log("SAMM Pool deployed to:", poolAddress);

  // Initialize pool (optional, can be done separately)
  if (process.env.AUTO_INITIALIZE === "true") {
    console.log("\nInitializing pool with liquidity...");

    const INITIAL_LIQUIDITY_A = ethers.parseEther(process.env.INITIAL_LIQUIDITY_A || "10000");
    const INITIAL_LIQUIDITY_B = ethers.parseEther(process.env.INITIAL_LIQUIDITY_B || "10000");
    const TRADE_FEE_NUMERATOR = process.env.TRADE_FEE_NUMERATOR || "25"; // 0.25%
    const TRADE_FEE_DENOMINATOR = process.env.TRADE_FEE_DENOMINATOR || "10000";
    const OWNER_FEE_NUMERATOR = process.env.OWNER_FEE_NUMERATOR || "10"; // 0.1%
    const OWNER_FEE_DENOMINATOR = process.env.OWNER_FEE_DENOMINATOR || "10000";

    // Approve tokens
    console.log("Approving tokens...");
    await tokenA.approve(poolAddress, INITIAL_LIQUIDITY_A);
    await tokenB.approve(poolAddress, INITIAL_LIQUIDITY_B);

    // Initialize
    console.log("Initializing pool...");
    const tx = await sammPool.initialize(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      INITIAL_LIQUIDITY_A,
      INITIAL_LIQUIDITY_B,
      TRADE_FEE_NUMERATOR,
      TRADE_FEE_DENOMINATOR,
      OWNER_FEE_NUMERATOR,
      OWNER_FEE_DENOMINATOR
    );

    await tx.wait();
    console.log("Pool initialized!");

    const [reserveA, reserveB] = await sammPool.getReserves();
    console.log("\nPool State:");
    console.log("Reserve A:", ethers.formatEther(reserveA));
    console.log("Reserve B:", ethers.formatEther(reserveB));
    console.log("LP Tokens:", ethers.formatEther(await sammPool.balanceOf(deployer.address)));
  }

  // Save deployment info
  console.log("\n=== Deployment Summary ===");
  console.log("Token A:", await tokenA.getAddress());
  console.log("Token B:", await tokenB.getAddress());
  console.log("SAMM Pool:", poolAddress);
  console.log("Deployer:", deployer.address);
  console.log("Network:", hre.network.name);
  console.log("=========================\n");

  // Save to file for reference
  const fs = require("fs");
  const deploymentInfo = {
    network: hre.network.name,
    deployer: deployer.address,
    tokenA: await tokenA.getAddress(),
    tokenB: await tokenB.getAddress(),
    sammPool: poolAddress,
    timestamp: new Date().toISOString(),
  };

  const filename = `deployment-${hre.network.name}-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
  console.log("Deployment info saved to:", filename);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
