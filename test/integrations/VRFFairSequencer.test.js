/**
 * test/integrations/VRFFairSequencer.test.js
 * Tests for VRFFairSequencer using MockVRFCoordinator
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VRFFairSequencer", function () {
  let sequencer;
  let mockVRFCoordinator;
  let owner, user1, user2;
  let shard1, shard2, shard3;

  const SUBSCRIPTION_ID = 1n;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Use random addresses as mock shards
    shard1 = ethers.Wallet.createRandom().address;
    shard2 = ethers.Wallet.createRandom().address;
    shard3 = ethers.Wallet.createRandom().address;

    // Deploy mock VRF coordinator
    const MockVRFCoordinator = await ethers.getContractFactory("MockVRFCoordinator");
    mockVRFCoordinator = await MockVRFCoordinator.deploy();
    await mockVRFCoordinator.waitForDeployment();

    // Deploy sequencer
    const SequencerFactory = await ethers.getContractFactory("VRFFairSequencer");
    sequencer = await SequencerFactory.deploy(
      await mockVRFCoordinator.getAddress(),
      SUBSCRIPTION_ID
    );
    await sequencer.waitForDeployment();

    // Register eligible shards
    await sequencer.addEligibleShard(shard1);
    await sequencer.addEligibleShard(shard2);
    await sequencer.addEligibleShard(shard3);
  });

  // ============ Batch Submission ============

  describe("Batch Submission", function () {
    it("submits a batch and emits BatchSubmitted", async function () {
      const tokenIn = ethers.Wallet.createRandom().address;
      const tokenOut = ethers.Wallet.createRandom().address;

      const swaps = [
        { user: user1.address, tokenIn, tokenOut, amountOut: ethers.parseEther("1"), preferredShard: ethers.ZeroAddress },
        { user: user2.address, tokenIn, tokenOut, amountOut: ethers.parseEther("2"), preferredShard: ethers.ZeroAddress },
      ];

      const tx = await sequencer.connect(user1).submitBatch(swaps);
      const receipt = await tx.wait();

      const event = receipt.logs
        .map((l) => { try { return sequencer.interface.parseLog(l); } catch { return null; } })
        .find((e) => e?.name === "BatchSubmitted");

      expect(event).to.not.be.null;
      expect(event.args.batchId).to.equal(0n);
      expect(event.args.swapCount).to.equal(2n);
    });

    it("reverts on empty batch", async function () {
      await expect(sequencer.submitBatch([])).to.be.revertedWithCustomError(
        sequencer,
        "EmptyBatch"
      );
    });

    it("tracks batch swap count", async function () {
      const tokenIn = ethers.Wallet.createRandom().address;
      const tokenOut = ethers.Wallet.createRandom().address;

      const swaps = Array(5).fill({
        user: user1.address,
        tokenIn,
        tokenOut,
        amountOut: ethers.parseEther("1"),
        preferredShard: ethers.ZeroAddress,
      });

      await sequencer.submitBatch(swaps);
      expect(await sequencer.getBatchSwapCount(0)).to.equal(5n);
    });

    it("increments batchId for each submission", async function () {
      const tokenIn = ethers.Wallet.createRandom().address;
      const tokenOut = ethers.Wallet.createRandom().address;
      const singleSwap = [{
        user: user1.address, tokenIn, tokenOut,
        amountOut: ethers.parseEther("1"), preferredShard: ethers.ZeroAddress
      }];

      await sequencer.submitBatch(singleSwap);
      await sequencer.submitBatch(singleSwap);
      expect(await sequencer.nextBatchId()).to.equal(2n);
    });
  });

  // ============ VRF Callback ============

  describe("VRF Callback (fulfillRandomWords)", function () {
    let batchId;
    const RANDOM_SEED = 123456789n;

    beforeEach(async function () {
      const tokenIn = ethers.Wallet.createRandom().address;
      const tokenOut = ethers.Wallet.createRandom().address;

      const swaps = Array(4).fill({
        user: user1.address,
        tokenIn,
        tokenOut,
        amountOut: ethers.parseEther("1"),
        preferredShard: ethers.ZeroAddress,
      });

      const tx = await sequencer.submitBatch(swaps);
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((l) => { try { return sequencer.interface.parseLog(l); } catch { return null; } })
        .find((e) => e?.name === "BatchSubmitted");
      batchId = event.args.batchId;
    });

    it("fulfills batch and emits BatchSequenced", async function () {
      // The mock VRF coordinator assigns requestId=1 for the first request
      const vrfRequestId = 1n;

      await expect(
        mockVRFCoordinator.fulfillRandomWords(
          vrfRequestId,
          await sequencer.getAddress(),
          [RANDOM_SEED]
        )
      )
        .to.emit(sequencer, "BatchSequenced")
        .withArgs(batchId, RANDOM_SEED, 4n);

      expect(await sequencer.getBatchFulfilled(batchId)).to.be.true;
      expect(await sequencer.getBatchRandomSeed(batchId)).to.equal(RANDOM_SEED);
    });

    it("shuffles swap order deterministically from seed", async function () {
      const vrfRequestId = 1n;
      await mockVRFCoordinator.fulfillRandomWords(
        vrfRequestId,
        await sequencer.getAddress(),
        [RANDOM_SEED]
      );

      const shuffled = await sequencer.getBatchShuffledOrder(batchId);
      expect(shuffled.length).to.equal(4);

      // All indices 0-3 must appear exactly once
      const sorted = [...shuffled].map(Number).sort((a, b) => a - b);
      expect(sorted).to.deep.equal([0, 1, 2, 3]);
    });

    it("assigns shards from eligible shards list", async function () {
      const vrfRequestId = 1n;
      await mockVRFCoordinator.fulfillRandomWords(
        vrfRequestId,
        await sequencer.getAddress(),
        [RANDOM_SEED]
      );

      const assigned = await sequencer.getBatchAssignedShards(batchId);
      expect(assigned.length).to.equal(4);

      for (const shardAddr of assigned) {
        expect([shard1, shard2, shard3]).to.include(shardAddr);
      }
    });

    it("uses preferred shard when set", async function () {
      const tokenIn = ethers.Wallet.createRandom().address;
      const tokenOut = ethers.Wallet.createRandom().address;

      // Submit batch with preferred shard
      const swaps = [
        { user: user1.address, tokenIn, tokenOut, amountOut: ethers.parseEther("1"), preferredShard: shard1 },
      ];
      await sequencer.submitBatch(swaps);

      // Fulfill the second batch (requestId = 2)
      await mockVRFCoordinator.fulfillRandomWords(
        2n,
        await sequencer.getAddress(),
        [RANDOM_SEED]
      );

      const assigned = await sequencer.getBatchAssignedShards(1n);
      expect(assigned[0]).to.equal(shard1);
    });
  });

  // ============ Admin Functions ============

  describe("Admin", function () {
    it("owner can add eligible shard", async function () {
      const newShard = ethers.Wallet.createRandom().address;
      await expect(sequencer.addEligibleShard(newShard))
        .to.emit(sequencer, "ShardAdded")
        .withArgs(newShard);

      const shards = await sequencer.getEligibleShards();
      expect(shards).to.include(newShard);
    });

    it("owner can remove eligible shard", async function () {
      await expect(sequencer.removeEligibleShard(shard1))
        .to.emit(sequencer, "ShardRemoved")
        .withArgs(shard1);

      const shards = await sequencer.getEligibleShards();
      expect(shards).to.not.include(shard1);
    });

    it("owner can update subscription ID", async function () {
      await expect(sequencer.setSubscriptionId(42n))
        .to.emit(sequencer, "SubscriptionUpdated")
        .withArgs(SUBSCRIPTION_ID, 42n);
    });

    it("non-owner cannot add shard", async function () {
      const newShard = ethers.Wallet.createRandom().address;
      await expect(sequencer.connect(user1).addEligibleShard(newShard)).to.be.reverted;
    });
  });
});
