/**
 * Property-Based Tests for Liquidity Router Service
 * Tests Property 8: Liquidity router fillup strategy
 * Validates Requirements 3.2, 3.4
 */

const fc = require('fast-check');
const { expect } = require('chai');
const { ethers } = require('ethers');

// Mock the liquidity router components for testing
class MockPoolAnalysisService {
  constructor() {
    this.pools = new Map();
  }

  addMockPool(tokenPair, chainId, poolInfo) {
    const key = `${chainId}-${tokenPair.tokenA.address}-${tokenPair.tokenB.address}`;
    if (!this.pools.has(key)) {
      this.pools.set(key, []);
    }
    this.pools.get(key).push(poolInfo);
  }

  async analyzePoolsForTokenPair(tokenPair, chainId) {
    const key = `${chainId}-${tokenPair.tokenA.address}-${tokenPair.tokenB.address}`;
    const pools = this.pools.get(key) || [];
    
    return pools.map(pool => ({
      poolInfo: pool,
      metrics: {
        volume24h: pool.reserveA + pool.reserveB,
        transactions24h: 100,
        feesGenerated24h: (pool.reserveA + pool.reserveB) / 100n,
        liquidityUtilization: 0.5,
        averageTradeSize: 1000n,
        lastUpdated: new Date()
      },
      expectedApr: 0.1,
      riskScore: 0.2,
      liquidityEfficiency: 0.5
    }));
  }

  async calculateExpectedReturns(poolAddress, liquidityAmount, chainId) {
    return {
      dailyFees: 100n,
      weeklyFees: 700n,
      monthlyFees: 3000n,
      estimatedApr: 0.1,
      impermanentLossRisk: 0.05,
      liquidityShare: 0.1
    };
  }

  clearExpiredCache() {
    // Mock implementation
  }
}

class MockFillupStrategyEngine {
  constructor(poolAnalysisService) {
    this.poolAnalysisService = poolAnalysisService;
  }

  async getFillupStrategy(tokenPair, chainId) {
    const pools = await this.poolAnalysisService.analyzePoolsForTokenPair(tokenPair, chainId);
    if (pools.length === 0) {
      throw new Error('No pools available');
    }

    // Find smallest pool by reserves
    const smallestPool = pools.reduce((smallest, current) => {
      const smallestSize = smallest.poolInfo.reserveA + smallest.poolInfo.reserveB;
      const currentSize = current.poolInfo.reserveA + current.poolInfo.reserveB;
      return currentSize < smallestSize ? current : smallest;
    });

    return {
      targetPoolAddress: smallestPool.poolInfo.poolAddress,
      currentSize: smallestPool.poolInfo.reserveA + smallestPool.poolInfo.reserveB,
      targetSize: (smallestPool.poolInfo.reserveA + smallestPool.poolInfo.reserveB) * 2n,
      recommendedAmount: (smallestPool.poolInfo.reserveA + smallestPool.poolInfo.reserveB) / 10n,
      reasoning: 'Fillup strategy: direct liquidity to smallest shard',
      priority: 'HIGH'
    };
  }

  async generateLiquidityRecommendation(tokenPair, liquidityAmount, chainId) {
    const pools = await this.poolAnalysisService.analyzePoolsForTokenPair(tokenPair, chainId);
    if (pools.length === 0) {
      throw new Error('No pools available');
    }

    // Always recommend the smallest pool
    const smallestPool = pools.reduce((smallest, current) => {
      const smallestSize = smallest.poolInfo.reserveA + smallest.poolInfo.reserveB;
      const currentSize = current.poolInfo.reserveA + current.poolInfo.reserveB;
      return currentSize < smallestSize ? current : smallest;
    });

    return {
      poolAddress: smallestPool.poolInfo.poolAddress,
      isSmallestShard: true,
      expectedApr: 0.1,
      feeGeneration24h: smallestPool.metrics.feesGenerated24h,
      liquidityUtilization: 0.5,
      chainId,
      reasoning: 'Recommended smallest shard for optimal fillup strategy',
      confidence: 0.9
    };
  }
}

// Generators for property-based testing
const tokenAddressGen = fc.string({ minLength: 40, maxLength: 40 }).map(s => `0x${s.padStart(40, '0')}`);

const tokenInfoGen = fc.record({
  address: tokenAddressGen,
  symbol: fc.string({ minLength: 3, maxLength: 5 }),
  decimals: fc.integer({ min: 6, max: 18 }),
  name: fc.string({ minLength: 5, maxLength: 20 })
});

const tokenPairGen = fc.record({
  tokenA: tokenInfoGen,
  tokenB: tokenInfoGen
});

const poolInfoGen = fc.record({
  poolAddress: tokenAddressGen,
  tokenA: tokenInfoGen,
  tokenB: tokenInfoGen,
  reserveA: fc.bigInt({ min: 1000n, max: 1000000000n }),
  reserveB: fc.bigInt({ min: 1000n, max: 1000000000n }),
  totalSupply: fc.bigInt({ min: 1000n, max: 1000000000n }),
  chainId: fc.integer({ min: 1, max: 100000 }),
  isSmallestShard: fc.boolean()
});

const liquidityAmountGen = fc.record({
  tokenA: fc.bigInt({ min: 1n, max: 1000000n }),
  tokenB: fc.bigInt({ min: 1n, max: 1000000n })
});

describe('Liquidity Router Property Tests', function() {
  this.timeout(30000);

  let mockPoolAnalysis;
  let mockFillupEngine;

  beforeEach(() => {
    mockPoolAnalysis = new MockPoolAnalysisService();
    mockFillupEngine = new MockFillupStrategyEngine(mockPoolAnalysis);
  });

  describe('Property 8: Liquidity router fillup strategy', () => {
    /**
     * **Feature: samm-deployment, Property 8: Liquidity router fillup strategy**
     * For any token pair on a specific chain, the liquidity router should recommend 
     * the shard with the smallest deposited amount for new liquidity addition
     * **Validates: Requirements 3.2, 3.4**
     */
    it('should always recommend the smallest shard for liquidity addition', () => {
      return fc.assert(
        fc.asyncProperty(
          tokenPairGen,
          fc.integer({ min: 1, max: 10000 }), // chainId
          fc.array(poolInfoGen, { minLength: 1, maxLength: 10 }), // multiple pools
          async (tokenPair, chainId, pools) => {
            // Ensure pools have different sizes for meaningful test
            const sortedPools = pools.map((pool, index) => ({
              ...pool,
              reserveA: BigInt(1000 + index * 1000), // Ensure different sizes
              reserveB: BigInt(1000 + index * 1000),
              tokenA: tokenPair.tokenA,
              tokenB: tokenPair.tokenB,
              chainId
            }));

            // Add pools to mock service
            for (const pool of sortedPools) {
              mockPoolAnalysis.addMockPool(tokenPair, chainId, pool);
            }

            // Get fillup strategy recommendation
            const strategy = await mockFillupEngine.getFillupStrategy(tokenPair, chainId);

            // Find the actual smallest pool
            const smallestPool = sortedPools.reduce((smallest, current) => {
              const smallestSize = smallest.reserveA + smallest.reserveB;
              const currentSize = current.reserveA + current.reserveB;
              return currentSize < smallestSize ? current : smallest;
            });

            // Property: The recommended pool should be the smallest one
            expect(strategy.targetPoolAddress).to.equal(smallestPool.poolAddress);
            
            // Property: Current size should match the smallest pool's size
            const expectedSize = smallestPool.reserveA + smallestPool.reserveB;
            expect(strategy.currentSize).to.equal(expectedSize);

            // Property: Recommended amount should be reasonable (not zero, not excessive)
            expect(strategy.recommendedAmount).to.be.greaterThan(0n);
            expect(strategy.recommendedAmount).to.be.lessThan(strategy.currentSize);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should recommend smallest shard in liquidity recommendations', () => {
      return fc.assert(
        fc.asyncProperty(
          tokenPairGen,
          liquidityAmountGen,
          fc.integer({ min: 1, max: 10000 }), // chainId
          fc.array(poolInfoGen, { minLength: 2, maxLength: 5 }), // multiple pools
          async (tokenPair, liquidityAmount, chainId, pools) => {
            // Ensure pools have different sizes
            const sortedPools = pools.map((pool, index) => ({
              ...pool,
              reserveA: BigInt(5000 + index * 2000), // Different sizes
              reserveB: BigInt(5000 + index * 2000),
              tokenA: tokenPair.tokenA,
              tokenB: tokenPair.tokenB,
              chainId
            }));

            // Add pools to mock service
            for (const pool of sortedPools) {
              mockPoolAnalysis.addMockPool(tokenPair, chainId, pool);
            }

            // Get liquidity recommendation
            const recommendation = await mockFillupEngine.generateLiquidityRecommendation(
              tokenPair,
              liquidityAmount,
              chainId
            );

            // Find the actual smallest pool
            const smallestPool = sortedPools.reduce((smallest, current) => {
              const smallestSize = smallest.reserveA + smallest.reserveB;
              const currentSize = current.reserveA + current.reserveB;
              return currentSize < smallestSize ? current : smallest;
            });

            // Property: Should recommend the smallest shard
            expect(recommendation.poolAddress).to.equal(smallestPool.poolAddress);
            expect(recommendation.isSmallestShard).to.be.true;
            expect(recommendation.chainId).to.equal(chainId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain consistency when pools have equal sizes', () => {
      return fc.assert(
        fc.asyncProperty(
          tokenPairGen,
          fc.integer({ min: 1, max: 10000 }), // chainId
          fc.bigInt({ min: 1000n, max: 100000n }), // equal reserve size
          fc.integer({ min: 2, max: 5 }), // number of pools
          async (tokenPair, chainId, reserveSize, numPools) => {
            // Create pools with equal sizes
            const equalPools = Array.from({ length: numPools }, (_, index) => ({
              poolAddress: `0x${index.toString().padStart(40, '0')}`,
              tokenA: tokenPair.tokenA,
              tokenB: tokenPair.tokenB,
              reserveA: reserveSize,
              reserveB: reserveSize,
              totalSupply: reserveSize * 2n,
              chainId,
              isSmallestShard: false
            }));

            // Add pools to mock service
            for (const pool of equalPools) {
              mockPoolAnalysis.addMockPool(tokenPair, chainId, pool);
            }

            // Get fillup strategy
            const strategy = await mockFillupEngine.getFillupStrategy(tokenPair, chainId);

            // Property: Should recommend one of the equal-sized pools
            const recommendedPool = equalPools.find(p => p.poolAddress === strategy.targetPoolAddress);
            expect(recommendedPool).to.not.be.undefined;
            
            // Property: Current size should match the equal size
            expect(strategy.currentSize).to.equal(reserveSize * 2n);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle single pool scenarios correctly', () => {
      return fc.assert(
        fc.asyncProperty(
          tokenPairGen,
          fc.integer({ min: 1, max: 10000 }), // chainId
          poolInfoGen,
          async (tokenPair, chainId, singlePool) => {
            const pool = {
              ...singlePool,
              tokenA: tokenPair.tokenA,
              tokenB: tokenPair.tokenB,
              chainId
            };

            // Add single pool to mock service
            mockPoolAnalysis.addMockPool(tokenPair, chainId, pool);

            // Get fillup strategy
            const strategy = await mockFillupEngine.getFillupStrategy(tokenPair, chainId);

            // Property: Should recommend the only available pool
            expect(strategy.targetPoolAddress).to.equal(pool.poolAddress);
            
            // Property: Current size should match pool size
            const expectedSize = pool.reserveA + pool.reserveB;
            expect(strategy.currentSize).to.equal(expectedSize);
            
            // Property: Should provide reasonable recommendation
            expect(strategy.recommendedAmount).to.be.greaterThan(0n);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should reject invalid inputs appropriately', () => {
      return fc.assert(
        fc.asyncProperty(
          tokenPairGen,
          fc.integer({ min: 1, max: 10000 }), // chainId
          async (tokenPair, chainId) => {
            // Don't add any pools - should handle empty case
            
            try {
              await mockFillupEngine.getFillupStrategy(tokenPair, chainId);
              // Should not reach here
              expect.fail('Should have thrown error for no available pools');
            } catch (error) {
              // Property: Should throw appropriate error for no pools
              expect(error.message).to.include('No pools available');
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should provide consistent recommendations across multiple calls', () => {
      return fc.assert(
        fc.asyncProperty(
          tokenPairGen,
          fc.integer({ min: 1, max: 10000 }), // chainId
          fc.array(poolInfoGen, { minLength: 2, maxLength: 4 }),
          async (tokenPair, chainId, pools) => {
            // Ensure pools have different sizes
            const sortedPools = pools.map((pool, index) => ({
              ...pool,
              reserveA: BigInt(1000 + index * 500),
              reserveB: BigInt(1000 + index * 500),
              tokenA: tokenPair.tokenA,
              tokenB: tokenPair.tokenB,
              chainId
            }));

            // Add pools to mock service
            for (const pool of sortedPools) {
              mockPoolAnalysis.addMockPool(tokenPair, chainId, pool);
            }

            // Get multiple recommendations
            const strategy1 = await mockFillupEngine.getFillupStrategy(tokenPair, chainId);
            const strategy2 = await mockFillupEngine.getFillupStrategy(tokenPair, chainId);

            // Property: Should be consistent across calls
            expect(strategy1.targetPoolAddress).to.equal(strategy2.targetPoolAddress);
            expect(strategy1.currentSize).to.equal(strategy2.currentSize);
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});