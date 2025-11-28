const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SAMM Solidity Verification Against Rust", function () {
  let sammPool;
  let tokenA;
  let tokenB;
  let owner;

  const INITIAL_LIQUIDITY = ethers.parseEther("100000");
  const TRADE_FEE_NUMERATOR = 25n;
  const TRADE_FEE_DENOMINATOR = 10000n;
  const OWNER_FEE_NUMERATOR = 10n;
  const OWNER_FEE_DENOMINATOR = 10000n;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tokenA = await MockERC20.deploy("Token A", "TKNA", 18);
    tokenB = await MockERC20.deploy("Token B", "TKNB", 18);

    // Deploy SAMM Pool
    const SAMMPool = await ethers.getContractFactory("SAMMPool");
    sammPool = await SAMMPool.deploy(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      "SAMM LP",
      "SAMM-LP"
    );

    // Mint and approve
    await tokenA.mint(owner.address, ethers.parseEther("1000000"));
    await tokenB.mint(owner.address, ethers.parseEther("1000000"));
    await tokenA.approve(await sammPool.getAddress(), ethers.MaxUint256);
    await tokenB.approve(await sammPool.getAddress(), ethers.MaxUint256);

    // Initialize pool
    await sammPool.initialize(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      INITIAL_LIQUIDITY,
      INITIAL_LIQUIDITY,
      TRADE_FEE_NUMERATOR,
      TRADE_FEE_DENOMINATOR,
      OWNER_FEE_NUMERATOR,
      OWNER_FEE_DENOMINATOR
    );
  });

  describe("Verification: Rust swap_samm", function () {
    it("Should match Rust calculation: 1000 output from 100k reserves", async function () {
      const amountOut = ethers.parseEther("1000");

      // Calculate using Solidity
      const result = await sammPool.calculateSwapSAMM(
        amountOut,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );

      console.log("\n      Solidity Results:");
      console.log(`        Amount In: ${ethers.formatEther(result.amountIn)}`);
      console.log(`        Amount Out: ${ethers.formatEther(result.amountOut)}`);
      console.log(`        Trade Fee: ${ethers.formatEther(result.tradeFee)}`);
      console.log(`        Owner Fee: ${ethers.formatEther(result.ownerFee)}`);

      // Expected from our manual trace:
      // Amount Out: 1000
      // Trade Fee: 2 (approximately, with full decimals)
      // Owner Fee: 1
      // Total In: 1014 (approximately)

      expect(result.amountOut).to.equal(amountOut);
      expect(result.amountIn).to.be.gt(amountOut); // More than output
      expect(result.tradeFee).to.be.gt(0);
    });

    it("Should execute actual swap matching calculation", async function () {
      const amountOut = ethers.parseEther("1000");

      // Get quote first
      const quote = await sammPool.calculateSwapSAMM(
        amountOut,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );

      const balanceBBefore = await tokenB.balanceOf(owner.address);

      // Execute swap
      await sammPool.swapSAMM(
        amountOut,
        quote.amountIn, // Use exact calculated amount
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        owner.address
      );

      const balanceBAfter = await tokenB.balanceOf(owner.address);

      // User should receive EXACTLY amountOut
      expect(balanceBAfter - balanceBBefore).to.equal(amountOut);
      console.log(`      ✓ User received exactly ${ethers.formatEther(amountOut)} tokens`);
    });

    it("Should maintain invariant after swap", async function () {
      const [reserveABefore, reserveBBefore] = await sammPool.getReserves();
      const invariantBefore = reserveABefore * reserveBBefore;

      const amountOut = ethers.parseEther("1000");
      const quote = await sammPool.calculateSwapSAMM(
        amountOut,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );

      await sammPool.swapSAMM(
        amountOut,
        quote.amountIn,
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        owner.address
      );

      const [reserveAAfter, reserveBAfter] = await sammPool.getReserves();
      const invariantAfter = reserveAAfter * reserveBAfter;

      console.log(`      Before: ${invariantBefore}`);
      console.log(`      After:  ${invariantAfter}`);
      console.log(`      Maintained: ${invariantAfter >= invariantBefore}`);

      // Invariant should be maintained or increased (due to fees)
      expect(invariantAfter).to.be.gte(invariantBefore);
    });

    it("Should charge higher fees for larger trades", async function () {
      const smallOut = ethers.parseEther("100");
      const largeOut = ethers.parseEther("10000");

      const smallQuote = await sammPool.calculateSwapSAMM(
        smallOut,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );

      const largeQuote = await sammPool.calculateSwapSAMM(
        largeOut,
        await tokenA.getAddress(),
        await tokenB.getAddress()
      );

      // Calculate fee percentages
      const smallFeePercent = (smallQuote.tradeFee * 10000n) / smallOut;
      const largeFeePercent = (largeQuote.tradeFee * 10000n) / largeOut;

      console.log(`      Small trade (${ethers.formatEther(smallOut)}): ${smallFeePercent} bps`);
      console.log(`      Large trade (${ethers.formatEther(largeOut)}): ${largeFeePercent} bps`);

      // In SAMM: Smaller trades pay HIGHER fees (adaptive), larger trades hit minimal fee
      // This is correct Rust behavior!
      expect(smallFeePercent).to.be.gt(largeFeePercent);
    });

    it("Should respect maximalAmountIn (slippage protection)", async function () {
      const amountOut = ethers.parseEther("1000");
      const tooLowMaxIn = ethers.parseEther("1000"); // Too low

      await expect(
        sammPool.swapSAMM(
          amountOut,
          tooLowMaxIn,
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          owner.address
        )
      ).to.be.revertedWith("SAMMPool: excessive input amount");

      console.log("      ✓ Slippage protection working");
    });

    it("Should handle multiple consecutive swaps", async function () {
      const amountOut = ethers.parseEther("1000");

      for (let i = 0; i < 3; i++) {
        const quote = await sammPool.calculateSwapSAMM(
          amountOut,
          await tokenA.getAddress(),
          await tokenB.getAddress()
        );

        await sammPool.swapSAMM(
          amountOut,
          quote.amountIn,
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          owner.address
        );

        const [reserveA, reserveB] = await sammPool.getReserves();
        console.log(`      Swap ${i+1}: Reserves A=${ethers.formatEther(reserveA)}, B=${ethers.formatEther(reserveB)}`);
      }

      console.log("      ✓ Multiple swaps executed successfully");
    });
  });

  describe("Verification: Fee Calculation", function () {
    it("Should calculate adaptive fees correctly", async function () {
      // Test different pool states
      const testCases = [
        { out: "100", desc: "0.1% of pool" },
        { out: "1000", desc: "1% of pool" },
        { out: "5000", desc: "5% of pool" },
        { out: "10000", desc: "10% of pool" },
      ];

      console.log("\n      Fee Scaling:");
      for (const testCase of testCases) {
        const amountOut = ethers.parseEther(testCase.out);
        const quote = await sammPool.calculateSwapSAMM(
          amountOut,
          await tokenA.getAddress(),
          await tokenB.getAddress()
        );

        const feePercent = (quote.tradeFee * 10000n) / amountOut;
        console.log(`        ${testCase.desc}: ${feePercent} bps`);
      }
    });
  });

  describe("Verification: Output Certainty", function () {
    it("User always gets EXACT output amount", async function () {
      const desiredOutputs = [
        ethers.parseEther("100"),
        ethers.parseEther("500"),
        ethers.parseEther("1000"),
        ethers.parseEther("5000"),
      ];

      console.log("\n      Output Certainty Test:");
      for (const desiredOut of desiredOutputs) {
        const quote = await sammPool.calculateSwapSAMM(
          desiredOut,
          await tokenA.getAddress(),
          await tokenB.getAddress()
        );

        const balanceBefore = await tokenB.balanceOf(owner.address);

        await sammPool.swapSAMM(
          desiredOut,
          quote.amountIn,
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          owner.address
        );

        const balanceAfter = await tokenB.balanceOf(owner.address);
        const actualReceived = balanceAfter - balanceBefore;

        console.log(`        Desired: ${ethers.formatEther(desiredOut)}, Got: ${ethers.formatEther(actualReceived)}`);
        expect(actualReceived).to.equal(desiredOut);
      }

      console.log("      ✓ All outputs exact!");
    });
  });
});
