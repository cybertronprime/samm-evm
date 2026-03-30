
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISAMMPoolFactory {
    struct ShardInfo {
        address tokenA;
        address tokenB;
        uint256 shardIndex;
        int256 beta1;
        uint256 rmin;
        uint256 rmax;
        uint256 c;
        uint256 tradeFeeNumerator;
        uint256 tradeFeeDenominator;
        uint256 ownerFeeNumerator;
        uint256 ownerFeeDenominator;
        bool isActive;
        address creator;
        uint256 createdAt;
    }

    function createShardDefault(address tokenA, address tokenB) external returns (address shard);
    function createShard(
        address tokenA,
        address tokenB,
        int256 beta1,
        uint256 rmin,
        uint256 rmax,
        uint256 c,
        uint256 tradeFeeNum,
        uint256 tradeFeeDen,
        uint256 ownerFeeNum,
        uint256 ownerFeeDen
    ) external returns (address shard);
    function initializeShard(address shard, uint256 amountA, uint256 amountB) external returns (uint256 lpTokens);
    function getShardsForPair(address tokenA, address tokenB) external view returns (address[] memory);
    function getShardInfo(address shard) external view returns (ShardInfo memory);
    function getAllShards() external view returns (address[] memory);
    function deactivateShard(address shard) external;
}
