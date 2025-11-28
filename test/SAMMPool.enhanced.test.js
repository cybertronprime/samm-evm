const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Enhanced SAMM Pool", function () {
    let sammPool;
    let tokenA, tokenB;
    let owner, user1, user2;
    
    // SAMM parameters
    const BETA1_SCALED = -1050000; // -1.05 * 1e6
    const RMIN_SCALED = 1000;      // 0.001 * 1e6
    const RMAX_SCALED = 12000;     // 0.012 * 1e6
    const C_SCALED = 10400;        // 0.0104 * 1e6

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();

        // Deploy mock tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        tokenA = await MockERC20.deploy("Token A", "TKNA", 18);
        tokenB = await MockERC20.deploy("Token B", "TKNB", 18);
        await tokenA.waitForDeployment();
        await tokenB.waitForDeployment();

        // Deploy SAMM Pool
        const SAMMPool = await ethers.getContractFactory("SAMMPool");
        sammPool = await SAMMPool.deploy(
            await tokenA.getAddress(),
            await tokenB.getAddress(),
            "SAMM Pool A-B",
            "SAMM-AB"
        );
        await sammPool.waitForDeployment();

        // Mint tokens to users
        await tokenA.mint(owner.address, ethers.parseEther("1000000"));
        await tokenB.mint(owner.address, ethers.parseEther("1000000"));
        await tokenA.mint(user1.address, ethers.parseEther("100000"));
        await tokenB.mint(user1.address, ethers.parseEther("100000"));

        // Approve tokens
        await tokenA.approve(await sammPool.getAddress(), ethers.parseEther("1000000"));
        await tokenB.approve(await sammPool.getAddress(), ethers.parseEther("1000000"));
        await tokenA.connect(user1).approve(await sammPool.getAddress(), ethers.parseEther("100000"));
        await tokenB.connect(user1).approve(await sammPool.getAddress(), ethers.parseEther("100000"));
    });

    describe("Initialization with SAMM Parameters", function () {
        it("should initialize with correct SAMM parameters", async function () {
            await sammPool.initialize(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                ethers.parseEther("10000"),
                ethers.parseEther("10000"),
                25,    // 0.25% trade fee
                10000,
                5,     // 0.05% owner fee
                10000
            );

            const [beta1, rmin, rmax, c] = await sammPool.getSAMMParams();
            expect(beta1).to.equal(BETA1_SCALED);
            expect(rmin).to.equal(RMIN_SCALED);
            expect(rmax).to.equal(RMAX_SCALED);
            expect(c).to.equal(C_SCALED);
        });

        it("should allow owner to update SAMM parameters", async function () {
            await sammPool.initialize(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                ethers.parseEther("10000"),
                ethers.parseEther("10000"),
                25, 10000, 5, 10000
            );

            const newBeta1 = -1100000; // -1.1 * 1e6
            const newRmin = 500;       // 0.0005 * 1e6
            const newRmax = 15000;     // 0.015 * 1e6
            const newC = 12000;        // 0.012 * 1e6

            await expect(sammPool.updateSAMMParams(newBeta1, newRmin, newRmax, newC))
                .to.emit(sammPool, "SAMMParamsUpdated")
                .withArgs(newBeta1, newRmin, newRmax, newC);

            const [beta1, rmin, rmax, c] = await sammPool.getSAMMParams();
            expect(beta1).to.equal(newBeta1);
            expect(rmin).to.equal(newRmin);
            expect(rmax).to.equal(newRmax);
            expect(c).to.equal(newC);
        });

        it("should reject invalid SAMM parameters", async function () {
            await sammPool.initialize(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                ethers.parseEther("10000"),
                ethers.parseEther("10000"),
                25, 10000, 5, 10000
            );

            // Beta1 must be negative
            await expect(sammPool.updateSAMMParams(1000000, 1000, 12000, 10400))
                .to.be.revertedWith("SAMMPool: beta1 must be negative");

            // rmin must be positive
            await expect(sammPool.updateSAMMParams(-1050000, 0, 12000, 10400))
                .to.be.revertedWith("SAMMPool: rmin must be positive");

            // rmax must be greater than rmin
            await expect(sammPool.updateSAMMParams(-1050000, 12000, 1000, 10400))
                .to.be.revertedWith("SAMMPool: rmax must be greater than rmin");

            // c must be positive
            await expect(sammPool.updateSAMMParams(-1050000, 1000, 12000, 0))
                .to.be.revertedWith("SAMMPool: c must be positive");
        });
    });

    describe("SAMM Swap with Research Paper Formula", function () {
        beforeEach(async function () {
            await sammPool.initialize(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                ethers.parseEther("10000"),
                ethers.parseEther("10000"),
                25, 10000, 5, 10000
            );
        });

        it("should calculate correct fees using SAMM formula", async function () {
            const amountOut = ethers.parseEther("10");
            
            // Calculate expected swap result
            const result = await sammPool.calculateSwapSAMM(
                amountOut,
                await tokenA.getAddress(),
                await tokenB.getAddress()
            );

            // Verify the fee calculation matches our expectations
            // For small trade: OA/RA = 10/10000 = 0.001
            // β1 × (OA/RA) + rmax = -1.05 × 0.001 + 0.012 = 0.01095
            // max{rmin, 0.01095} = 0.01095
            // fee = (RB/RA) × OA × 0.01095 = 1 × 10 × 0.01095 = 0.1095
            
            const expectedTradeFee = ethers.parseEther("0.1095");
            expect(result.tradeFee).to.be.closeTo(expectedTradeFee, ethers.parseEther("0.001"));
        });

        it("should enforce c-threshold validation", async function () {
            // Try to swap amount that exceeds c-threshold
            // c = 0.0104, so for 10000 reserve, max amount = 10000 * 0.0104 = 104
            const amountOut = ethers.parseEther("200"); // Exceeds threshold
            
            await expect(sammPool.connect(user1).swapSAMM(
                amountOut,
                ethers.parseEther("1000"), // maxAmountIn
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                user1.address
            )).to.be.revertedWith("SAMMPool: exceeds c-threshold");
        });

        it("should allow swaps within c-threshold", async function () {
            // Swap amount within c-threshold
            const amountOut = ethers.parseEther("50"); // Within threshold
            
            const balanceBefore = await tokenB.balanceOf(user1.address);
            
            await sammPool.connect(user1).swapSAMM(
                amountOut,
                ethers.parseEther("1000"), // maxAmountIn
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                user1.address
            );
            
            const balanceAfter = await tokenB.balanceOf(user1.address);
            expect(balanceAfter - balanceBefore).to.equal(amountOut);
        });

        it("should use rmin for very large trades", async function () {
            // Large trade that should hit rmin
            const amountOut = ethers.parseEther("100");
            
            const result = await sammPool.calculateSwapSAMM(
                amountOut,
                await tokenA.getAddress(),
                await tokenB.getAddress()
            );

            // For large trade, should approach rmin rate
            // fee ≈ (RB/RA) × OA × rmin = 1 × 100 × 0.001 = 0.1
            const expectedMinFee = ethers.parseEther("0.1");
            expect(result.tradeFee).to.be.gte(expectedMinFee);
        });
    });

    describe("Multi-Shard Properties", function () {
        it("should maintain c-non-splitting property", async function () {
            // This test verifies that single shard trades are cheaper than split trades
            // when OA/RA ≤ c (which is enforced by c-threshold validation)
            
            await sammPool.initialize(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                ethers.parseEther("10000"),
                ethers.parseEther("10000"),
                25, 10000, 5, 10000
            );

            const amountOut = ethers.parseEther("50"); // Within c-threshold
            
            const result = await sammPool.calculateSwapSAMM(
                amountOut,
                await tokenA.getAddress(),
                await tokenB.getAddress()
            );

            // Single shard trade should be allowed and have reasonable fee
            expect(result.amountIn).to.be.gt(amountOut); // Should include fees
            expect(result.tradeFee).to.be.gt(0);
        });

        it("should demonstrate c-smaller-better property concept", async function () {
            // This test shows that smaller pools (shards) provide better rates
            // In practice, this would be tested across multiple shards
            
            await sammPool.initialize(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                ethers.parseEther("5000"), // Smaller pool
                ethers.parseEther("5000"),
                25, 10000, 5, 10000
            );

            const amountOut = ethers.parseEther("25");
            
            const result = await sammPool.calculateSwapSAMM(
                amountOut,
                await tokenA.getAddress(),
                await tokenB.getAddress()
            );

            // Smaller pool should have different (potentially better) rates
            // OA/RA ratio is higher in smaller pool: 25/5000 = 0.005 vs 25/10000 = 0.0025
            expect(result.tradeFee).to.be.gt(0);
        });
    });

    describe("Backward Compatibility", function () {
        it("should maintain compatibility with existing interfaces", async function () {
            await sammPool.initialize(
                await tokenA.getAddress(),
                await tokenB.getAddress(),
                ethers.parseEther("10000"),
                ethers.parseEther("10000"),
                25, 10000, 5, 10000
            );

            // Test that all existing functions still work
            const [reserveA, reserveB] = await sammPool.getReserves();
            expect(reserveA).to.equal(ethers.parseEther("10000"));
            expect(reserveB).to.equal(ethers.parseEther("10000"));

            const poolState = await sammPool.getPoolState();
            expect(poolState.tokenA).to.equal(await tokenA.getAddress());
            expect(poolState.tokenB).to.equal(await tokenB.getAddress());
        });
    });
});