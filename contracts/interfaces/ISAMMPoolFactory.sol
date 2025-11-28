// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title ISAMMPoolFactory
 * @notice Interface for SAMM Pool Factory contract
 */
interface ISAMMPoolFactory {
    
    // Structs
    struct SAMMParams {
        int256 beta1;    // β1 parameter (scaled by 1e6)
        uint256 rmin;    // rmin parameter (scaled by 1e6)
        uint256 rmax;    // rmax parameter (scaled by 1e6)
        uint256 c;       // c-threshold parameter (scaled by 1e6)
    }
    
    struct FeeParams {
        uint256 tradeFeeNumerator;
        uint256 tradeFeeDenominator;
        uint256 ownerFeeNumerator;
        uint256 ownerFeeDenominator;
    }
    
    struct ShardInfo {
        address tokenA;
        address tokenB;
        uint256 shardIndex;
        SAMMParams sammParams;
        FeeParams feeParams;
        bool isActive;
        address creator;
        uint256 createdAt;
    }

    // Events
    event ShardCreated(
        address indexed shard,
        address indexed tokenA,
        address indexed tokenB,
        uint256 shardIndex,
        address creator
    );
    
    event ShardInitialized(
        address indexed shard,
        uint256 amountA,
        uint256 amountB,
        uint256 lpTokens
    );
    
    event ShardDeactivated(address indexed shard);

    // Functions
    function createShard(
        address tokenA,
        address tokenB,
        SAMMParams memory sammParams,
        FeeParams memory feeParams
    ) external returns (address shard);

    function initializeShard(
        address shard,
        uint256 amountA,
        uint256 amountB
    ) external returns (uint256 lpTokens);

    function getShardsForPair(
        address tokenA,
        address tokenB
    ) external view returns (address[] memory shards);

    function getShardInfo(address shard) external view returns (ShardInfo memory info);

    function getAllShards() external view returns (address[] memory shards);

    function getShardCount(address tokenA, address tokenB) external view returns (uint256 count);
}