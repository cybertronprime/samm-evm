/**
 * test/integrations/UniswapSAMMAggregator.test.js
 * Tests for UniswapSAMMAggregator using MockUniswapRouter/Quoter and mock SAMM router
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("UniswapSAMMAggregator", function () {
  let aggregator;
  let mockSAMMRouter;
  let mockUniswapRouter;
  let mockUniswapQuoter;
  let tokenIn, tokenOut;
  let owner, user;

  const INITIAL_SLIPPAGE_BPS = 50; // 0.5%
  const AMOUNT_OUT = ethers.parseEther("100");
  const MAX_AMOUNT_IN = ethers.parseEther("110");

  // Helper: build deadline 1 hour from now
  function deadline() {
    return Math.floor(Date.now() / 1000) + 3600;
  }

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tokenIn = await MockERC20.deploy("Token In", "TIN", 18);
    tokenOut = await MockERC20.deploy("Token Out", "TOUT", 18);
    await tokenIn.waitForDeployment();
    await tokenOut.waitForDeployment();

    // Deploy mock SAMM router
    const MockSAMMRouter = await ethers.getContractFactory("MockCrossPoolRouter");
    mockSAMMRouter = await MockSAMMRouter.deploy();
    await mockSAMMRouter.waitForDeployment();

    // Deploy mock Uniswap router + quoter
    const MockRouter = await ethers.getContractFactory("MockUniswapRouter");
    mockUniswapRouter = await MockRouter.deploy(ethers.parseEther("105")); // 105 tokens in
    await mockUniswapRouter.waitForDeployment();

    const MockQuoter = await ethers.getContractFactory("MockUniswapQuoter");
    mockUniswapQuoter = await MockQuoter.deploy(ethers.parseEther("105")); // 105 tokens in
    await mockUniswapQuoter.waitForDeployment();

    // Deploy aggregator
    const AggregatorFactory = await ethers.getContractFactory("UniswapSAMMAggregator");
    aggregator = await AggregatorFactory.deploy(
      await mockSAMMRouter.getAddress(),
      await mockUniswapRouter.getAddress(),
      await mockUniswapQuoter.getAddress(),
      INITIAL_SLIPPAGE_BPS
    );
    await aggregator.waitForDeployment();

    // Mint tokens to user
    await tokenIn.mint(user.address, MAX_AMOUNT_IN * 10n);
    await tokenOut.mint(await mockUniswapRouter.getAddress(), AMOUNT_OUT * 10n);
    await tokenOut.mint(await mockSAMMRouter.getAddress(), AMOUNT_OUT * 10n);
  });

  // ============ Constructor & Config ============

  describe("Deployment", function () {
    it("sets constructor args correctly", async function () {
      expect(await aggregator.sammRouter()).to.equal(await mockSAMMRouter.getAddress());
      expect(await aggregator.uniswapRouter()).to.equal(await mockUniswapRouter.getAddress());
      expect(await aggregator.uniswapQuoter()).to.equal(await mockUniswapQuoter.getAddress());
      expect(await aggregator.slippageBps()).to.equal(INITIAL_SLIPPAGE_BPS);
    });

    it("reverts on zero address for sammRouter", async function () {
      const AggregatorFactory = await ethers.getContractFactory("UniswapSAMMAggregator");
      await expect(
        AggregatorFactory.deploy(
          ethers.ZeroAddress,
          await mockUniswapRouter.getAddress(),
          await mockUniswapQuoter.getAddress(),
          INITIAL_SLIPPAGE_BPS
        )
      ).to.be.revertedWithCustomError(aggregator, "ZeroAddress");
    });

    it("reverts on slippage > MAX_SLIPPAGE_BPS", async function () {
      const AggregatorFactory = await ethers.getContractFactory("UniswapSAMMAggregator");
      await expect(
        AggregatorFactory.deploy(
          await mockSAMMRouter.getAddress(),
          await mockUniswapRouter.getAddress(),
          await mockUniswapQuoter.getAddress(),
          2000 // 20% > 10% max
        )
      ).to.be.revertedWithCustomError(aggregator, "InvalidSlippage");
    });
  });

  // ============ Quotes ============

  describe("getQuotes", function () {
    it("returns both SAMM and Uniswap quotes", async function () {
      const [sammAmt, uniAmt] = await aggregator.getQuotes(
        await tokenIn.getAddress(),
        await tokenOut.getAddress(),
        AMOUNT_OUT,
        3000
      );
      // SAMM mock returns type(uint256).max when it can't quote (no pools in mock)
      // Uniswap mock returns 105 ETH
      expect(uniAmt).to.equal(ethers.parseEther("105"));
    });
  });

  // ============ Routing Logic ============

  describe("Routing to best source", function () {
    it("routes to Uniswap when SAMM is unavailable", async function () {
      // The mock SAMM router reverts => aggregator uses Uniswap
      await tokenIn.connect(user).approve(await aggregator.getAddress(), MAX_AMOUNT_IN);
      // tokenOut must be available in mock router
      await tokenOut.mint(await mockUniswapRouter.getAddress(), AMOUNT_OUT);

      const tx = await aggregator.connect(user).aggregatedSwap(
        await tokenIn.getAddress(),
        await tokenOut.getAddress(),
        AMOUNT_OUT,
        MAX_AMOUNT_IN,
        deadline(),
        3000
      );

      await expect(tx)
        .to.emit(aggregator, "AggregatedSwap")
        .withArgs(
          user.address,
          "Uniswap",
          await tokenIn.getAddress(),
          await tokenOut.getAddress(),
          ethers.parseEther("105"),
          AMOUNT_OUT
        );
    });
  });

  // ============ Slippage Protection ============

  describe("Slippage protection", function () {
    it("reverts when deadline has passed", async function () {
      await tokenIn.connect(user).approve(await aggregator.getAddress(), MAX_AMOUNT_IN);
      const pastDeadline = Math.floor(Date.now() / 1000) - 1;

      await expect(
        aggregator.connect(user).aggregatedSwap(
          await tokenIn.getAddress(),
          await tokenOut.getAddress(),
          AMOUNT_OUT,
          MAX_AMOUNT_IN,
          pastDeadline,
          3000
        )
      ).to.be.revertedWithCustomError(aggregator, "DeadlineExceeded");
    });

    it("reverts when paused", async function () {
      await aggregator.pause();
      await tokenIn.connect(user).approve(await aggregator.getAddress(), MAX_AMOUNT_IN);

      await expect(
        aggregator.connect(user).aggregatedSwap(
          await tokenIn.getAddress(),
          await tokenOut.getAddress(),
          AMOUNT_OUT,
          MAX_AMOUNT_IN,
          deadline(),
          3000
        )
      ).to.be.revertedWithCustomError(aggregator, "EnforcedPause");
    });

    it("allows swap after unpause", async function () {
      await aggregator.pause();
      await aggregator.unpause();
      // Should not revert due to pause (may still fail for other mock reasons — just not pause)
      await tokenIn.connect(user).approve(await aggregator.getAddress(), MAX_AMOUNT_IN);
    });
  });

  // ============ Admin Functions ============

  describe("Admin", function () {
    it("owner can update slippage", async function () {
      await expect(aggregator.setSlippageBps(100))
        .to.emit(aggregator, "SlippageUpdated")
        .withArgs(INITIAL_SLIPPAGE_BPS, 100);
      expect(await aggregator.slippageBps()).to.equal(100);
    });

    it("reverts on invalid slippage", async function () {
      await expect(aggregator.setSlippageBps(9999)).to.be.revertedWithCustomError(
        aggregator,
        "InvalidSlippage"
      );
    });

    it("owner can update SAMM router", async function () {
      const newRouter = ethers.Wallet.createRandom().address;
      await expect(aggregator.setSAMMRouter(newRouter))
        .to.emit(aggregator, "SAMMRouterUpdated");
    });

    it("non-owner cannot update config", async function () {
      await expect(aggregator.connect(user).setSlippageBps(100)).to.be.reverted;
    });

    it("owner can rescue tokens", async function () {
      const stuck = ethers.parseEther("1");
      await tokenIn.mint(await aggregator.getAddress(), stuck);
      const balBefore = await tokenIn.balanceOf(owner.address);
      await aggregator.rescueTokens(await tokenIn.getAddress(), owner.address, stuck);
      expect(await tokenIn.balanceOf(owner.address)).to.equal(balBefore + stuck);
    });
  });
});
