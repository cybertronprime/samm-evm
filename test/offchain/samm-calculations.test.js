const { expect } = require("chai");

/**
 * Offchain SAMM calculations test
 * Tests the mathematical formulas independently of Solidity contracts
 * This ensures our logic matches the Rust implementation
 */
describe("SAMM Offchain Calculations", function () {

  /**
   * Calculate SAMM fee using the Rust algorithm
   * From fees.rs:47-78
   */
  function calculateFeeSAMM(outputAmount, outputReserve, inputReserve, feeNumerator, feeDenominator) {
    if (feeNumerator === 0n || outputAmount === 0n) {
      return 0n;
    }

    const maxFeeNumerator = feeNumerator * 5n;
    const tmp = (outputAmount * 12n * feeDenominator) / (10n * outputReserve);

    if (tmp + feeNumerator > maxFeeNumerator) {
      // Minimal fee
      const fee = (outputAmount * feeNumerator * inputReserve) / (outputReserve * feeDenominator);
      return fee;
    } else {
      // Adaptive fee
      const fee = (outputAmount * (maxFeeNumerator - tmp) * inputReserve) / (outputReserve * feeDenominator);
      return fee;
    }
  }

  /**
   * Calculate input needed for desired output using constant product
   * From constant_product.rs:50-70 (swap_revert)
   */
  function swapRevert(destinationAmount, swapSourceAmount, swapDestinationAmount) {
    const invariant = swapSourceAmount * swapDestinationAmount;
    const newSwapDestinationAmount = swapDestinationAmount - destinationAmount;

    let newSwapSourceAmount = invariant / newSwapDestinationAmount;

    // Ceiling division
    if (newSwapSourceAmount * newSwapDestinationAmount !== invariant) {
      newSwapSourceAmount += 1n;
    }

    const sourceAmountSwapped = newSwapSourceAmount - swapSourceAmount;
    const destinationAmountSwapped = destinationAmount;

    return { sourceAmountSwapped, destinationAmountSwapped };
  }

  /**
   * Full SAMM swap calculation
   * From base.rs:71-106 (swap_samm)
   */
  function swapSAMM(
    outputAmount,
    swapSourceAmount,
    swapDestinationAmount,
    tradeFeeNumerator,
    tradeFeeDenominator,
    ownerFeeNumerator,
    ownerFeeDenominator
  ) {
    // Calculate trade fee
    const tradeFee = calculateFeeSAMM(
      outputAmount,
      swapDestinationAmount,
      swapSourceAmount,
      tradeFeeNumerator,
      tradeFeeDenominator
    );

    // Calculate owner fee
    const ownerFee = (outputAmount * ownerFeeNumerator) / ownerFeeDenominator;

    // Calculate input needed (without fees)
    const { sourceAmountSwapped } = swapRevert(
      outputAmount,
      swapSourceAmount,
      swapDestinationAmount
    );

    // Total input = base amount + fees
    const totalAmountIn = sourceAmountSwapped + tradeFee + ownerFee;

    return {
      amountIn: totalAmountIn,
      amountOut: outputAmount,
      tradeFee,
      ownerFee,
    };
  }

  describe("Calculate Fee SAMM", function () {
    it("should return 0 for zero fee numerator", function () {
      const fee = calculateFeeSAMM(
        1000n,    // outputAmount
        10000n,   // outputReserve
        10000n,   // inputReserve
        0n,       // feeNumerator
        10000n    // feeDenominator
      );
      expect(fee).to.equal(0n);
    });

    it("should return 0 for zero output amount", function () {
      const fee = calculateFeeSAMM(
        0n,       // outputAmount
        10000n,   // outputReserve
        10000n,   // inputReserve
        25n,      // feeNumerator (0.25%)
        10000n    // feeDenominator
      );
      expect(fee).to.equal(0n);
    });

    it("should calculate minimal fee for large pool", function () {
      // Large pool, small trade -> minimal fee
      const fee = calculateFeeSAMM(
        100n,           // outputAmount (0.1% of pool)
        100000n,        // outputReserve (large pool)
        100000n,        // inputReserve
        25n,            // feeNumerator (0.25%)
        10000n          // feeDenominator
      );

      // Expected: (100 * 25 * 100000) / (100000 * 10000) = 0.25
      const expected = (100n * 25n * 100000n) / (100000n * 10000n);
      expect(fee).to.equal(expected);
    });

    it("should calculate adaptive fee for smaller pool", function () {
      // Smaller pool, larger trade -> adaptive fee
      const fee = calculateFeeSAMM(
        1000n,          // outputAmount (10% of pool)
        10000n,         // outputReserve
        10000n,         // inputReserve
        25n,            // feeNumerator (0.25%)
        10000n          // feeDenominator
      );

      // Calculate expected adaptive fee
      const maxFeeNumerator = 25n * 5n; // 125
      const tmp = (1000n * 12n * 10000n) / (10n * 10000n); // 120
      const expected = (1000n * (maxFeeNumerator - tmp) * 10000n) / (10000n * 10000n); // (1000 * 5 * 10000) / (10000 * 10000) = 5

      expect(fee).to.equal(expected);
    });

    it("should scale fee with output amount", function () {
      const baseAmount = 100n;
      const baseFee = calculateFeeSAMM(baseAmount, 10000n, 10000n, 25n, 10000n);

      const doubleAmount = 200n;
      const doubleFee = calculateFeeSAMM(doubleAmount, 10000n, 10000n, 25n, 10000n);

      // Fee should roughly double (may not be exact due to adaptive component)
      expect(doubleFee).to.be.gt(baseFee);
    });
  });

  describe("Swap Revert", function () {
    it("should calculate correct input for desired output", function () {
      const result = swapRevert(
        100n,     // destinationAmount (want to receive)
        10000n,   // swapSourceAmount (current source reserve)
        10000n    // swapDestinationAmount (current dest reserve)
      );

      // With equal reserves and small output:
      // invariant = 10000 * 10000 = 100,000,000
      // newDest = 10000 - 100 = 9900
      // newSource = 100,000,000 / 9900 = 10101.0101... -> 10102 (ceiling)
      // sourceNeeded = 10102 - 10000 = 102

      expect(result.sourceAmountSwapped).to.equal(102n);
      expect(result.destinationAmountSwapped).to.equal(100n);
    });

    it("should maintain invariant", function () {
      const sourceReserve = 50000n;
      const destReserve = 30000n;
      const outputWanted = 1000n;

      const result = swapRevert(outputWanted, sourceReserve, destReserve);

      // Check invariant is maintained or increased
      const oldInvariant = sourceReserve * destReserve;
      const newInvariant = (sourceReserve + result.sourceAmountSwapped) * (destReserve - result.destinationAmountSwapped);

      expect(newInvariant).to.be.gte(oldInvariant);
    });

    it("should handle unequal reserves", function () {
      const result = swapRevert(
        500n,     // want 500 of dest token
        20000n,   // source reserve
        10000n    // dest reserve (half of source)
      );

      expect(result.destinationAmountSwapped).to.equal(500n);
      expect(result.sourceAmountSwapped).to.be.gt(0n);
    });
  });

  describe("Full SAMM Swap", function () {
    it("should calculate complete swap with fees", function () {
      const result = swapSAMM(
        1000n,    // outputAmount (want to receive)
        100000n,  // swapSourceAmount
        100000n,  // swapDestinationAmount
        25n,      // tradeFeeNumerator (0.25%)
        10000n,   // tradeFeeDenominator
        10n,      // ownerFeeNumerator (0.1%)
        10000n    // ownerFeeDenominator
      );

      // Check all components are present
      expect(result.amountOut).to.equal(1000n);
      expect(result.amountIn).to.be.gt(1000n); // More than output due to price impact + fees
      expect(result.tradeFee).to.be.gt(0n);
      expect(result.ownerFee).to.equal(0n); // (1000 * 10) / 10000 = 1
    });

    it("should charge higher fees for larger trades", function () {
      const smallTrade = swapSAMM(
        100n,     // 0.1% of pool
        100000n,
        100000n,
        25n,
        10000n,
        10n,
        10000n
      );

      const largeTrade = swapSAMM(
        10000n,   // 10% of pool
        100000n,
        100000n,
        25n,
        10000n,
        10n,
        10000n
      );

      // Larger trade should have higher fee percentage
      const smallFeePercent = (smallTrade.tradeFee * 10000n) / smallTrade.amountOut;
      const largeFeePercent = (largeTrade.tradeFee * 10000n) / largeTrade.amountOut;

      expect(largeFeePercent).to.be.gt(smallFeePercent);
    });

    it("should handle 0.3% fee (typical AMM fee)", function () {
      const result = swapSAMM(
        1000n,
        100000n,
        100000n,
        30n,      // 0.3% fee
        10000n,
        0n,       // no owner fee
        1n
      );

      expect(result.amountOut).to.equal(1000n);
      expect(result.tradeFee).to.be.gt(0n);
      expect(result.ownerFee).to.equal(0n);
    });

    it("should handle different pool sizes", function () {
      const smallPool = swapSAMM(
        100n,     // 1% of small pool
        10000n,   // small pool
        10000n,
        25n,
        10000n,
        10n,
        10000n
      );

      const largePool = swapSAMM(
        100n,     // 0.01% of large pool
        1000000n, // large pool
        1000000n,
        25n,
        10000n,
        10n,
        10000n
      );

      // Same absolute output, but smaller % of large pool should have lower fee
      expect(largePool.tradeFee).to.be.lt(smallPool.tradeFee);
    });
  });

  describe("Edge Cases", function () {
    it("should handle very small outputs", function () {
      const result = swapSAMM(1n, 100000n, 100000n, 25n, 10000n, 10n, 10000n);
      expect(result.amountOut).to.equal(1n);
      expect(result.amountIn).to.be.gt(0n);
    });

    it("should handle maximum safe reserves", function () {
      // Test with large but safe values
      const result = swapSAMM(
        1000000n,
        1000000000n,
        1000000000n,
        25n,
        10000n,
        10n,
        10000n
      );

      expect(result.amountOut).to.equal(1000000n);
      expect(result.amountIn).to.be.gt(1000000n);
    });
  });

  describe("Fee Comparison", function () {
    it("should show fee range from 1x to 5x", function () {
      const baseFee = 25n; // 0.25%
      const feeDenom = 10000n;

      // Very large pool, tiny trade -> minimal fee (~1x base)
      const minimalFeeTrade = swapSAMM(10n, 10000000n, 10000000n, baseFee, feeDenom, 0n, 1n);
      const minimalFeeRate = (minimalFeeTrade.tradeFee * 10000n) / 10n;

      // Smaller pool, larger trade -> adaptive fee (up to 5x base)
      const adaptiveFeeTrade = swapSAMM(5000n, 10000n, 10000n, baseFee, feeDenom, 0n, 1n);
      const adaptiveFeeRate = (adaptiveFeeTrade.tradeFee * 10000n) / 5000n;

      console.log("Minimal fee rate:", minimalFeeRate.toString(), "bps");
      console.log("Adaptive fee rate:", adaptiveFeeRate.toString(), "bps");
      console.log("Base fee rate:", baseFee.toString(), "bps");

      // Adaptive should be higher than minimal
      expect(adaptiveFeeRate).to.be.gt(minimalFeeRate);
    });
  });
});
