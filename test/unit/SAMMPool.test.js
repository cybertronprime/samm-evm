const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SAMMPool", function () {
  let sammPool;
  let tokenA;
  let tokenB;
  let owner;
  let user1;
  let user2;

  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const INITIAL_LIQUIDITY_A = ethers.parseEther("100000");
  const INITIAL_LIQUIDITY_B = ethers.parseEther("100000");

  // Fee parameters (0.25% trade fee, 0.1% owner fee)
  const TRADE_FEE_NUMERATOR = 25n;
  const TRADE_FEE_DENOMINATOR = 10000n;
  const OWNER_FEE_NUMERATOR = 10n;
  const OWNER_FEE_DENOMINATOR = 10000n;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tokenA = await MockERC20.deploy("Token A", "TKNA", 18);
    tokenB = await MockERC20.deploy("Token B", "TKNB", 18);

    // Deploy SAMM Pool
    const SAMMPool = await ethers.getContractFactory("SAMMPool");
    sammPool = await SAMMPool.deploy(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      "SAMM LP Token",
      "SAMM-LP"
    );

    // Mint tokens to owner
    await tokenA.mint(owner.address, INITIAL_SUPPLY);
    await tokenB.mint(owner.address, INITIAL_SUPPLY);

    // Mint tokens to users
    await tokenA.mint(user1.address, INITIAL_SUPPLY);
    await tokenB.mint(user1.address, INITIAL_SUPPLY);
    await tokenA.mint(user2.address, INITIAL_SUPPLY);
    await tokenB.mint(user2.address, INITIAL_SUPPLY);

    // Approve pool
    await tokenA.approve(await sammPool.getAddress(), INITIAL_SUPPLY);
    await tokenB.approve(await sammPool.getAddress(), INITIAL_SUPPLY);
  });

  describe("Initialization", function () {
    it("should initialize pool with correct tokens", async function () {
      expect(await sammPool.tokenA()).to.equal(await tokenA.getAddress());
      expect(await sammPool.tokenB()).to.equal(await tokenB.getAddress());
    });

    it("should initialize pool with liquidity", async function () {
      await sammPool.initialize(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        INITIAL_LIQUIDITY_A,
        INITIAL_LIQUIDITY_B,
        TRADE_FEE_NUMERATOR,
        TRADE_FEE_DENOMINATOR,
        OWNER_FEE_NUMERATOR,
        OWNER_FEE_DENOMINATOR
      );

      const [reserveA, reserveB] = await sammPool.getReserves();
      expect(reserveA).to.equal(INITIAL_LIQUIDITY_A);
      expect(reserveB).to.equal(INITIAL_LIQUIDITY_B);
    });

    it("should mint LP tokens on initialization", async function () {
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

      const balance = await sammPool.balanceOf(owner.address);
      expect(balance).to.be.gt(0);
    });

    it("should not allow double initialization", async function () {
      await sammPool.initialize(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        INITIAL_LIQUIDITY_A,
        INITIAL_LIQUIDITY_B,
        TRADE_FEE_NUMERATOR,
        TRADE_FEE_DENOMINATOR,
        OWNER_FEE_NUMERATOR,
        OWNER_FEE_DENOMINATOR
      );

      await expect(
        sammPool.initialize(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          INITIAL_LIQUIDITY_A,
          INITIAL_LIQUIDITY_B,
          TRADE_FEE_NUMERATOR,
          TRADE_FEE_DENOMINATOR,
          OWNER_FEE_NUMERATOR,
          OWNER_FEE_DENOMINATOR
        )
      ).to.be.revertedWith("SAMMPool: already initialized");
    });
  });

  describe("SAMM Swap", function () {
    beforeEach(async function () {
      // Initialize pool
      await sammPool.initialize(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        INITIAL_LIQUIDITY_A,
        INITIAL_LIQUIDITY_B,
        TRADE_FEE_NUMERATOR,
        TRADE_FEE_DENOMINATOR,
        OWNER_FEE_NUMERATOR,
        OWNER_FEE_DENOMINATOR
      );

      // Approve tokens for user1
      await tokenA.connect(user1).approve(await sammPool.getAddress(), INITIAL_SUPPLY);
      await tokenB.connect(user1).approve(await sammPool.getAddress(), INITIAL_SUPPLY);
    });

    it("should execute SAMM swap (output-based)", async function () {
      const amountOut = ethers.parseEther("1000");
      const maximalAmountIn = ethers.parseEther("1100");

      const balanceBefore = await tokenB.balanceOf(user1.address);

      await sammPool.connect(user1).swapSAMM(
        amountOut,
        maximalAmountIn,
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        user1.address
      );

      const balanceAfter = await tokenB.balanceOf(user1.address);

      // User should receive exactly amountOut
      expect(balanceAfter - balanceBefore).to.equal(amountOut);
    });

    it("should revert if input exceeds maximalAmountIn", async function () {
      const amountOut = ethers.parseEther("1000");
      const maximalAmountIn = ethers.parseEther("100"); // Too low

      await expect(
        sammPool.connect(user1).swapSAMM(
          amountOut,
          maximalAmountIn,
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          user1.address
        )
      ).to.be.revertedWith("SAMMPool: excessive input amount");
    });

    it("should update reserves correctly", async function () {
      const amountOut = ethers.parseEther("1000");
      const maximalAmountIn = ethers.parseEther("1100");

      const [reserveABefore, reserveBBefore] = await sammPool.getReserves();

      await sammPool.connect(user1).swapSAMM(
        amountOut,
        maximalAmountIn,
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        user1.address
      );

      const [reserveAAfter, reserveBAfter] = await sammPool.getReserves();

      // Reserve A should increase, Reserve B should decrease
      expect(reserveAAfter).to.be.gt(reserveABefore);
      expect(reserveBAfter).to.equal(reserveBBefore - amountOut);
    });

    it("should charge dynamic fees", async function () {
      const amountOut = ethers.parseEther("1000");
      const maximalAmountIn = ethers.parseEther("1100");

      const result = await sammPool.calculateSwapSAMM(
        amountOut,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );

      expect(result.tradeFee).to.be.gt(0);
      expect(result.amountIn).to.be.gt(amountOut); // Input > output due to fees + price impact
    });

    it("should charge higher fees for larger trades", async function () {
      const smallAmountOut = ethers.parseEther("100");
      const largeAmountOut = ethers.parseEther("10000");

      const smallResult = await sammPool.calculateSwapSAMM(
        smallAmountOut,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );

      const largeResult = await sammPool.calculateSwapSAMM(
        largeAmountOut,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );

      // Fee percentage should be higher for larger trade
      const smallFeePercent = (smallResult.tradeFee * 10000n) / smallAmountOut;
      const largeFeePercent = (largeResult.tradeFee * 10000n) / largeAmountOut;

      expect(largeFeePercent).to.be.gt(smallFeePercent);
    });

    it("should maintain invariant after swap", async function () {
      const [reserveABefore, reserveBBefore] = await sammPool.getReserves();
      const invariantBefore = reserveABefore * reserveBBefore;

      const amountOut = ethers.parseEther("1000");
      const maximalAmountIn = ethers.parseEther("1100");

      await sammPool.connect(user1).swapSAMM(
        amountOut,
        maximalAmountIn,
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        user1.address
      );

      const [reserveAAfter, reserveBAfter] = await sammPool.getReserves();
      const invariantAfter = reserveAAfter * reserveBAfter;

      // Invariant should be maintained or increased (favors pool due to fees)
      expect(invariantAfter).to.be.gte(invariantBefore);
    });

    it("should emit SwapSAMM event", async function () {
      const amountOut = ethers.parseEther("1000");
      const maximalAmountIn = ethers.parseEther("1100");

      await expect(
        sammPool.connect(user1).swapSAMM(
          amountOut,
          maximalAmountIn,
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          user1.address
        )
      )
        .to.emit(sammPool, "SwapSAMM")
        .withArgs(
          user1.address,
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          (value) => value > 0n, // amountIn
          amountOut,
          (value) => value > 0n  // fee
        );
    });
  });

  describe("Liquidity Operations", function () {
    beforeEach(async function () {
      await sammPool.initialize(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        INITIAL_LIQUIDITY_A,
        INITIAL_LIQUIDITY_B,
        TRADE_FEE_NUMERATOR,
        TRADE_FEE_DENOMINATOR,
        OWNER_FEE_NUMERATOR,
        OWNER_FEE_DENOMINATOR
      );

      await tokenA.connect(user1).approve(await sammPool.getAddress(), INITIAL_SUPPLY);
      await tokenB.connect(user1).approve(await sammPool.getAddress(), INITIAL_SUPPLY);
    });

    it("should add liquidity", async function () {
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("1000");

      const lpBalanceBefore = await sammPool.balanceOf(user1.address);

      await sammPool.connect(user1).addLiquidity(
        amountA,
        amountB,
        0,
        0,
        user1.address
      );

      const lpBalanceAfter = await sammPool.balanceOf(user1.address);

      expect(lpBalanceAfter).to.be.gt(lpBalanceBefore);
    });

    it("should remove liquidity", async function () {
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("1000");

      await sammPool.connect(user1).addLiquidity(
        amountA,
        amountB,
        0,
        0,
        user1.address
      );

      const lpBalance = await sammPool.balanceOf(user1.address);
      const tokenABefore = await tokenA.balanceOf(user1.address);
      const tokenBBefore = await tokenB.balanceOf(user1.address);

      await sammPool.connect(user1).removeLiquidity(
        lpBalance,
        0,
        0,
        user1.address
      );

      const tokenAAfter = await tokenA.balanceOf(user1.address);
      const tokenBAfter = await tokenB.balanceOf(user1.address);

      expect(tokenAAfter).to.be.gt(tokenABefore);
      expect(tokenBAfter).to.be.gt(tokenBBefore);
    });
  });

  describe("Fee Management", function () {
    beforeEach(async function () {
      await sammPool.initialize(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        INITIAL_LIQUIDITY_A,
        INITIAL_LIQUIDITY_B,
        TRADE_FEE_NUMERATOR,
        TRADE_FEE_DENOMINATOR,
        OWNER_FEE_NUMERATOR,
        OWNER_FEE_DENOMINATOR
      );
    });

    it("should allow owner to update fees", async function () {
      const newTradeFeeNum = 30n;
      const newOwnerFeeNum = 15n;

      await sammPool.updateFees(
        newTradeFeeNum,
        TRADE_FEE_DENOMINATOR,
        newOwnerFeeNum,
        OWNER_FEE_DENOMINATOR
      );

      expect(await sammPool.tradeFeeNumerator()).to.equal(newTradeFeeNum);
      expect(await sammPool.ownerFeeNumerator()).to.equal(newOwnerFeeNum);
    });

    it("should not allow non-owner to update fees", async function () {
      await expect(
        sammPool.connect(user1).updateFees(30n, TRADE_FEE_DENOMINATOR, 15n, OWNER_FEE_DENOMINATOR)
      ).to.be.reverted;
    });

    it("should allow owner to withdraw fees", async function () {
      // Execute some swaps to generate fees
      await tokenA.connect(user1).approve(await sammPool.getAddress(), INITIAL_SUPPLY);
      await tokenB.connect(user1).approve(await sammPool.getAddress(), INITIAL_SUPPLY);

      await sammPool.connect(user1).swapSAMM(
        ethers.parseEther("1000"),
        ethers.parseEther("1100"),
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        user1.address
      );

      const ownerBalanceBefore = await tokenA.balanceOf(owner.address);

      await sammPool.withdrawFees(owner.address);

      const ownerBalanceAfter = await tokenA.balanceOf(owner.address);

      // Owner should receive collected fees
      expect(ownerBalanceAfter).to.be.gt(ownerBalanceBefore);
    });
  });
});
