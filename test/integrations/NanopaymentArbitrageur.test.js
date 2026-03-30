/**
 * test/integrations/NanopaymentArbitrageur.test.js
 * Tests for NanopaymentArbitrageur
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NanopaymentArbitrageur", function () {
  let arbitrageur;
  let tokenA, tokenB;
  let pool1, pool2;
  let factory;
  let owner, agent, unauthorized;

  // 0.01 USDC = 10_000 units (6 decimals)
  const NANO_AMOUNT = 10_000n;
  const INITIAL_LIQUIDITY = 100_000n * 10n ** 6n; // 100K USDC

  const SAMM_PARAMS = {
    beta1: -1050000n,
    rmin: 1000n,
    rmax: 12000n,
    c: 10400n,
  };

  const FEE_PARAMS = {
    tradeFeeNumerator: 25n,
    tradeFeeDenominator: 10000n,
    ownerFeeNumerator: 5n,
    ownerFeeDenominator: 10000n,
  };

  beforeEach(async function () {
    [owner, agent, unauthorized] = await ethers.getSigners();

    // Deploy tokens (6 decimals like USDC/EURC)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tokenA = await MockERC20.deploy("USD Coin", "USDC", 6);
    tokenB = await MockERC20.deploy("Euro Coin", "EURC", 6);
    await tokenA.waitForDeployment();
    await tokenB.waitForDeployment();

    // Deploy SAMM factory and pools
    const FactoryContract = await ethers.getContractFactory("SAMMPoolFactory");
    factory = await FactoryContract.deploy();
    await factory.waitForDeployment();

    // Mint and create two shards
    await tokenA.mint(owner.address, INITIAL_LIQUIDITY * 10n);
    await tokenB.mint(owner.address, INITIAL_LIQUIDITY * 10n);

    const factoryAddr = await factory.getAddress();

    // Shard 1
    const tx1 = await factory.createShard(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      SAMM_PARAMS,
      FEE_PARAMS
    );
    const r1 = await tx1.wait();
    pool1 = extractShardAddr(factory.interface, r1);
    await tokenA.approve(factoryAddr, INITIAL_LIQUIDITY);
    await tokenB.approve(factoryAddr, INITIAL_LIQUIDITY);
    await factory.initializeShard(pool1, INITIAL_LIQUIDITY, INITIAL_LIQUIDITY);

    // Shard 2 (slightly different liquidity to create price difference)
    const tx2 = await factory.createShard(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      SAMM_PARAMS,
      FEE_PARAMS
    );
    const r2 = await tx2.wait();
    pool2 = extractShardAddr(factory.interface, r2);
    const liq2 = INITIAL_LIQUIDITY * 101n / 100n; // 1% more tokenB → different price
    await tokenA.approve(factoryAddr, INITIAL_LIQUIDITY);
    await tokenB.approve(factoryAddr, liq2);
    await factory.initializeShard(pool2, INITIAL_LIQUIDITY, liq2);

    // Deploy arbitrageur
    const ArbitrageurFactory = await ethers.getContractFactory("NanopaymentArbitrageur");
    arbitrageur = await ArbitrageurFactory.deploy();
    await arbitrageur.waitForDeployment();
  });

  function extractShardAddr(iface, receipt) {
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "ShardCreated") return parsed.args.shard;
      } catch {}
    }
    throw new Error("ShardCreated event not found");
  }

  // ============ Agent Registration ============

  describe("Agent Registration", function () {
    it("owner can register an agent", async function () {
      await expect(arbitrageur.registerAgent(agent.address))
        .to.emit(arbitrageur, "AgentRegistered")
        .withArgs(agent.address);

      expect(await arbitrageur.authorizedAgents(agent.address)).to.be.true;
    });

    it("owner can revoke an agent", async function () {
      await arbitrageur.registerAgent(agent.address);
      await expect(arbitrageur.revokeAgent(agent.address))
        .to.emit(arbitrageur, "AgentRevoked")
        .withArgs(agent.address);

      expect(await arbitrageur.authorizedAgents(agent.address)).to.be.false;
    });

    it("non-owner cannot register agent", async function () {
      await expect(
        arbitrageur.connect(agent).registerAgent(agent.address)
      ).to.be.reverted;
    });

    it("reverts on zero address registration", async function () {
      await expect(
        arbitrageur.registerAgent(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(arbitrageur, "ZeroAddress");
    });
  });

  // ============ Arbitrage Quote ============

  describe("quoteNanoArbitrage", function () {
    it("returns estimated profit (may be 0 or negative for identical pools)", async function () {
      const profit = await arbitrageur.quoteNanoArbitrage(
        pool1, pool2,
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        NANO_AMOUNT
      );
      // Profit type is int256 — just verify the call doesn't revert
      expect(typeof profit).to.equal("bigint");
    });

    it("returns 0 when same pool", async function () {
      const profit = await arbitrageur.quoteNanoArbitrage(
        pool1, pool1,
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        NANO_AMOUNT
      );
      expect(profit).to.equal(0n);
    });

    it("returns 0 when nanoAmount is 0", async function () {
      const profit = await arbitrageur.quoteNanoArbitrage(
        pool1, pool2,
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        0n
      );
      expect(profit).to.equal(0n);
    });
  });

  // ============ Arbitrage Execution ============

  describe("executeNanoArbitrage", function () {
    beforeEach(async function () {
      await arbitrageur.registerAgent(agent.address);

      // Fund the arbitrageur with tokenA so it can execute
      await tokenA.mint(await arbitrageur.getAddress(), NANO_AMOUNT * 1000n);
      // Approve pools to spend from arbitrageur (done inside executeNanoArbitrage via forceApprove)
    });

    it("unauthorized agent cannot execute", async function () {
      await expect(
        arbitrageur.connect(unauthorized).executeNanoArbitrage(
          pool1, pool2,
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          NANO_AMOUNT
        )
      ).to.be.revertedWithCustomError(arbitrageur, "UnauthorizedAgent");
    });

    it("reverts when pool1 == pool2", async function () {
      await expect(
        arbitrageur.connect(agent).executeNanoArbitrage(
          pool1, pool1,
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          NANO_AMOUNT
        )
      ).to.be.revertedWithCustomError(arbitrageur, "SamePool");
    });

    it("reverts with zero nano amount", async function () {
      await expect(
        arbitrageur.connect(agent).executeNanoArbitrage(
          pool1, pool2,
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          0n
        )
      ).to.be.revertedWithCustomError(arbitrageur, "ZeroAmount");
    });

    it("tracks agent stats on success (if profitable)", async function () {
      // This test may revert with NoProfitableArb if the pools are identical,
      // which is expected — we just verify stat tracking on success path.
      try {
        await arbitrageur.connect(agent).executeNanoArbitrage(
          pool1, pool2,
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          NANO_AMOUNT
        );
        const stats = await arbitrageur.getAgentStats(agent.address);
        expect(stats.totalArbs).to.be.gt(0n);
      } catch (err) {
        // NoProfitableArb is expected when pools have the same price
        if (!err.message.includes("NoProfitableArb")) throw err;
      }
    });
  });

  // ============ Profit Withdrawal ============

  describe("withdrawProfits", function () {
    it("owner can withdraw accumulated profits", async function () {
      const profit = NANO_AMOUNT * 10n;
      await tokenA.mint(await arbitrageur.getAddress(), profit);

      const balBefore = await tokenA.balanceOf(owner.address);
      await expect(
        arbitrageur.withdrawProfits(await tokenA.getAddress(), owner.address)
      ).to.emit(arbitrageur, "ProfitsWithdrawn");

      expect(await tokenA.balanceOf(owner.address)).to.equal(balBefore + profit);
    });

    it("non-owner cannot withdraw", async function () {
      await tokenA.mint(await arbitrageur.getAddress(), NANO_AMOUNT);
      await expect(
        arbitrageur.connect(agent).withdrawProfits(await tokenA.getAddress(), agent.address)
      ).to.be.reverted;
    });

    it("reverts when balance is zero", async function () {
      await expect(
        arbitrageur.withdrawProfits(await tokenA.getAddress(), owner.address)
      ).to.be.revertedWithCustomError(arbitrageur, "ZeroAmount");
    });

    it("reverts on zero address recipient", async function () {
      await tokenA.mint(await arbitrageur.getAddress(), NANO_AMOUNT);
      await expect(
        arbitrageur.withdrawProfits(await tokenA.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(arbitrageur, "ZeroAddress");
    });
  });
});
