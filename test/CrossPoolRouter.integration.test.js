/**
 * Integration Tests for Cross-Pool Router
 * Tests real contract interactions for atomic multi-hop swaps
 * 
 * **Feature: cross-pool-router**
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.2, 5.5, 6.1, 8.1, 8.2, 8.4**
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('CrossPoolRouter Integration Tests', function() {
  let sammPoolFactory;
  let crossPoolRouter;
  let mockTokenA, mockTokenB, mockTokenC, mockTokenD;
  let owner, user1, user2;
  
  // Pool addresses
  let poolAB_small, poolAB_large;
  let poolBC_small, poolBC_large;
  let poolCD_small;
  
  // Test constants
  const INITIAL_LIQUIDITY_SMALL = ethers.parseEther('1000');
  const INITIAL_LIQUIDITY_LARGE = ethers.parseEther('10000');
  const INITIAL_USER_BALANCE = ethers.parseEther('100000');
  
  // Default SAMM parameters
  const DEFAULT_SAMM_PARAMS = {
    beta1: -1050000n,  // -1.05 * 1e6
    rmin: 1000n,       // 0.001 * 1e6
    rmax: 12000n,      // 0.012 * 1e6
    c: 10400n          // 0.0104 * 1e6
  };
  
  // Default fee parameters
  const DEFAULT_FEE_PARAMS = {
    tradeFeeNumerator: 25n,
    tradeFeeDenominator: 10000n,
    ownerFeeNumerator: 5n,
    ownerFeeDenominator: 10000n
  };

  before(async function() {
    [owner, user1, user2] = await ethers.getSigners();
  });

  beforeEach(async function() {
    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    mockTokenA = await MockERC20.deploy('Token A', 'TKNA', 18);
    mockTokenB = await MockERC20.deploy('Token B', 'TKNB', 18);
    mockTokenC = await MockERC20.deploy('Token C', 'TKNC', 18);
    mockTokenD = await MockERC20.deploy('Token D', 'TKND', 18);
    
    await mockTokenA.waitForDeployment();
    await mockTokenB.waitForDeployment();
    await mockTokenC.waitForDeployment();
    await mockTokenD.waitForDeployment();

    // Deploy SAMM Pool Factory
    const SAMMPoolFactory = await ethers.getContractFactory('SAMMPoolFactory');
    sammPoolFactory = await SAMMPoolFactory.deploy();
    await sammPoolFactory.waitForDeployment();

    // Deploy CrossPoolRouter
    const CrossPoolRouter = await ethers.getContractFactory('CrossPoolRouter');
    crossPoolRouter = await CrossPoolRouter.deploy(await sammPoolFactory.getAddress());
    await crossPoolRouter.waitForDeployment();

    // Mint tokens to owner for pool creation
    await mockTokenA.mint(owner.address, INITIAL_USER_BALANCE * 10n);
    await mockTokenB.mint(owner.address, INITIAL_USER_BALANCE * 10n);
    await mockTokenC.mint(owner.address, INITIAL_USER_BALANCE * 10n);
    await mockTokenD.mint(owner.address, INITIAL_USER_BALANCE * 10n);

    // Mint tokens to users for testing
    await mockTokenA.mint(user1.address, INITIAL_USER_BALANCE);
    await mockTokenB.mint(user1.address, INITIAL_USER_BALANCE);
    await mockTokenC.mint(user1.address, INITIAL_USER_BALANCE);
    await mockTokenD.mint(user1.address, INITIAL_USER_BALANCE);

    // Create and initialize pools
    await setupPools();
  });

  async function setupPools() {
    const factoryAddress = await sammPoolFactory.getAddress();
    
    // Create A-B pools (small and large)
    poolAB_small = await createAndInitializePool(
      mockTokenA, mockTokenB, 
      INITIAL_LIQUIDITY_SMALL, INITIAL_LIQUIDITY_SMALL
    );
    
    poolAB_large = await createAndInitializePool(
      mockTokenA, mockTokenB,
      INITIAL_LIQUIDITY_LARGE, INITIAL_LIQUIDITY_LARGE
    );
    
    // Create B-C pools (small and large)
    poolBC_small = await createAndInitializePool(
      mockTokenB, mockTokenC,
      INITIAL_LIQUIDITY_SMALL, INITIAL_LIQUIDITY_SMALL
    );
    
    poolBC_large = await createAndInitializePool(
      mockTokenB, mockTokenC,
      INITIAL_LIQUIDITY_LARGE, INITIAL_LIQUIDITY_LARGE
    );
    
    // Create C-D pool (small only)
    poolCD_small = await createAndInitializePool(
      mockTokenC, mockTokenD,
      INITIAL_LIQUIDITY_SMALL, INITIAL_LIQUIDITY_SMALL
    );
  }

  async function createAndInitializePool(tokenA, tokenB, amountA, amountB) {
    // Create shard
    const tx = await sammPoolFactory.createShard(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      DEFAULT_SAMM_PARAMS,
      DEFAULT_FEE_PARAMS
    );
    const receipt = await tx.wait();
    
    // Get shard address from event
    const event = receipt.logs.find(log => {
      try {
        const parsed = sammPoolFactory.interface.parseLog(log);
        return parsed && parsed.name === 'ShardCreated';
      } catch {
        return false;
      }
    });
    
    const parsedEvent = sammPoolFactory.interface.parseLog(event);
    const shardAddress = parsedEvent.args.shard;
    
    // Approve tokens to factory
    await tokenA.approve(await sammPoolFactory.getAddress(), amountA);
    await tokenB.approve(await sammPoolFactory.getAddress(), amountB);
    
    // Initialize shard
    await sammPoolFactory.initializeShard(shardAddress, amountA, amountB);
    
    return shardAddress;
  }

  // ============ Task 11.1: Single-Hop Swap Integration Tests ============
  describe('11.1 Single-Hop Swap Integration Tests', function() {
    /**
     * Test direct A→B swap through smallest shard
     * Requirements: 1.1, 2.2, 6.1
     */
    it('should execute single-hop swap through smallest shard', async function() {
      const swapAmountOut = ethers.parseEther('10');
      const maxAmountIn = ethers.parseEther('15'); // Allow some slippage
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      // Approve router to spend user's tokens
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        maxAmountIn
      );
      
      // Record balances before swap
      const userABefore = await mockTokenA.balanceOf(user1.address);
      const userBBefore = await mockTokenB.balanceOf(user1.address);
      
      // Create swap path
      const path = {
        hops: [{
          tokenIn: await mockTokenA.getAddress(),
          tokenOut: await mockTokenB.getAddress(),
          amountOut: swapAmountOut
        }],
        maxAmountIn: maxAmountIn,
        deadline: deadline,
        recipient: user1.address
      };
      
      // Execute swap
      const tx = await crossPoolRouter.connect(user1).swapExactOutput(path);
      const receipt = await tx.wait();
      
      // Record balances after swap
      const userAAfter = await mockTokenA.balanceOf(user1.address);
      const userBAfter = await mockTokenB.balanceOf(user1.address);
      
      // Verify token transfers
      expect(userABefore - userAAfter).to.be.gt(0n, 'User should spend token A');
      expect(userBAfter - userBBefore).to.equal(swapAmountOut, 'User should receive exact output');
      
      // Verify smallest shard was selected (poolAB_small has smaller reserves)
      const swapEvent = receipt.logs.find(log => {
        try {
          const parsed = crossPoolRouter.interface.parseLog(log);
          return parsed && parsed.name === 'HopExecuted';
        } catch {
          return false;
        }
      });
      
      expect(swapEvent).to.not.be.undefined;
      const parsedSwapEvent = crossPoolRouter.interface.parseLog(swapEvent);
      expect(parsedSwapEvent.args.pool.toLowerCase()).to.equal(poolAB_small.toLowerCase());
    });

    it('should verify correct shard selection based on reserve size', async function() {
      const swapAmountOut = ethers.parseEther('5');
      
      // Get selected shard via quote
      const selectedShard = await crossPoolRouter.getSelectedShard(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress(),
        swapAmountOut
      );
      
      // Should select the smaller shard
      expect(selectedShard.toLowerCase()).to.equal(poolAB_small.toLowerCase());
    });

    it('should emit correct events for single-hop swap', async function() {
      const swapAmountOut = ethers.parseEther('10');
      const maxAmountIn = ethers.parseEther('15');
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        maxAmountIn
      );
      
      const path = {
        hops: [{
          tokenIn: await mockTokenA.getAddress(),
          tokenOut: await mockTokenB.getAddress(),
          amountOut: swapAmountOut
        }],
        maxAmountIn: maxAmountIn,
        deadline: deadline,
        recipient: user1.address
      };
      
      // Execute and check events
      await expect(crossPoolRouter.connect(user1).swapExactOutput(path))
        .to.emit(crossPoolRouter, 'HopExecuted')
        .to.emit(crossPoolRouter, 'SwapExecuted');
    });

    it('should handle different recipient address', async function() {
      const swapAmountOut = ethers.parseEther('10');
      const maxAmountIn = ethers.parseEther('15');
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        maxAmountIn
      );
      
      const user2BBefore = await mockTokenB.balanceOf(user2.address);
      
      const path = {
        hops: [{
          tokenIn: await mockTokenA.getAddress(),
          tokenOut: await mockTokenB.getAddress(),
          amountOut: swapAmountOut
        }],
        maxAmountIn: maxAmountIn,
        deadline: deadline,
        recipient: user2.address  // Different recipient
      };
      
      await crossPoolRouter.connect(user1).swapExactOutput(path);
      
      const user2BAfter = await mockTokenB.balanceOf(user2.address);
      expect(user2BAfter - user2BBefore).to.equal(swapAmountOut);
    });

    it('should revert when slippage exceeded', async function() {
      const swapAmountOut = ethers.parseEther('10');
      const maxAmountIn = ethers.parseEther('1'); // Too low
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        ethers.parseEther('100')
      );
      
      const path = {
        hops: [{
          tokenIn: await mockTokenA.getAddress(),
          tokenOut: await mockTokenB.getAddress(),
          amountOut: swapAmountOut
        }],
        maxAmountIn: maxAmountIn,
        deadline: deadline,
        recipient: user1.address
      };
      
      await expect(crossPoolRouter.connect(user1).swapExactOutput(path))
        .to.be.revertedWithCustomError(crossPoolRouter, 'ExcessiveSlippage');
    });

    it('should revert when deadline exceeded', async function() {
      const swapAmountOut = ethers.parseEther('10');
      const maxAmountIn = ethers.parseEther('15');
      const deadline = Math.floor(Date.now() / 1000) - 100; // Past deadline
      
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        maxAmountIn
      );
      
      const path = {
        hops: [{
          tokenIn: await mockTokenA.getAddress(),
          tokenOut: await mockTokenB.getAddress(),
          amountOut: swapAmountOut
        }],
        maxAmountIn: maxAmountIn,
        deadline: deadline,
        recipient: user1.address
      };
      
      await expect(crossPoolRouter.connect(user1).swapExactOutput(path))
        .to.be.revertedWithCustomError(crossPoolRouter, 'DeadlineExceeded');
    });
  });


  // ============ Task 11.2: Multi-Hop Swap Integration Tests ============
  describe('11.2 Multi-Hop Swap Integration Tests', function() {
    /**
     * Test A→B→C swap with 2 hops
     * Requirements: 1.1, 1.3, 5.5
     */
    it('should execute 2-hop swap (A→B→C) atomically', async function() {
      const finalAmountOut = ethers.parseEther('10');
      const maxAmountIn = ethers.parseEther('20');
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      // Approve router
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        maxAmountIn
      );
      
      // Record balances before
      const userABefore = await mockTokenA.balanceOf(user1.address);
      const userBBefore = await mockTokenB.balanceOf(user1.address);
      const userCBefore = await mockTokenC.balanceOf(user1.address);
      
      // Get quote first to determine intermediate amount
      const quote = await crossPoolRouter.quoteSwap([
        {
          tokenIn: await mockTokenA.getAddress(),
          tokenOut: await mockTokenB.getAddress(),
          amountOut: ethers.parseEther('10.5') // Intermediate amount (estimated)
        },
        {
          tokenIn: await mockTokenB.getAddress(),
          tokenOut: await mockTokenC.getAddress(),
          amountOut: finalAmountOut
        }
      ]);
      
      // Create 2-hop path
      const path = {
        hops: [
          {
            tokenIn: await mockTokenA.getAddress(),
            tokenOut: await mockTokenB.getAddress(),
            amountOut: quote.hopAmountsIn[1] // Use the required input for hop 2 as output for hop 1
          },
          {
            tokenIn: await mockTokenB.getAddress(),
            tokenOut: await mockTokenC.getAddress(),
            amountOut: finalAmountOut
          }
        ],
        maxAmountIn: maxAmountIn,
        deadline: deadline,
        recipient: user1.address
      };
      
      // Execute swap
      const tx = await crossPoolRouter.connect(user1).swapExactOutput(path);
      const receipt = await tx.wait();
      
      // Record balances after
      const userAAfter = await mockTokenA.balanceOf(user1.address);
      const userBAfter = await mockTokenB.balanceOf(user1.address);
      const userCAfter = await mockTokenC.balanceOf(user1.address);
      
      // Verify atomic execution
      expect(userABefore - userAAfter).to.be.gt(0n, 'User should spend token A');
      expect(userBAfter).to.equal(userBBefore, 'Intermediate token B should not change');
      expect(userCAfter - userCBefore).to.equal(finalAmountOut, 'User should receive exact output C');
      
      // Verify both HopExecuted events were emitted
      const hopEvents = receipt.logs.filter(log => {
        try {
          const parsed = crossPoolRouter.interface.parseLog(log);
          return parsed && parsed.name === 'HopExecuted';
        } catch {
          return false;
        }
      });
      
      expect(hopEvents.length).to.equal(2, 'Should emit 2 HopExecuted events');
    });

    /**
     * Test A→B→C→D swap with 3 hops
     * Requirements: 1.1, 1.3, 5.5
     */
    it('should execute 3-hop swap (A→B→C→D) atomically', async function() {
      const finalAmountOut = ethers.parseEther('5');
      const maxAmountIn = ethers.parseEther('20');
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      // Approve router
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        maxAmountIn
      );
      
      // Record balances before
      const userABefore = await mockTokenA.balanceOf(user1.address);
      const userDBefore = await mockTokenD.balanceOf(user1.address);
      
      // Get quote to determine intermediate amounts
      const quote = await crossPoolRouter.quoteSwap([
        {
          tokenIn: await mockTokenA.getAddress(),
          tokenOut: await mockTokenB.getAddress(),
          amountOut: ethers.parseEther('6') // Will be recalculated
        },
        {
          tokenIn: await mockTokenB.getAddress(),
          tokenOut: await mockTokenC.getAddress(),
          amountOut: ethers.parseEther('5.5')
        },
        {
          tokenIn: await mockTokenC.getAddress(),
          tokenOut: await mockTokenD.getAddress(),
          amountOut: finalAmountOut
        }
      ]);
      
      // Create 3-hop path using quote results
      const path = {
        hops: [
          {
            tokenIn: await mockTokenA.getAddress(),
            tokenOut: await mockTokenB.getAddress(),
            amountOut: quote.hopAmountsIn[1]
          },
          {
            tokenIn: await mockTokenB.getAddress(),
            tokenOut: await mockTokenC.getAddress(),
            amountOut: quote.hopAmountsIn[2]
          },
          {
            tokenIn: await mockTokenC.getAddress(),
            tokenOut: await mockTokenD.getAddress(),
            amountOut: finalAmountOut
          }
        ],
        maxAmountIn: maxAmountIn,
        deadline: deadline,
        recipient: user1.address
      };
      
      // Execute swap
      const tx = await crossPoolRouter.connect(user1).swapExactOutput(path);
      const receipt = await tx.wait();
      
      // Record balances after
      const userAAfter = await mockTokenA.balanceOf(user1.address);
      const userDAfter = await mockTokenD.balanceOf(user1.address);
      
      // Verify atomic execution
      expect(userABefore - userAAfter).to.be.gt(0n, 'User should spend token A');
      expect(userDAfter - userDBefore).to.equal(finalAmountOut, 'User should receive exact output D');
      
      // Verify all HopExecuted events
      const hopEvents = receipt.logs.filter(log => {
        try {
          const parsed = crossPoolRouter.interface.parseLog(log);
          return parsed && parsed.name === 'HopExecuted';
        } catch {
          return false;
        }
      });
      
      expect(hopEvents.length).to.equal(3, 'Should emit 3 HopExecuted events');
    });

    it('should select smallest shards for each hop in multi-hop swap', async function() {
      const finalAmountOut = ethers.parseEther('5');
      const maxAmountIn = ethers.parseEther('20');
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        maxAmountIn
      );
      
      // Get quote to see selected shards
      const quote = await crossPoolRouter.quoteSwap([
        {
          tokenIn: await mockTokenA.getAddress(),
          tokenOut: await mockTokenB.getAddress(),
          amountOut: ethers.parseEther('6')
        },
        {
          tokenIn: await mockTokenB.getAddress(),
          tokenOut: await mockTokenC.getAddress(),
          amountOut: finalAmountOut
        }
      ]);
      
      // Verify smallest shards are selected
      expect(quote.selectedShards[0].toLowerCase()).to.equal(poolAB_small.toLowerCase());
      expect(quote.selectedShards[1].toLowerCase()).to.equal(poolBC_small.toLowerCase());
    });

    it('should return correct SwapResult with all hop details', async function() {
      const finalAmountOut = ethers.parseEther('10');
      const maxAmountIn = ethers.parseEther('20');
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        maxAmountIn
      );
      
      // Get quote first
      const quote = await crossPoolRouter.quoteSwap([
        {
          tokenIn: await mockTokenA.getAddress(),
          tokenOut: await mockTokenB.getAddress(),
          amountOut: ethers.parseEther('10.5')
        },
        {
          tokenIn: await mockTokenB.getAddress(),
          tokenOut: await mockTokenC.getAddress(),
          amountOut: finalAmountOut
        }
      ]);
      
      const path = {
        hops: [
          {
            tokenIn: await mockTokenA.getAddress(),
            tokenOut: await mockTokenB.getAddress(),
            amountOut: quote.hopAmountsIn[1]
          },
          {
            tokenIn: await mockTokenB.getAddress(),
            tokenOut: await mockTokenC.getAddress(),
            amountOut: finalAmountOut
          }
        ],
        maxAmountIn: maxAmountIn,
        deadline: deadline,
        recipient: user1.address
      };
      
      // Execute and get result via events (since we can't get return value from non-view)
      const tx = await crossPoolRouter.connect(user1).swapExactOutput(path);
      const receipt = await tx.wait();
      
      // Parse SwapExecuted event
      const swapEvent = receipt.logs.find(log => {
        try {
          const parsed = crossPoolRouter.interface.parseLog(log);
          return parsed && parsed.name === 'SwapExecuted';
        } catch {
          return false;
        }
      });
      
      const parsedSwapEvent = crossPoolRouter.interface.parseLog(swapEvent);
      
      expect(parsedSwapEvent.args.numHops).to.equal(2n);
      expect(parsedSwapEvent.args.amountOut).to.equal(finalAmountOut);
      expect(parsedSwapEvent.args.amountIn).to.be.gt(0n);
    });
  });


  // ============ Task 11.3: Failure/Rollback Integration Tests ============
  describe('11.3 Failure/Rollback Integration Tests', function() {
    /**
     * Test partial failure scenarios and complete rollback
     * Requirements: 1.2
     */
    it('should rollback completely when second hop fails due to slippage', async function() {
      const finalAmountOut = ethers.parseEther('10');
      const maxAmountIn = ethers.parseEther('5'); // Too low - will cause slippage error
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        ethers.parseEther('100')
      );
      
      // Record balances before
      const userABefore = await mockTokenA.balanceOf(user1.address);
      const userBBefore = await mockTokenB.balanceOf(user1.address);
      const userCBefore = await mockTokenC.balanceOf(user1.address);
      
      const path = {
        hops: [
          {
            tokenIn: await mockTokenA.getAddress(),
            tokenOut: await mockTokenB.getAddress(),
            amountOut: ethers.parseEther('10')
          },
          {
            tokenIn: await mockTokenB.getAddress(),
            tokenOut: await mockTokenC.getAddress(),
            amountOut: finalAmountOut
          }
        ],
        maxAmountIn: maxAmountIn,
        deadline: deadline,
        recipient: user1.address
      };
      
      // Expect revert
      await expect(crossPoolRouter.connect(user1).swapExactOutput(path))
        .to.be.revertedWithCustomError(crossPoolRouter, 'ExcessiveSlippage');
      
      // Verify complete rollback - all balances unchanged
      const userAAfter = await mockTokenA.balanceOf(user1.address);
      const userBAfter = await mockTokenB.balanceOf(user1.address);
      const userCAfter = await mockTokenC.balanceOf(user1.address);
      
      expect(userAAfter).to.equal(userABefore, 'Token A balance should be unchanged');
      expect(userBAfter).to.equal(userBBefore, 'Token B balance should be unchanged');
      expect(userCAfter).to.equal(userCBefore, 'Token C balance should be unchanged');
    });

    it('should rollback when path validation fails', async function() {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        ethers.parseEther('100')
      );
      
      // Record balances before
      const userABefore = await mockTokenA.balanceOf(user1.address);
      
      // Create disconnected path (A→B, then C→D instead of B→C)
      const path = {
        hops: [
          {
            tokenIn: await mockTokenA.getAddress(),
            tokenOut: await mockTokenB.getAddress(),
            amountOut: ethers.parseEther('10')
          },
          {
            tokenIn: await mockTokenC.getAddress(), // Wrong! Should be tokenB
            tokenOut: await mockTokenD.getAddress(),
            amountOut: ethers.parseEther('5')
          }
        ],
        maxAmountIn: ethers.parseEther('20'),
        deadline: deadline,
        recipient: user1.address
      };
      
      // Expect revert due to path not connected
      await expect(crossPoolRouter.connect(user1).swapExactOutput(path))
        .to.be.revertedWithCustomError(crossPoolRouter, 'PathNotConnected');
      
      // Verify no tokens were transferred
      const userAAfter = await mockTokenA.balanceOf(user1.address);
      expect(userAAfter).to.equal(userABefore, 'Token A balance should be unchanged');
    });

    it('should rollback when deadline is exceeded', async function() {
      const deadline = Math.floor(Date.now() / 1000) - 100; // Past deadline
      
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        ethers.parseEther('100')
      );
      
      const userABefore = await mockTokenA.balanceOf(user1.address);
      
      const path = {
        hops: [
          {
            tokenIn: await mockTokenA.getAddress(),
            tokenOut: await mockTokenB.getAddress(),
            amountOut: ethers.parseEther('10')
          }
        ],
        maxAmountIn: ethers.parseEther('20'),
        deadline: deadline,
        recipient: user1.address
      };
      
      await expect(crossPoolRouter.connect(user1).swapExactOutput(path))
        .to.be.revertedWithCustomError(crossPoolRouter, 'DeadlineExceeded');
      
      const userAAfter = await mockTokenA.balanceOf(user1.address);
      expect(userAAfter).to.equal(userABefore);
    });

    it('should rollback when recipient is zero address', async function() {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        ethers.parseEther('100')
      );
      
      const userABefore = await mockTokenA.balanceOf(user1.address);
      
      const path = {
        hops: [
          {
            tokenIn: await mockTokenA.getAddress(),
            tokenOut: await mockTokenB.getAddress(),
            amountOut: ethers.parseEther('10')
          }
        ],
        maxAmountIn: ethers.parseEther('20'),
        deadline: deadline,
        recipient: ethers.ZeroAddress
      };
      
      await expect(crossPoolRouter.connect(user1).swapExactOutput(path))
        .to.be.revertedWithCustomError(crossPoolRouter, 'InvalidRecipient');
      
      const userAAfter = await mockTokenA.balanceOf(user1.address);
      expect(userAAfter).to.equal(userABefore);
    });

    it('should rollback when hop count exceeds maximum', async function() {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        ethers.parseEther('100')
      );
      
      const userABefore = await mockTokenA.balanceOf(user1.address);
      
      // Create path with 5 hops (exceeds MAX_HOPS = 4)
      const path = {
        hops: [
          { tokenIn: await mockTokenA.getAddress(), tokenOut: await mockTokenB.getAddress(), amountOut: ethers.parseEther('10') },
          { tokenIn: await mockTokenB.getAddress(), tokenOut: await mockTokenC.getAddress(), amountOut: ethers.parseEther('9') },
          { tokenIn: await mockTokenC.getAddress(), tokenOut: await mockTokenD.getAddress(), amountOut: ethers.parseEther('8') },
          { tokenIn: await mockTokenD.getAddress(), tokenOut: await mockTokenA.getAddress(), amountOut: ethers.parseEther('7') },
          { tokenIn: await mockTokenA.getAddress(), tokenOut: await mockTokenB.getAddress(), amountOut: ethers.parseEther('6') }
        ],
        maxAmountIn: ethers.parseEther('50'),
        deadline: deadline,
        recipient: user1.address
      };
      
      await expect(crossPoolRouter.connect(user1).swapExactOutput(path))
        .to.be.revertedWithCustomError(crossPoolRouter, 'InvalidHopCount');
      
      const userAAfter = await mockTokenA.balanceOf(user1.address);
      expect(userAAfter).to.equal(userABefore);
    });

    it('should rollback when empty path provided', async function() {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        ethers.parseEther('100')
      );
      
      const userABefore = await mockTokenA.balanceOf(user1.address);
      
      const path = {
        hops: [],
        maxAmountIn: ethers.parseEther('20'),
        deadline: deadline,
        recipient: user1.address
      };
      
      await expect(crossPoolRouter.connect(user1).swapExactOutput(path))
        .to.be.revertedWithCustomError(crossPoolRouter, 'InvalidHopCount');
      
      const userAAfter = await mockTokenA.balanceOf(user1.address);
      expect(userAAfter).to.equal(userABefore);
    });

    it('should preserve pool reserves on failed swap', async function() {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      // Get pool reserves before
      const poolAB = await ethers.getContractAt('SAMMPool', poolAB_small);
      const [reserveABefore, reserveBBefore] = await poolAB.getReserves();
      
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        ethers.parseEther('100')
      );
      
      // Try swap with too low maxAmountIn
      const path = {
        hops: [
          {
            tokenIn: await mockTokenA.getAddress(),
            tokenOut: await mockTokenB.getAddress(),
            amountOut: ethers.parseEther('10')
          }
        ],
        maxAmountIn: ethers.parseEther('1'), // Too low
        deadline: deadline,
        recipient: user1.address
      };
      
      await expect(crossPoolRouter.connect(user1).swapExactOutput(path))
        .to.be.revertedWithCustomError(crossPoolRouter, 'ExcessiveSlippage');
      
      // Verify pool reserves unchanged
      const [reserveAAfter, reserveBAfter] = await poolAB.getReserves();
      expect(reserveAAfter).to.equal(reserveABefore);
      expect(reserveBAfter).to.equal(reserveBBefore);
    });
  });


  // ============ Task 11.4: Factory Integration Tests ============
  describe('11.4 Factory Integration Tests', function() {
    /**
     * Test shard discovery from factory
     * Requirements: 8.1, 8.2, 8.4
     */
    it('should discover all shards for a token pair from factory', async function() {
      // Get shards for A-B pair
      const shardsAB = await sammPoolFactory.getShardsForPair(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress()
      );
      
      // Should have 2 shards (small and large)
      expect(shardsAB.length).to.equal(2);
      expect(shardsAB).to.include(poolAB_small);
      expect(shardsAB).to.include(poolAB_large);
    });

    it('should filter out inactive shards when selecting', async function() {
      // Deactivate the small shard
      await sammPoolFactory.deactivateShard(poolAB_small);
      
      // Now get selected shard - should be the large one
      const selectedShard = await crossPoolRouter.getSelectedShard(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress(),
        ethers.parseEther('5')
      );
      
      expect(selectedShard.toLowerCase()).to.equal(poolAB_large.toLowerCase());
    });

    it('should revert when no pools available for token pair', async function() {
      // Deploy new tokens without pools
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const newTokenX = await MockERC20.deploy('Token X', 'TKNX', 18);
      const newTokenY = await MockERC20.deploy('Token Y', 'TKNY', 18);
      
      await newTokenX.waitForDeployment();
      await newTokenY.waitForDeployment();
      
      // Mint tokens to user
      await newTokenX.mint(user1.address, ethers.parseEther('1000'));
      
      await newTokenX.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        ethers.parseEther('100')
      );
      
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      const path = {
        hops: [
          {
            tokenIn: await newTokenX.getAddress(),
            tokenOut: await newTokenY.getAddress(),
            amountOut: ethers.parseEther('10')
          }
        ],
        maxAmountIn: ethers.parseEther('20'),
        deadline: deadline,
        recipient: user1.address
      };
      
      await expect(crossPoolRouter.connect(user1).swapExactOutput(path))
        .to.be.revertedWithCustomError(crossPoolRouter, 'NoPoolsAvailable');
    });

    it('should use factory to get shard info for validation', async function() {
      // Get shard info from factory
      const shardInfo = await sammPoolFactory.getShardInfo(poolAB_small);
      
      expect(shardInfo.isActive).to.be.true;
      expect(shardInfo.tokenA.toLowerCase()).to.equal((await mockTokenA.getAddress()).toLowerCase());
      expect(shardInfo.tokenB.toLowerCase()).to.equal((await mockTokenB.getAddress()).toLowerCase());
    });

    it('should handle token pair ordering correctly', async function() {
      // Query with reversed token order
      const shardsReversed = await sammPoolFactory.getShardsForPair(
        await mockTokenB.getAddress(),
        await mockTokenA.getAddress()
      );
      
      const shardsNormal = await sammPoolFactory.getShardsForPair(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress()
      );
      
      // Should return same shards regardless of order
      expect(shardsReversed.length).to.equal(shardsNormal.length);
      expect(shardsReversed).to.deep.equal(shardsNormal);
    });

    it('should work with updated factory address', async function() {
      // Deploy new factory
      const SAMMPoolFactory = await ethers.getContractFactory('SAMMPoolFactory');
      const newFactory = await SAMMPoolFactory.deploy();
      await newFactory.waitForDeployment();
      
      // Update router's factory
      await crossPoolRouter.setFactory(await newFactory.getAddress());
      
      // Verify factory was updated
      expect(await crossPoolRouter.factory()).to.equal(await newFactory.getAddress());
      
      // Now swaps should fail because new factory has no pools
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      await mockTokenA.connect(user1).approve(
        await crossPoolRouter.getAddress(),
        ethers.parseEther('100')
      );
      
      const path = {
        hops: [
          {
            tokenIn: await mockTokenA.getAddress(),
            tokenOut: await mockTokenB.getAddress(),
            amountOut: ethers.parseEther('10')
          }
        ],
        maxAmountIn: ethers.parseEther('20'),
        deadline: deadline,
        recipient: user1.address
      };
      
      await expect(crossPoolRouter.connect(user1).swapExactOutput(path))
        .to.be.revertedWithCustomError(crossPoolRouter, 'NoPoolsAvailable');
      
      // Restore original factory for other tests
      await crossPoolRouter.setFactory(await sammPoolFactory.getAddress());
    });

    it('should emit FactoryUpdated event when factory is changed', async function() {
      const SAMMPoolFactory = await ethers.getContractFactory('SAMMPoolFactory');
      const newFactory = await SAMMPoolFactory.deploy();
      await newFactory.waitForDeployment();
      
      const oldFactoryAddress = await crossPoolRouter.factory();
      
      await expect(crossPoolRouter.setFactory(await newFactory.getAddress()))
        .to.emit(crossPoolRouter, 'FactoryUpdated')
        .withArgs(oldFactoryAddress, await newFactory.getAddress());
      
      // Restore original factory
      await crossPoolRouter.setFactory(await sammPoolFactory.getAddress());
    });

    it('should revert when setting factory to zero address', async function() {
      await expect(crossPoolRouter.setFactory(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(crossPoolRouter, 'InvalidFactory');
    });

    it('should only allow owner to update factory', async function() {
      const SAMMPoolFactory = await ethers.getContractFactory('SAMMPoolFactory');
      const newFactory = await SAMMPoolFactory.deploy();
      await newFactory.waitForDeployment();
      
      await expect(crossPoolRouter.connect(user1).setFactory(await newFactory.getAddress()))
        .to.be.revertedWithCustomError(crossPoolRouter, 'OwnableUnauthorizedAccount');
    });

    it('should correctly count shards for token pair', async function() {
      const count = await sammPoolFactory.getShardCount(
        await mockTokenA.getAddress(),
        await mockTokenB.getAddress()
      );
      
      expect(count).to.equal(2n); // We created 2 A-B pools
    });
  });
});
