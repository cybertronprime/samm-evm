const { expect } = require("chai");
const { ethers } = require("hardhat");
const fc = require("fast-check");

/**
 * Property-Based Tests for SAMM Fee Calculations
 * 
 * **Feature: samm-deployment, Property 2: SAMM fee calculation accuracy**
 * **Validates: Requirements 6.1**
 * 
 * Tests the bounded-ratio polynomial fee function:
 * tf_SAMM(RA,RB,OA) = (RB/RA) × OA × max{rmin, β1×(OA/RA) + rmax}
 * 
 * Where:
 * - RA = input token reserve
 * - RB = output token reserve  
 * - OA = output amount requested
 * - β1 = -1.05 (slope parameter)
 * - rmin = 0.001 (minimum fee rate)
 * - rmax = 0.012 (maximum fee rate)
 */
describe("SAMM Fee Calculation Property Tests", function () {
    let sammFees;
    
    // SAMM parameters from research paper (scaled by 1e6 for precision)
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

    /**
     * Property 2: SAMM fee calculation accuracy
     * For any valid input parameters (RA, RB, OA), the SAMM fee calculation should produce 
     * results that match the bounded-ratio polynomial function
     */
    describe("Property 2: SAMM fee calculation accuracy", function () {
        it("should calculate fees according to bounded-ratio polynomial formula", async function () {
            this.timeout(30000); // Increase timeout for property tests
            
            await fc.assert(
                fc.asyncProperty(
                    // Generate valid reserves (1 to 1M tokens, scaled to 18 decimals)
                    fc.integer({ min: 1, max: 1000000 }).map(n => ethers.parseEther(n.toString())),
                    fc.integer({ min: 1, max: 1000000 }).map(n => ethers.parseEther(n.toString())),
                    // Generate output amounts (0.001 to 10000 tokens, scaled to 18 decimals)
                    fc.integer({ min: 1, max: 10000000 }).map(n => {
                        // Convert to decimal with 3 decimal places (0.001 to 10000.000)
                        const value = n / 1000;
                        return ethers.parseEther(value.toString());
                    }),
                    
                    async (inputReserve, outputReserve, outputAmount) => {
                        // Calculate fee using contract
                        const actualFee = await sammFees.calculateFeeSAMM(
                            outputAmount,
                            outputReserve,
                            inputReserve,
                            BETA1_SCALED,
                            RMIN_SCALED,
                            RMAX_SCALED
                        );

                        // Calculate expected fee using the research paper formula
                        const expectedFee = calculateExpectedSAMMFee(
                            outputAmount,
                            outputReserve,
                            inputReserve,
                            BETA1_SCALED,
                            RMIN_SCALED,
                            RMAX_SCALED
                        );

                        // Allow for small precision differences due to integer arithmetic
                        const tolerance = expectedFee / 1000n; // 0.1% tolerance
                        const difference = actualFee > expectedFee ? 
                            actualFee - expectedFee : 
                            expectedFee - actualFee;

                        expect(difference).to.be.lte(tolerance, 
                            `Fee calculation mismatch. Expected: ${expectedFee}, Actual: ${actualFee}, ` +
                            `Inputs: OA=${outputAmount}, RB=${outputReserve}, RA=${inputReserve}`
                        );
                    }
                ),
                { numRuns: 100 } // Run 100 iterations as specified in design
            );
        });

        it("should always use minimum fee rate (rmin) when calculated rate falls below it", async function () {
            this.timeout(30000);
            
            await fc.assert(
                fc.asyncProperty(
                    // Generate scenarios where β1×(OA/RA) + rmax < rmin
                    // This happens when OA/RA is large (large trades)
                    fc.integer({ min: 1000, max: 100000 }).map(n => ethers.parseEther(n.toString())),
                    fc.integer({ min: 1000, max: 100000 }).map(n => ethers.parseEther(n.toString())),
                    fc.integer({ min: 50000, max: 5000000 }).map(n => {
                        // Convert to decimal with 3 decimal places (50.000 to 5000.000)
                        const value = n / 1000;
                        return ethers.parseEther(value.toString());
                    }), // Large output amounts
                    
                    async (inputReserve, outputReserve, outputAmount) => {
                        // Calculate OA/RA ratio
                        const oaRaRatio = (outputAmount * BigInt(SCALE_FACTOR)) / inputReserve;
                        
                        // Calculate β1×(OA/RA) + rmax
                        const calculatedRate = (BigInt(BETA1_SCALED) * oaRaRatio) / BigInt(SCALE_FACTOR) + BigInt(RMAX_SCALED);
                        
                        // Only test cases where calculated rate < rmin (should use rmin)
                        if (calculatedRate < BigInt(RMIN_SCALED)) {
                            const actualFee = await sammFees.calculateFeeSAMM(
                                outputAmount,
                                outputReserve,
                                inputReserve,
                                BETA1_SCALED,
                                RMIN_SCALED,
                                RMAX_SCALED
                            );

                            // Expected fee using rmin: (RB/RA) × OA × rmin
                            const expectedFee = (outputReserve * outputAmount * BigInt(RMIN_SCALED)) / 
                                              (inputReserve * BigInt(SCALE_FACTOR));

                            const tolerance = expectedFee / 1000n; // 0.1% tolerance
                            const difference = actualFee > expectedFee ? 
                                actualFee - expectedFee : 
                                expectedFee - actualFee;

                            expect(difference).to.be.lte(tolerance,
                                `Should use rmin for large trades. Expected: ${expectedFee}, Actual: ${actualFee}`
                            );
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it("should produce non-negative fees for all valid inputs", async function () {
            this.timeout(30000);
            
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1000, max: 100000 }).map(n => ethers.parseEther(n.toString())),
                    fc.integer({ min: 1000, max: 100000 }).map(n => ethers.parseEther(n.toString())),
                    fc.integer({ min: 100, max: 100000 }).map(n => {
                        // Convert to decimal with 3 decimal places (0.100 to 100.000)
                        const value = n / 1000;
                        return ethers.parseEther(value.toString());
                    }),
                    
                    async (inputReserve, outputReserve, outputAmount) => {
                        const fee = await sammFees.calculateFeeSAMM(
                            outputAmount,
                            outputReserve,
                            inputReserve,
                            BETA1_SCALED,
                            RMIN_SCALED,
                            RMAX_SCALED
                        );

                        // Fee should always be non-negative
                        expect(fee).to.be.gte(0n,
                            `Fee should be non-negative. Fee: ${fee}, Inputs: OA=${outputAmount}, RB=${outputReserve}, RA=${inputReserve}`
                        );
                        
                        // Fee should be reasonable (not exceed the output amount in most cases)
                        // This is a sanity check for the fee calculation
                        if (outputAmount > 0n) {
                            expect(fee).to.be.lt(outputAmount * 10n,
                                `Fee should be reasonable compared to output amount. Fee: ${fee}, Output: ${outputAmount}`
                            );
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it("should handle edge cases correctly", async function () {
            this.timeout(30000);
            
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000000 }).map(n => ethers.parseEther(n.toString())),
                    fc.integer({ min: 1, max: 1000000 }).map(n => ethers.parseEther(n.toString())),
                    
                    async (inputReserve, outputReserve) => {
                        // Test zero output amount
                        const feeZero = await sammFees.calculateFeeSAMM(
                            0n,
                            outputReserve,
                            inputReserve,
                            BETA1_SCALED,
                            RMIN_SCALED,
                            RMAX_SCALED
                        );
                        
                        expect(feeZero).to.equal(0n, "Fee should be zero for zero output amount");
                        
                        // Test very small output amount
                        const smallAmount = ethers.parseEther("0.000001");
                        const feeSmall = await sammFees.calculateFeeSAMM(
                            smallAmount,
                            outputReserve,
                            inputReserve,
                            BETA1_SCALED,
                            RMIN_SCALED,
                            RMAX_SCALED
                        );
                        
                        expect(feeSmall).to.be.gt(0n, "Fee should be positive for positive output amount");
                    }
                ),
                { numRuns: 50 }
            );
        });

        it("should respect c-threshold validation property", async function () {
            this.timeout(30000);
            
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1000, max: 100000 }).map(n => ethers.parseEther(n.toString())),
                    fc.integer({ min: 1, max: 20 }).map(n => n / 1000), // OA/RA ratio around c-threshold (0.001 to 0.020)
                    
                    async (inputReserve, oaRaRatio) => {
                        const outputAmount = (inputReserve * BigInt(Math.floor(oaRaRatio * 1000000))) / BigInt(1000000);
                        
                        // Skip if output amount is zero
                        if (outputAmount === 0n) return;
                        
                        const isValidCThreshold = await sammFees.validateCThreshold(
                            outputAmount,
                            inputReserve,
                            C_SCALED
                        );
                        
                        // Calculate actual OA/RA ratio
                        const actualRatio = (outputAmount * BigInt(SCALE_FACTOR)) / inputReserve;
                        const expectedValid = actualRatio <= BigInt(C_SCALED);
                        
                        expect(isValidCThreshold).to.equal(expectedValid,
                            `C-threshold validation mismatch. Ratio: ${actualRatio}, C: ${C_SCALED}`
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Helper function to calculate expected SAMM fee using the research paper formula
     * tf_SAMM(RA,RB,OA) = (RB/RA) × OA × max{rmin, β1×(OA/RA) + rmax}
     */
    function calculateExpectedSAMMFee(outputAmount, outputReserve, inputReserve, beta1, rmin, rmax) {
        if (outputAmount === 0n || outputReserve === 0n || inputReserve === 0n) {
            return 0n;
        }

        // Calculate OA/RA ratio (scaled by 1e6 for precision)
        const oaRaRatio = (outputAmount * BigInt(SCALE_FACTOR)) / inputReserve;
        
        // Calculate β1 × (OA/RA) + rmax
        const feeRateScaled = (BigInt(beta1) * oaRaRatio) / BigInt(SCALE_FACTOR) + BigInt(rmax);
        
        // Take max{rmin, β1×(OA/RA) + rmax}
        const finalFeeRate = feeRateScaled <= BigInt(rmin) ? BigInt(rmin) : feeRateScaled;
        
        // Calculate final fee: (RB/RA) × OA × fee_rate
        const fee = (outputReserve * outputAmount * finalFeeRate) / (inputReserve * BigInt(SCALE_FACTOR));
        
        return fee;
    }
});