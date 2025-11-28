const { expect } = require("chai");
const { ethers } = require("hardhat");
const fc = require("fast-check");

/**
 * Property-Based Tests for SAMM C-Properties Validation
 * 
 * **Feature: samm-deployment, Property 3: C-non-splitting property enforcement**
 * **Feature: samm-deployment, Property 4: C-smaller-better property validation**
 * **Validates: Requirements 6.3, 6.4**
 * 
 * Tests the core SAMM properties:
 * - C-non-splitting: Single shard trades cost less than split trades when OA/RA ≤ c
 * - C-smaller-better: Smaller shards provide better rates than larger shards when OA/RA ≤ c
 */
describe("SAMM C-Properties Validation Tests", function () {
    let sammFeesTest;
    let sammPool1, sammPool2; // Two pools representing different shard sizes
    let tokenA, tokenB;
    
    // SAMM parameters from research paper (scaled by 1e6 for precision)
    const BETA1_SCALED = -1050000; // -1.05 * 1e6
    const RMIN_SCALED = 1000;      // 0.001 * 1e6
    const RMAX_SCALED = 12000;     // 0.012 * 1e6
    const C_SCALED = 10400;        // 0.0104 * 1e6
    const SCALE_FACTOR = 1000000;  // 1e6

    beforeEach(async function () {
        const [owner] = await ethers.getSigners();
        
        // Deploy test contracts
        const SAMMFeesTest = await ethers.getContractFactory("SAMMFeesTest");
        sammFeesTest = await SAMMFeesTest.deploy();
        await sammFeesTest.waitForDeployment();

        // Deploy mock ERC20 tokens for pool testing
        const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
        tokenA = await MockERC20.deploy("Token A", "TKNA", 18);
        tokenB = await MockERC20.deploy("Token B", "TKNB", 18);
        
        // Mint initial supply
        await tokenA.mint(owner.address, ethers.parseEther("1000000"));
        await tokenB.mint(owner.address, ethers.parseEther("1000000"));
        await tokenA.waitForDeployment();
        await tokenB.waitForDeployment();

        // Deploy two SAMM pools with different sizes (representing different shards)
        const SAMMPool = await ethers.getContractFactory("SAMMPool");
        
        // Small shard pool
        sammPool1 = await SAMMPool.deploy(
            await tokenA.getAddress(),
            await tokenB.getAddress(),
            "SAMM Pool 1",
            "SAMM1"
        );
        await sammPool1.waitForDeployment();

        // Large shard pool  
        sammPool2 = await SAMMPool.deploy(
            await tokenA.getAddress(),
            await tokenB.getAddress(),
            "SAMM Pool 2", 
            "SAMM2"
        );
        await sammPool2.waitForDeployment();

        // Approve tokens for pools
        await tokenA.approve(await sammPool1.getAddress(), ethers.parseEther("100000"));
        await tokenB.approve(await sammPool1.getAddress(), ethers.parseEther("100000"));
        await tokenA.approve(await sammPool2.getAddress(), ethers.parseEther("100000"));
        await tokenB.approve(await sammPool2.getAddress(), ethers.parseEther("100000"));

        // Initialize pools with different sizes
        // Small shard: 1000 tokens each
        await sammPool1.initialize(
            await tokenA.getAddress(),
            await tokenB.getAddress(),
            ethers.parseEther("1000"),
            ethers.parseEther("1000"),
            25, 10000, // 0.25% trade fee
            0, 1       // 0% owner fee
        );

        // Large shard: 10000 tokens each (10x larger)
        await sammPool2.initialize(
            await tokenA.getAddress(),
            await tokenB.getAddress(),
            ethers.parseEther("10000"),
            ethers.parseEther("10000"),
            25, 10000, // 0.25% trade fee
            0, 1       // 0% owner fee
        );
    });

    /**
     * Property 3: C-non-splitting property enforcement
     * For any trade within the c-threshold, executing the trade on a single shard should 
     * always cost less than splitting the same trade across multiple shards
     */
    describe("Property 3: C-non-splitting property enforcement", function () {
        it("should enforce that single shard trades cost less than split trades within c-threshold", async function () {
            this.timeout(60000); // Increase timeout for property tests
            
            await fc.assert(
                fc.asyncProperty(
                    // Generate reserves for two different sized shards
                    fc.integer({ min: 1000, max: 5000 }).map(n => ethers.parseEther(n.toString())), // Small shard reserve
                    fc.integer({ min: 10000, max: 50000 }).map(n => ethers.parseEther(n.toString())), // Large shard reserve
                    // Generate trade amounts within c-threshold
                    fc.float({ min: Math.fround(0.001), max: Math.fround(0.010) }), // OA/RA ratio within c-threshold (0.0104)
                    
                    async (smallReserve, largeReserve, oaRaRatio) => {
                        // Skip if oaRaRatio is NaN or invalid
                        if (isNaN(oaRaRatio) || !isFinite(oaRaRatio)) return;
                        
                        // Calculate output amount based on smaller shard to ensure c-threshold compliance
                        const outputAmount = (smallReserve * BigInt(Math.floor(oaRaRatio * 1000000))) / BigInt(1000000);
                        
                        // Skip if output amount is too small or zero
                        if (outputAmount <= ethers.parseEther("0.001")) return;
                        
                        // Validate we're within c-threshold for both shards
                        const smallShardValid = await sammFeesTest.validateCThreshold(
                            outputAmount, smallReserve, C_SCALED
                        );
                        const largeShardValid = await sammFeesTest.validateCThreshold(
                            outputAmount, largeReserve, C_SCALED
                        );
                        
                        // Only test when both shards are within c-threshold
                        if (!smallShardValid || !largeShardValid) return;
                        
                        // Calculate fee for single trade on small shard
                        const singleTradeFee = await sammFeesTest.calculateFeeSAMM(
                            outputAmount,
                            smallReserve, // output reserve
                            smallReserve, // input reserve (assuming 1:1 for simplicity)
                            BETA1_SCALED,
                            RMIN_SCALED,
                            RMAX_SCALED
                        );
                        
                        // Calculate fees for split trade (half on each shard)
                        const halfAmount = outputAmount / 2n;
                        
                        const splitFee1 = await sammFeesTest.calculateFeeSAMM(
                            halfAmount,
                            smallReserve,
                            smallReserve,
                            BETA1_SCALED,
                            RMIN_SCALED,
                            RMAX_SCALED
                        );
                        
                        const splitFee2 = await sammFeesTest.calculateFeeSAMM(
                            halfAmount,
                            largeReserve,
                            largeReserve,
                            BETA1_SCALED,
                            RMIN_SCALED,
                            RMAX_SCALED
                        );
                        
                        const totalSplitFee = splitFee1 + splitFee2;
                        
                        // C-non-splitting property: single trade should cost less than split trade
                        expect(singleTradeFee).to.be.lt(totalSplitFee,
                            `C-non-splitting violated: Single fee ${singleTradeFee} >= Split fee ${totalSplitFee} ` +
                            `for output ${outputAmount}, small reserve ${smallReserve}, large reserve ${largeReserve}`
                        );
                    }
                ),
                { numRuns: 100 } // Run 100 iterations as specified in design
            );
        });

        it("should validate c-threshold enforcement prevents splitting violations", async function () {
            this.timeout(30000);
            
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1000, max: 10000 }).map(n => ethers.parseEther(n.toString())),
                    fc.float({ min: Math.fround(0.011), max: Math.fround(0.050) }), // OA/RA ratio above c-threshold
                    
                    async (inputReserve, oaRaRatio) => {
                        // Skip if oaRaRatio is NaN or invalid
                        if (isNaN(oaRaRatio) || !isFinite(oaRaRatio)) return;
                        
                        const outputAmount = (inputReserve * BigInt(Math.floor(oaRaRatio * 1000000))) / BigInt(1000000);
                        
                        // Skip if output amount is zero
                        if (outputAmount === 0n) return;
                        
                        const isValid = await sammFeesTest.validateCThreshold(
                            outputAmount, inputReserve, C_SCALED
                        );
                        
                        // Trades above c-threshold should be rejected
                        expect(isValid).to.equal(false,
                            `Trade above c-threshold should be invalid: OA=${outputAmount}, RA=${inputReserve}, ratio=${oaRaRatio}`
                        );
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    /**
     * Property 4: C-smaller-better property validation  
     * For any two shards of different sizes and trade within c-threshold, 
     * the smaller shard should always provide better rates than the larger shard
     */
    describe("Property 4: C-smaller-better property validation", function () {
        it("should enforce that smaller shards provide better rates than larger shards", async function () {
            this.timeout(60000);
            
            await fc.assert(
                fc.asyncProperty(
                    // Generate two different shard sizes
                    fc.integer({ min: 1000, max: 5000 }).map(n => ethers.parseEther(n.toString())), // Smaller shard
                    fc.integer({ min: 2, max: 10 }), // Size multiplier for larger shard
                    fc.float({ min: Math.fround(0.001), max: Math.fround(0.010) }), // OA/RA ratio within c-threshold
                    
                    async (smallerReserve, sizeMultiplier, oaRaRatio) => {
                        const largerReserve = smallerReserve * BigInt(sizeMultiplier);
                        
                        // Skip if oaRaRatio is NaN or invalid
                        if (isNaN(oaRaRatio) || !isFinite(oaRaRatio)) return;
                        
                        // Calculate output amount based on smaller shard
                        const outputAmount = (smallerReserve * BigInt(Math.floor(oaRaRatio * 1000000))) / BigInt(1000000);
                        
                        // Skip if output amount is too small
                        if (outputAmount <= ethers.parseEther("0.001")) return;
                        
                        // Ensure both shards are within c-threshold
                        const smallerValid = await sammFeesTest.validateCThreshold(
                            outputAmount, smallerReserve, C_SCALED
                        );
                        const largerValid = await sammFeesTest.validateCThreshold(
                            outputAmount, largerReserve, C_SCALED
                        );
                        
                        if (!smallerValid || !largerValid) return;
                        
                        // Calculate fees for both shards
                        const smallerShardFee = await sammFeesTest.calculateFeeSAMM(
                            outputAmount,
                            smallerReserve, // output reserve
                            smallerReserve, // input reserve
                            BETA1_SCALED,
                            RMIN_SCALED,
                            RMAX_SCALED
                        );
                        
                        const largerShardFee = await sammFeesTest.calculateFeeSAMM(
                            outputAmount,
                            largerReserve, // output reserve
                            largerReserve, // input reserve
                            BETA1_SCALED,
                            RMIN_SCALED,
                            RMAX_SCALED
                        );
                        
                        // C-smaller-better property: smaller shard should have lower fees (better rates)
                        expect(smallerShardFee).to.be.lte(largerShardFee,
                            `C-smaller-better violated: Smaller shard fee ${smallerShardFee} > Larger shard fee ${largerShardFee} ` +
                            `for output ${outputAmount}, smaller reserve ${smallerReserve}, larger reserve ${largerReserve}`
                        );
                        
                        // If reserves are significantly different, smaller should be strictly better
                        if (sizeMultiplier >= 3) {
                            expect(smallerShardFee).to.be.lt(largerShardFee,
                                `Smaller shard should be strictly better for significantly different sizes: ` +
                                `${smallerShardFee} >= ${largerShardFee}, multiplier: ${sizeMultiplier}`
                            );
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it("should demonstrate fee rate improvement in smaller shards", async function () {
            this.timeout(30000);
            
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1000, max: 5000 }).map(n => ethers.parseEther(n.toString())),
                    fc.float({ min: Math.fround(0.002), max: Math.fround(0.008) }), // Mid-range c-threshold values
                    
                    async (baseReserve, oaRaRatio) => {
                        // Skip if oaRaRatio is NaN or invalid
                        if (isNaN(oaRaRatio) || !isFinite(oaRaRatio)) return;
                        
                        const outputAmount = (baseReserve * BigInt(Math.floor(oaRaRatio * 1000000))) / BigInt(1000000);
                        
                        if (outputAmount <= ethers.parseEther("0.001")) return;
                        
                        // Test with 2x, 5x, and 10x larger shards
                        const multipliers = [2, 5, 10];
                        let previousFee = 0n;
                        
                        for (const multiplier of multipliers) {
                            const currentReserve = baseReserve * BigInt(multiplier);
                            
                            const isValid = await sammFeesTest.validateCThreshold(
                                outputAmount, currentReserve, C_SCALED
                            );
                            
                            if (!isValid) continue;
                            
                            const currentFee = await sammFeesTest.calculateFeeSAMM(
                                outputAmount,
                                currentReserve,
                                currentReserve,
                                BETA1_SCALED,
                                RMIN_SCALED,
                                RMAX_SCALED
                            );
                            
                            // Each larger shard should have higher or equal fees
                            if (previousFee > 0n) {
                                expect(currentFee).to.be.gte(previousFee,
                                    `Fee should increase with shard size: ${currentFee} < ${previousFee} ` +
                                    `for multiplier ${multiplier}`
                                );
                            }
                            
                            previousFee = currentFee;
                        }
                    }
                ),
                { numRuns: 50 }
            );
        });

        it("should maintain c-smaller-better property across different fee parameters", async function () {
            this.timeout(30000);
            
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1000, max: 8000 }).map(n => ethers.parseEther(n.toString())),
                    fc.integer({ min: 2, max: 8 }), // Size difference multiplier
                    fc.float({ min: Math.fround(0.001), max: Math.fround(0.009) }), // OA/RA ratio
                    
                    async (smallReserve, multiplier, oaRaRatio) => {
                        // Skip if oaRaRatio is NaN or invalid
                        if (isNaN(oaRaRatio) || !isFinite(oaRaRatio)) return;
                        
                        const largeReserve = smallReserve * BigInt(multiplier);
                        const outputAmount = (smallReserve * BigInt(Math.floor(oaRaRatio * 1000000))) / BigInt(1000000);
                        
                        if (outputAmount <= ethers.parseEther("0.001")) return;
                        
                        // Test with different beta1 values (all negative as required)
                        const beta1Values = [-800000, -1050000, -1300000]; // -0.8, -1.05, -1.3
                        
                        for (const beta1 of beta1Values) {
                            const smallValid = await sammFeesTest.validateCThreshold(
                                outputAmount, smallReserve, C_SCALED
                            );
                            const largeValid = await sammFeesTest.validateCThreshold(
                                outputAmount, largeReserve, C_SCALED
                            );
                            
                            if (!smallValid || !largeValid) continue;
                            
                            const smallFee = await sammFeesTest.calculateFeeSAMM(
                                outputAmount, smallReserve, smallReserve,
                                beta1, RMIN_SCALED, RMAX_SCALED
                            );
                            
                            const largeFee = await sammFeesTest.calculateFeeSAMM(
                                outputAmount, largeReserve, largeReserve,
                                beta1, RMIN_SCALED, RMAX_SCALED
                            );
                            
                            // C-smaller-better should hold regardless of beta1 value
                            expect(smallFee).to.be.lte(largeFee,
                                `C-smaller-better violated with beta1=${beta1}: ${smallFee} > ${largeFee}`
                            );
                        }
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    /**
     * Additional validation tests for edge cases and boundary conditions
     */
    describe("C-Properties Edge Cases", function () {
        it("should handle boundary conditions at c-threshold", async function () {
            this.timeout(30000);
            
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1000, max: 10000 }).map(n => ethers.parseEther(n.toString())),
                    
                    async (inputReserve) => {
                        // Test exactly at c-threshold
                        const exactCAmount = (inputReserve * BigInt(C_SCALED)) / BigInt(SCALE_FACTOR);
                        
                        if (exactCAmount === 0n) return;
                        
                        const isValidAtC = await sammFeesTest.validateCThreshold(
                            exactCAmount, inputReserve, C_SCALED
                        );
                        
                        // Should be valid at exactly c-threshold
                        expect(isValidAtC).to.equal(true,
                            `Should be valid at c-threshold: ${exactCAmount}/${inputReserve} = ${C_SCALED/SCALE_FACTOR}`
                        );
                        
                        // Test clearly above c-threshold (add 1% of the exact amount to ensure it's clearly above)
                        const increment = exactCAmount / 100n + 1n; // 1% + 1 to ensure it's above
                        const aboveCAmount = exactCAmount + increment;
                        const isValidAboveC = await sammFeesTest.validateCThreshold(
                            aboveCAmount, inputReserve, C_SCALED
                        );
                        
                        // Should be invalid above c-threshold
                        expect(isValidAboveC).to.equal(false,
                            `Should be invalid above c-threshold: ${aboveCAmount}/${inputReserve} > ${C_SCALED/SCALE_FACTOR}`
                        );
                    }
                ),
                { numRuns: 50 }
            );
        });

        it("should handle zero and minimal amounts correctly", async function () {
            const reserve = ethers.parseEther("1000");
            
            // Test zero output amount
            const zeroFee = await sammFeesTest.calculateFeeSAMM(
                0n, reserve, reserve,
                BETA1_SCALED, RMIN_SCALED, RMAX_SCALED
            );
            expect(zeroFee).to.equal(0n, "Zero output should result in zero fee");
            
            // Test minimal output amount
            const minimalAmount = 1n;
            const minimalFee = await sammFeesTest.calculateFeeSAMM(
                minimalAmount, reserve, reserve,
                BETA1_SCALED, RMIN_SCALED, RMAX_SCALED
            );
            expect(minimalFee).to.be.gte(0n, "Minimal output should result in non-negative fee");
        });
    });
});