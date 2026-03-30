/**
 * test/integrations/ChainlinkPriceValidator.test.js
 * Tests for ChainlinkPriceValidator using MockV3Aggregator
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ChainlinkPriceValidator", function () {
  let validator;
  let mockFeedA, mockFeedB;
  let tokenA, tokenB, tokenC;
  let owner, user;

  const MAX_DEVIATION_BPS = 500; // 5%
  const STALENESS_THRESHOLD = 3600; // 1 hour

  // ETH price: $2000 (8 decimals)
  const ETH_PRICE = 2000n * 10n ** 8n;
  // BTC price: $40000 (8 decimals)
  const BTC_PRICE = 40000n * 10n ** 8n;
  // USDC price: $1 (8 decimals)
  const USDC_PRICE = 1n * 10n ** 8n;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy mock feeds (8 decimals — same as real Chainlink)
    const MockFeed = await ethers.getContractFactory("MockV3Aggregator");
    mockFeedA = await MockFeed.deploy(8, ETH_PRICE);
    mockFeedB = await MockFeed.deploy(8, BTC_PRICE);
    const mockFeedC = await MockFeed.deploy(8, USDC_PRICE);

    await mockFeedA.waitForDeployment();
    await mockFeedB.waitForDeployment();
    await mockFeedC.waitForDeployment();

    // Use arbitrary addresses as token addresses
    tokenA = ethers.Wallet.createRandom().address;
    tokenB = ethers.Wallet.createRandom().address;
    tokenC = ethers.Wallet.createRandom().address;

    const ValidatorFactory = await ethers.getContractFactory("ChainlinkPriceValidator");
    validator = await ValidatorFactory.deploy(MAX_DEVIATION_BPS, STALENESS_THRESHOLD);
    await validator.waitForDeployment();

    // Add feeds
    await validator.addFeed(tokenA, await mockFeedA.getAddress());
    await validator.addFeed(tokenB, await mockFeedB.getAddress());
    await validator.addFeed(tokenC, await mockFeedC.getAddress());
  });

  // ============ Feed Management ============

  describe("Feed Management", function () {
    it("owner can add a feed", async function () {
      const newToken = ethers.Wallet.createRandom().address;
      const MockFeed = await ethers.getContractFactory("MockV3Aggregator");
      const newFeed = await MockFeed.deploy(8, ETH_PRICE);
      await newFeed.waitForDeployment();

      await expect(validator.addFeed(newToken, await newFeed.getAddress()))
        .to.emit(validator, "FeedAdded")
        .withArgs(newToken, await newFeed.getAddress());

      expect(await validator.priceFeeds(newToken)).to.equal(await newFeed.getAddress());
    });

    it("non-owner cannot add a feed", async function () {
      const newToken = ethers.Wallet.createRandom().address;
      const MockFeed = await ethers.getContractFactory("MockV3Aggregator");
      const newFeed = await MockFeed.deploy(8, ETH_PRICE);
      await newFeed.waitForDeployment();

      await expect(
        validator.connect(user).addFeed(newToken, await newFeed.getAddress())
      ).to.be.reverted;
    });

    it("owner can remove a feed", async function () {
      await expect(validator.removeFeed(tokenA))
        .to.emit(validator, "FeedRemoved")
        .withArgs(tokenA);

      expect(await validator.priceFeeds(tokenA)).to.equal(ethers.ZeroAddress);
    });

    it("reverts when removing non-existent feed", async function () {
      const missing = ethers.Wallet.createRandom().address;
      await expect(validator.removeFeed(missing)).to.be.revertedWithCustomError(
        validator,
        "FeedNotFound"
      );
    });

    it("owner can update a feed", async function () {
      const MockFeed = await ethers.getContractFactory("MockV3Aggregator");
      const newFeed = await MockFeed.deploy(8, ETH_PRICE * 2n);
      await newFeed.waitForDeployment();

      const oldFeed = await validator.priceFeeds(tokenA);
      await expect(validator.updateFeed(tokenA, await newFeed.getAddress()))
        .to.emit(validator, "FeedUpdated")
        .withArgs(tokenA, oldFeed, await newFeed.getAddress());
    });

    it("owner can batch-add feeds", async function () {
      const MockFeed = await ethers.getContractFactory("MockV3Aggregator");
      const t1 = ethers.Wallet.createRandom().address;
      const t2 = ethers.Wallet.createRandom().address;
      const f1 = await MockFeed.deploy(8, 1n);
      const f2 = await MockFeed.deploy(8, 2n);
      await f1.waitForDeployment();
      await f2.waitForDeployment();

      await validator.addFeeds([t1, t2], [await f1.getAddress(), await f2.getAddress()]);
      expect(await validator.priceFeeds(t1)).to.equal(await f1.getAddress());
      expect(await validator.priceFeeds(t2)).to.equal(await f2.getAddress());
    });

    it("reverts on zero address in addFeed", async function () {
      await expect(
        validator.addFeed(ethers.ZeroAddress, await mockFeedA.getAddress())
      ).to.be.revertedWithCustomError(validator, "ZeroAddress");
    });
  });

  // ============ Price Retrieval ============

  describe("Price Retrieval", function () {
    it("returns correct price normalized to 18 decimals", async function () {
      const price = await validator.getTokenPrice(tokenA);
      // ETH_PRICE = 2000e8, normalized to 1e18 → 2000e18
      const expected = 2000n * 10n ** 18n;
      expect(price).to.equal(expected);
    });

    it("reverts when no feed is registered", async function () {
      const missing = ethers.Wallet.createRandom().address;
      await expect(validator.getTokenPrice(missing)).to.be.revertedWithCustomError(
        validator,
        "FeedNotFound"
      );
    });

    it("reverts on stale price", async function () {
      // Make updatedAt very old
      await mockFeedA.updateUpdatedAt(1); // epoch 1
      await expect(validator.getTokenPrice(tokenA)).to.be.revertedWithCustomError(
        validator,
        "StalePrice"
      );
    });

    it("reverts on zero/negative price", async function () {
      await mockFeedA.updateAnswer(0n);
      await expect(validator.getTokenPrice(tokenA)).to.be.revertedWithCustomError(
        validator,
        "InvalidPrice"
      );
    });
  });

  // ============ Price Validation ============

  describe("validateSwapPrice", function () {
    it("validates correct price within deviation", async function () {
      // ETH price = $2000, BTC price = $40000
      // Oracle ratio = ETH/BTC price = 2000/40000 = 0.05 (scaled by 1e18)
      const oraclePriceETH = 2000n * 10n ** 18n;
      const oraclePriceBTC = 40000n * 10n ** 18n;
      const expectedRatio = (oraclePriceETH * 10n ** 18n) / oraclePriceBTC;

      // A SAMM price within 1% of oracle
      const sammPrice = expectedRatio * 101n / 100n; // 1% above oracle

      const [isValid, oraclePrice, deviation] = await validator.validateSwapPrice(
        tokenA, tokenB, sammPrice
      );

      expect(isValid).to.be.true;
      expect(oraclePrice).to.equal(expectedRatio);
      expect(deviation).to.be.lt(MAX_DEVIATION_BPS);
    });

    it("rejects price exceeding max deviation", async function () {
      const oraclePriceETH = 2000n * 10n ** 18n;
      const oraclePriceBTC = 40000n * 10n ** 18n;
      const expectedRatio = (oraclePriceETH * 10n ** 18n) / oraclePriceBTC;

      // SAMM price 10% away from oracle (exceeds 5% threshold)
      const sammPrice = expectedRatio * 110n / 100n;

      const [isValid, , deviation] = await validator.validateSwapPrice(
        tokenA, tokenB, sammPrice
      );

      expect(isValid).to.be.false;
      expect(deviation).to.be.gte(MAX_DEVIATION_BPS);
    });

    it("owner can update max deviation", async function () {
      const newDeviation = 200; // 2%
      await expect(validator.setMaxDeviation(newDeviation))
        .to.emit(validator, "MaxDeviationUpdated")
        .withArgs(MAX_DEVIATION_BPS, newDeviation);

      expect(await validator.maxDeviation()).to.equal(newDeviation);
    });

    it("owner can update staleness threshold", async function () {
      const newThreshold = 7200;
      await expect(validator.setStalenessThreshold(newThreshold))
        .to.emit(validator, "StalenessThresholdUpdated")
        .withArgs(STALENESS_THRESHOLD, newThreshold);
    });
  });
});
