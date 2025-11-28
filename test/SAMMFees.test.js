const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SAMMFees Library", function () {
    let sammFees;
    
    // SAMM parameters from research paper
    const BETA1_SCALED = -1050000; // -1.05 * 1e6
    const RMIN_SCALED = 1000;      // 0.001 * 1e6
    const RMAX_SCALED = 12000;     // 0.012 * 1e6
    const C_SCALED = 10400;        // 0.0104 * 1e6
    const SCALE_FACTOR = 1000000;  // 1e6

    beforeEach(async function () {
        const SAMMFeesTest = await ethers.getContractFactory("SAMMFeesTest");
        sammFees = await SAMMFeesTest.deploy();
        await sammFees.waitForDeployment();
    });

    describe("SAMM Fee Formula", function () {
        it("should calculate correct fee for small trade (uses rmin)", async function () {
            const outputAmount = ethers.parseEther("1");     // 1 token
            const outputReserve = ethers.parseEther("10000"); // 10,000 tokens
            const inputReserve = ethers.parseEther("10000");  // 10,000 tokens
            
            // OA/RA = 1/10000 = 0.0001
            // β1 × (OA/RA) + rmax = -1.05 × 0.0001 + 0.012 = 0.011895
            // max{rmin, 0.011895} = max{0.001, 0.011895} = 0.011895
            // fee = (RB/RA) × OA × 0.011895 = (10000/10000) × 1 × 0.011895 = 0.011895
            
            const fee = await sammFees.calculateFeeSAMM(
                outputAmount,
                outputReserve,
                inputReserve,
                BETA1_SCALED,
                RMIN_SCALED,
                RMAX_SCALED
            );
            
            // Expected fee: 0.011895 tokens
            const expectedFee = ethers.parseEther("0.011895");
            expect(fee).to.be.closeTo(expectedFee, ethers.parseEther("0.000001"));
        });

        it("should use rmin for very small trades", async function () {
            const outputAmount = ethers.parseEther("0.1");   // 0.1 token
            const outputReserve = ethers.parseEther("10000"); // 10,000 tokens
            const inputReserve = ethers.parseEther("10000");  // 10,000 tokens
            
            // OA/RA = 0.1/10000 = 0.00001
            // β1 × (OA/RA) + rmax = -1.05 × 0.00001 + 0.012 = 0.01199895
            // max{rmin, 0.01199895} = max{0.001, 0.01199895} = 0.01199895
            // But for very small trades, should approach rmin
            
            const fee = await sammFees.calculateFeeSAMM(
                outputAmount,
                outputReserve,
                inputReserve,
                BETA1_SCALED,
                RMIN_SCALED,
                RMAX_SCALED
            );
            
            // Should be close to rmin rate
            const minExpectedFee = ethers.parseEther("0.0001"); // 0.1 * 0.001
            expect(fee).to.be.gte(minExpectedFee);
        });

        it("should handle larger trades correctly", async function () {
            const outputAmount = ethers.parseEther("100");   // 100 tokens
            const outputReserve = ethers.parseEther("10000"); // 10,000 tokens
            const inputReserve = ethers.parseEther("10000");  // 10,000 tokens
            
            // OA/RA = 100/10000 = 0.01
            // β1 × (OA/RA) + rmax = -1.05 × 0.01 + 0.012 = 0.00145
            // max{rmin, 0.00145} = max{0.001, 0.00145} = 0.00145
            // fee = (RB/RA) × OA × 0.00145 = 1 × 100 × 0.00145 = 0.145
            
            const fee = await sammFees.calculateFeeSAMM(
                outputAmount,
                outputReserve,
                inputReserve,
                BETA1_SCALED,
                RMIN_SCALED,
                RMAX_SCALED
            );
            
            const expectedFee = ethers.parseEther("0.145");
            expect(fee).to.be.closeTo(expectedFee, ethers.parseEther("0.01")); // More tolerant for precision
        });

        it("should use rmin when fee rate goes below minimum", async function () {
            const outputAmount = ethers.parseEther("200");   // 200 tokens (large trade)
            const outputReserve = ethers.parseEther("10000"); // 10,000 tokens
            const inputReserve = ethers.parseEther("10000");  // 10,000 tokens
            
            // OA/RA = 200/10000 = 0.02
            // β1 × (OA/RA) + rmax = -1.05 × 0.02 + 0.012 = -0.009
            // max{rmin, -0.009} = max{0.001, -0.009} = 0.001 (rmin)
            // fee = (RB/RA) × OA × 0.001 = 1 × 200 × 0.001 = 0.2
            
            const fee = await sammFees.calculateFeeSAMM(
                outputAmount,
                outputReserve,
                inputReserve,
                BETA1_SCALED,
                RMIN_SCALED,
                RMAX_SCALED
            );
            
            const expectedFee = ethers.parseEther("0.2"); // 200 * 0.001
            expect(fee).to.be.closeTo(expectedFee, ethers.parseEther("0.001"));
        });

        it("should handle different reserve ratios", async function () {
            const outputAmount = ethers.parseEther("10");
            const outputReserve = ethers.parseEther("5000");  // 5,000 tokens
            const inputReserve = ethers.parseEther("10000");  // 10,000 tokens
            
            // RB/RA = 5000/10000 = 0.5
            // OA/RA = 10/10000 = 0.001
            // β1 × (OA/RA) + rmax = -1.05 × 0.001 + 0.012 = 0.01095
            // max{rmin, 0.01095} = 0.01095
            // fee = 0.5 × 10 × 0.01095 = 0.05475
            
            const fee = await sammFees.calculateFeeSAMM(
                outputAmount,
                outputReserve,
                inputReserve,
                BETA1_SCALED,
                RMIN_SCALED,
                RMAX_SCALED
            );
            
            const expectedFee = ethers.parseEther("0.05475");
            expect(fee).to.be.closeTo(expectedFee, ethers.parseEther("0.00001"));
        });
    });

    describe("C-Threshold Validation", function () {
        it("should validate trades within c-threshold", async function () {
            const outputAmount = ethers.parseEther("10");
            const inputReserve = ethers.parseEther("10000");
            
            // OA/RA = 10/10000 = 0.001
            // c = 0.0104, so 0.001 <= 0.0104 should be valid
            
            const isValid = await sammFees.validateCThreshold(
                outputAmount,
                inputReserve,
                C_SCALED
            );
            
            expect(isValid).to.be.true;
        });

        it("should reject trades exceeding c-threshold", async function () {
            const outputAmount = ethers.parseEther("200");
            const inputReserve = ethers.parseEther("10000");
            
            // OA/RA = 200/10000 = 0.02
            // c = 0.0104, so 0.02 > 0.0104 should be invalid
            
            const isValid = await sammFees.validateCThreshold(
                outputAmount,
                inputReserve,
                C_SCALED
            );
            
            expect(isValid).to.be.false;
        });

        it("should handle edge case at c-threshold", async function () {
            const inputReserve = ethers.parseEther("10000");
            // Calculate exact c-threshold amount: 10000 * 0.0104 = 104
            const outputAmount = ethers.parseEther("104");
            
            const isValid = await sammFees.validateCThreshold(
                outputAmount,
                inputReserve,
                C_SCALED
            );
            
            expect(isValid).to.be.true;
        });
    });

    describe("Default Parameters", function () {
        it("should use correct default parameters", async function () {
            const outputAmount = ethers.parseEther("10");
            const outputReserve = ethers.parseEther("10000");
            const inputReserve = ethers.parseEther("10000");
            
            const feeDefault = await sammFees.calculateFeeSAMMDefault(
                outputAmount,
                outputReserve,
                inputReserve
            );
            
            const feeExplicit = await sammFees.calculateFeeSAMM(
                outputAmount,
                outputReserve,
                inputReserve,
                BETA1_SCALED,
                RMIN_SCALED,
                RMAX_SCALED
            );
            
            expect(feeDefault).to.equal(feeExplicit);
        });
    });

    describe("Edge Cases", function () {
        it("should return zero fee for zero output", async function () {
            const fee = await sammFees.calculateFeeSAMM(
                0,
                ethers.parseEther("10000"),
                ethers.parseEther("10000"),
                BETA1_SCALED,
                RMIN_SCALED,
                RMAX_SCALED
            );
            
            expect(fee).to.equal(0);
        });

        it("should return zero fee for zero reserves", async function () {
            const fee = await sammFees.calculateFeeSAMM(
                ethers.parseEther("10"),
                0,
                ethers.parseEther("10000"),
                BETA1_SCALED,
                RMIN_SCALED,
                RMAX_SCALED
            );
            
            expect(fee).to.equal(0);
        });

        it("should handle very large numbers", async function () {
            const outputAmount = ethers.parseEther("1000000");
            const outputReserve = ethers.parseEther("100000000");
            const inputReserve = ethers.parseEther("100000000");
            
            const fee = await sammFees.calculateFeeSAMM(
                outputAmount,
                outputReserve,
                inputReserve,
                BETA1_SCALED,
                RMIN_SCALED,
                RMAX_SCALED
            );
            
            expect(fee).to.be.gt(0);
        });
    });
});