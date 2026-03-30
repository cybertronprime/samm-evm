// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/**
 * @title MockVRFCoordinator
 * @notice Mock Chainlink VRF v2.5 coordinator for testing.
 *         Call fulfillRandomWords() manually to simulate VRF callback.
 */
contract MockVRFCoordinator {
    uint256 private _nextRequestId = 1;

    // IVRFSubscriptionV2Plus minimal storage
    mapping(uint256 => bool) public subscriptionExists;

    event RandomWordsRequested(uint256 indexed requestId, address indexed requester);
    event RandomWordsFulfilled(uint256 indexed requestId);

    function requestRandomWords(
        VRFV2PlusClient.RandomWordsRequest calldata /* req */
    ) external returns (uint256 requestId) {
        requestId = _nextRequestId++;
        emit RandomWordsRequested(requestId, msg.sender);
    }

    /**
     * @notice Manually fulfill a VRF request with supplied random words.
     * @param requestId   Request to fulfill
     * @param consumer    The VRFConsumerBaseV2Plus contract
     * @param randomWords Array of random numbers to supply
     */
    function fulfillRandomWords(
        uint256 requestId,
        address consumer,
        uint256[] calldata randomWords
    ) external {
        // Call fulfillRandomWords on the consumer
        (bool success, ) = consumer.call(
            abi.encodeWithSignature(
                "rawFulfillRandomWords(uint256,uint256[])",
                requestId,
                randomWords
            )
        );
        require(success, "MockVRFCoordinator: fulfillment failed");
        emit RandomWordsFulfilled(requestId);
    }

    // ---- IVRFCoordinatorV2Plus stubs ----

    function getRequestConfig()
        external
        pure
        returns (
            uint16 minimumRequestConfirmations,
            uint32 maxGasLimit,
            bytes32[] memory s_provingKeyHashes
        )
    {
        s_provingKeyHashes = new bytes32[](0);
        return (3, 2_500_000, s_provingKeyHashes);
    }

    function addConsumer(uint256, address) external {}

    function removeConsumer(uint256, address) external {}

    function cancelSubscription(uint256, address) external {}

    function getSubscription(uint256)
        external
        pure
        returns (
            uint96 balance,
            uint96 nativeBalance,
            uint64 reqCount,
            address owner,
            address[] memory consumers
        )
    {
        consumers = new address[](0);
        return (1e18, 1e18, 0, address(0), consumers);
    }

    function createSubscription() external returns (uint256 subId) {
        subId = 1;
    }

    function fundSubscriptionWithNative(uint256) external payable {}

    function pendingRequestExists(uint256) external pure returns (bool) {
        return false;
    }

    function acceptSubscriptionOwnerTransfer(uint256) external {}
    function requestSubscriptionOwnerTransfer(uint256, address) external {}

    function s_config() external pure returns (uint16, uint32, bool) {
        return (3, 2_500_000, false);
    }

    function getActiveSubscriptionIds(uint256, uint256)
        external
        pure
        returns (uint256[] memory ids)
    {
        ids = new uint256[](0);
    }
}
