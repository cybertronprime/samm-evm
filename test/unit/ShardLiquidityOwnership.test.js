const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Shard liquidity ownership", function () {
  let owner;
  let tokenA;
  let tokenB;
  let factory;
  let orchestrator;

  const TRADE_FEE_NUMERATOR = 25n;
  const TRADE_FEE_DENOMINATOR = 10000n;
  const OWNER_FEE_NUMERATOR = 5n;
  const OWNER_FEE_DENOMINATOR = 10000n;
  const INITIAL_AMOUNT_A = ethers.parseEther("1000");
  const INITIAL_AMOUNT_B = ethers.parseEther("1000");

  beforeEach(async function () {
    [owner] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
    tokenA = await MockERC20.deploy("Token A", "TKNA", 18);
    tokenB = await MockERC20.deploy("Token B", "TKNB", 18);

    const Factory = await ethers.getContractFactory("SAMMPoolFactory");
    factory = await Factory.deploy();

    const Orchestrator = await ethers.getContractFactory("DynamicShardOrchestrator");
    orchestrator = await Orchestrator.deploy(await factory.getAddress());

    await tokenA.mint(owner.address, ethers.parseEther("100000"));
    await tokenB.mint(owner.address, ethers.parseEther("100000"));
  });

  it("mints initial LP to the shard creator when initialized through the factory", async function () {
    const createTx = await factory.createShard(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      -250000n,
      100n,
      2500n,
      9600n,
      TRADE_FEE_NUMERATOR,
      TRADE_FEE_DENOMINATOR,
      OWNER_FEE_NUMERATOR,
      OWNER_FEE_DENOMINATOR
    );
    const receipt = await createTx.wait();
    const shardCreated = receipt.logs.find((log) => {
      try {
        return factory.interface.parseLog(log)?.name === "ShardCreated";
      } catch {
        return false;
      }
    });
    const shardAddress = factory.interface.parseLog(shardCreated).args.shard;

    await tokenA.approve(await factory.getAddress(), INITIAL_AMOUNT_A);
    await tokenB.approve(await factory.getAddress(), INITIAL_AMOUNT_B);
    await factory.initializeShard(shardAddress, INITIAL_AMOUNT_A, INITIAL_AMOUNT_B);

    const pool = await ethers.getContractAt("SAMMPool", shardAddress);
    expect(await pool.balanceOf(owner.address)).to.be.gt(0n);
    expect(await pool.balanceOf(await factory.getAddress())).to.equal(0n);
  });

  it("mints initial LP to the orchestrator for orchestrator-managed shards", async function () {
    await tokenA.approve(await orchestrator.getAddress(), INITIAL_AMOUNT_A);
    await tokenB.approve(await orchestrator.getAddress(), INITIAL_AMOUNT_B);

    const tx = await orchestrator.createAndFundShard(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      INITIAL_AMOUNT_A,
      INITIAL_AMOUNT_B
    );
    const receipt = await tx.wait();

    const shardCreated = receipt.logs.find((log) => {
      try {
        return factory.interface.parseLog(log)?.name === "ShardCreated";
      } catch {
        return false;
      }
    });
    const shardAddress = factory.interface.parseLog(shardCreated).args.shard;

    const pool = await ethers.getContractAt("SAMMPool", shardAddress);
    expect(await pool.balanceOf(await orchestrator.getAddress())).to.be.gt(0n);
    expect(await pool.balanceOf(owner.address)).to.equal(0n);
    expect(await pool.balanceOf(await factory.getAddress())).to.equal(0n);
  });
});
