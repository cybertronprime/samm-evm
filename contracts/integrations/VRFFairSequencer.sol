// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/**
 * @title VRFFairSequencer
 * @notice Uses Chainlink VRF v2.5 to randomly order batched swap requests,
 *         preventing front-running and fairly assigning swaps to SAMM shards.
 * @dev Deployed on Ethereum Sepolia.
 *
 *  Sepolia VRF v2.5:
 *   Coordinator : 0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B
 *   Key Hash    : 0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae
 */
contract VRFFairSequencer is VRFConsumerBaseV2Plus, ReentrancyGuard {
    using VRFV2PlusClient for VRFV2PlusClient.RandomWordsRequest;

    // ============ Types ============

    struct SwapRequest {
        address user;
        address tokenIn;
        address tokenOut;
        uint256 amountOut;
        address preferredShard; // 0 = any eligible shard
    }

    struct Batch {
        SwapRequest[] swaps;
        uint256 vrfRequestId;
        bool fulfilled;
        uint256 randomSeed;
        uint256[] shuffledOrder; // final ordering after VRF
        address[] assignedShards;
    }

    // ============ State ============

    /// @notice Sepolia VRF v2.5 key hash
    bytes32 public constant KEY_HASH =
        0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae;

    uint256 public subscriptionId;
    uint32 public callbackGasLimit = 500_000;
    uint16 public requestConfirmations = 3;

    /// @notice Available shards for random assignment
    address[] public eligibleShards;

    uint256 public nextBatchId;
    mapping(uint256 => Batch) private batches;
    /// @notice VRF requestId => batchId
    mapping(uint256 => uint256) public vrfRequestToBatch;

    // ============ Events ============

    event BatchSubmitted(uint256 indexed batchId, uint256 swapCount, uint256 vrfRequestId);
    event BatchSequenced(uint256 indexed batchId, uint256 randomSeed, uint256 swapCount);
    event SwapAssigned(uint256 indexed batchId, uint256 swapIndex, address shard);
    event SubscriptionUpdated(uint256 oldId, uint256 newId);
    event ShardAdded(address indexed shard);
    event ShardRemoved(address indexed shard);

    // ============ Errors ============

    error EmptyBatch();
    error BatchAlreadyFulfilled(uint256 batchId);
    error BatchNotFound(uint256 batchId);
    error NoEligibleShards();
    error Unauthorized();

    // ============ Constructor ============

    /**
     * @param vrfCoordinator Chainlink VRF v2.5 coordinator address
     * @param _subscriptionId Funded VRF subscription ID
     */
    constructor(
        address vrfCoordinator,
        uint256 _subscriptionId
    ) VRFConsumerBaseV2Plus(vrfCoordinator) {
        subscriptionId = _subscriptionId;
    }

    // ============ User-Facing ============

    /**
     * @notice Submit a batch of swap requests for fair VRF sequencing.
     * @param swaps Array of swap requests to batch
     * @return batchId  Identifier of the created batch
     */
    function submitBatch(SwapRequest[] calldata swaps)
        external
        nonReentrant
        returns (uint256 batchId)
    {
        if (swaps.length == 0) revert EmptyBatch();

        batchId = nextBatchId++;
        Batch storage batch = batches[batchId];
        for (uint256 i = 0; i < swaps.length; i++) {
            batch.swaps.push(swaps[i]);
        }

        // Request randomness
        uint256 requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: KEY_HASH,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({ nativePayment: false })
                )
            })
        );

        batch.vrfRequestId = requestId;
        vrfRequestToBatch[requestId] = batchId;

        emit BatchSubmitted(batchId, swaps.length, requestId);
    }

    // ============ VRF Callback ============

    /**
     * @notice Called by Chainlink VRF coordinator with random words.
     *         Shuffles swap order and assigns shards.
     */
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal override {
        uint256 batchId = vrfRequestToBatch[requestId];
        Batch storage batch = batches[batchId];

        if (batch.fulfilled) revert BatchAlreadyFulfilled(batchId);
        batch.fulfilled = true;

        uint256 seed = randomWords[0];
        batch.randomSeed = seed;

        uint256 n = batch.swaps.length;

        // Build identity permutation then Fisher-Yates shuffle with VRF seed
        uint256[] memory order = new uint256[](n);
        for (uint256 i = 0; i < n; i++) order[i] = i;
        for (uint256 i = n - 1; i > 0; i--) {
            uint256 j = uint256(keccak256(abi.encodePacked(seed, i))) % (i + 1);
            (order[i], order[j]) = (order[j], order[i]);
        }
        batch.shuffledOrder = order;

        // Assign shards
        address[] memory assigned = new address[](n);
        if (eligibleShards.length > 0) {
            for (uint256 i = 0; i < n; i++) {
                uint256 si = order[i];
                if (batch.swaps[si].preferredShard != address(0)) {
                    assigned[i] = batch.swaps[si].preferredShard;
                } else {
                    uint256 shardIdx = uint256(keccak256(abi.encodePacked(seed, i, "shard"))) %
                        eligibleShards.length;
                    assigned[i] = eligibleShards[shardIdx];
                }
                emit SwapAssigned(batchId, i, assigned[i]);
            }
        }
        batch.assignedShards = assigned;

        emit BatchSequenced(batchId, seed, n);
    }

    // ============ View ============

    function getBatchSwapCount(uint256 batchId) external view returns (uint256) {
        return batches[batchId].swaps.length;
    }

    function getBatchFulfilled(uint256 batchId) external view returns (bool) {
        return batches[batchId].fulfilled;
    }

    function getBatchRandomSeed(uint256 batchId) external view returns (uint256) {
        return batches[batchId].randomSeed;
    }

    function getBatchShuffledOrder(uint256 batchId) external view returns (uint256[] memory) {
        return batches[batchId].shuffledOrder;
    }

    function getBatchAssignedShards(uint256 batchId) external view returns (address[] memory) {
        return batches[batchId].assignedShards;
    }

    function getEligibleShards() external view returns (address[] memory) {
        return eligibleShards;
    }

    // ============ Admin ============

    function setSubscriptionId(uint256 _subscriptionId) external onlyOwner {
        emit SubscriptionUpdated(subscriptionId, _subscriptionId);
        subscriptionId = _subscriptionId;
    }

    function setCallbackGasLimit(uint32 _limit) external onlyOwner {
        callbackGasLimit = _limit;
    }

    function setRequestConfirmations(uint16 _confirmations) external onlyOwner {
        requestConfirmations = _confirmations;
    }

    function addEligibleShard(address shard) external onlyOwner {
        eligibleShards.push(shard);
        emit ShardAdded(shard);
    }

    function removeEligibleShard(address shard) external onlyOwner {
        uint256 len = eligibleShards.length;
        for (uint256 i = 0; i < len; i++) {
            if (eligibleShards[i] == shard) {
                eligibleShards[i] = eligibleShards[len - 1];
                eligibleShards.pop();
                emit ShardRemoved(shard);
                return;
            }
        }
    }
}
