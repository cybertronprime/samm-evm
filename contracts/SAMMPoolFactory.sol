
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./SAMMPool.sol";
import "./interfaces/ISAMMPoolFactory.sol";

contract SAMMPoolFactory is Ownable, ReentrancyGuard, ISAMMPoolFactory {
    // Competitive SAMM parameters (scaled by 1e6)
    int256 public constant BETA1_DEFAULT = -250000;     // -0.25 (gentler slope for larger c)
    uint256 public constant RMIN_DEFAULT = 100;         // 0.0001 (0.01%)
    uint256 public constant RMAX_DEFAULT = 2500;        // 0.0025 (0.25%)
    uint256 public constant C_DEFAULT = 9600;           // 0.0096 (0.96%)

    // Default fee parameters (unchanged)
    uint256 public constant TRADE_FEE_NUMERATOR_DEFAULT = 25;   // 0.25%
    uint256 public constant TRADE_FEE_DENOMINATOR_DEFAULT = 10000;
    uint256 public constant OWNER_FEE_NUMERATOR_DEFAULT = 5;    // 0.05%
    uint256 public constant OWNER_FEE_DENOMINATOR_DEFAULT = 10000;

    mapping(bytes32 => address[]) public tokenPairShards;
    mapping(address => ShardInfo) public shardInfo;
    address[] public allShards;

    event ShardCreated(address indexed shard, address tokenA, address tokenB, uint256 shardIndex, address creator);
    event ShardInitialized(address indexed shard, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event ShardDeactivated(address indexed shard);

    constructor() Ownable(msg.sender) {}

    function createShardDefault(address tokenA, address tokenB) external returns (address shard) {
        return _createShard(tokenA, tokenB, BETA1_DEFAULT, RMIN_DEFAULT, RMAX_DEFAULT, C_DEFAULT,
            TRADE_FEE_NUMERATOR_DEFAULT, TRADE_FEE_DENOMINATOR_DEFAULT,
            OWNER_FEE_NUMERATOR_DEFAULT, OWNER_FEE_DENOMINATOR_DEFAULT);
    }

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
    ) external returns (address shard) {
        return _createShard(tokenA, tokenB, beta1, rmin, rmax, c,
            tradeFeeNum, tradeFeeDen, ownerFeeNum, ownerFeeDen);
    }

    function _createShard(
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
    ) internal returns (address shard) {
        require(tokenA != address(0) && tokenB != address(0), "zero address");
        require(tokenA != tokenB, "identical tokens");
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);
        bytes32 pairKey = keccak256(abi.encodePacked(tokenA, tokenB));
        uint256 shardIndex = tokenPairShards[pairKey].length;

        string memory name = string(abi.encodePacked("SAMM-", _getSymbol(tokenA), "-", _getSymbol(tokenB), "-S", _toString(shardIndex)));
        string memory symbol = string(abi.encodePacked("SAMM-", _getSymbol(tokenA), _getSymbol(tokenB), "-S", _toString(shardIndex)));

        shard = address(new SAMMPool(tokenA, tokenB, name, symbol));

        shardInfo[shard] = ShardInfo({
            tokenA: tokenA,
            tokenB: tokenB,
            shardIndex: shardIndex,
            beta1: beta1,
            rmin: rmin,
            rmax: rmax,
            c: c,
            tradeFeeNumerator: tradeFeeNum,
            tradeFeeDenominator: tradeFeeDen,
            ownerFeeNumerator: ownerFeeNum,
            ownerFeeDenominator: ownerFeeDen,
            isActive: true,
            creator: msg.sender,
            createdAt: block.timestamp
        });

        tokenPairShards[pairKey].push(shard);
        allShards.push(shard);
        emit ShardCreated(shard, tokenA, tokenB, shardIndex, msg.sender);
        return shard;
    }

    function initializeShard(address shard, uint256 amountA, uint256 amountB) external returns (uint256 lpTokens) {
        ShardInfo storage info = shardInfo[shard];
        require(info.isActive, "shard not active");
        require(msg.sender == info.creator || msg.sender == owner(), "not authorized");
        IERC20(info.tokenA).transferFrom(msg.sender, address(this), amountA);
        IERC20(info.tokenB).transferFrom(msg.sender, address(this), amountB);
        IERC20(info.tokenA).approve(shard, amountA);
        IERC20(info.tokenB).approve(shard, amountB);
        lpTokens = ISAMMPool(shard).initialize(
            info.tokenA, info.tokenB,
            amountA, amountB,
            info.tradeFeeNumerator, info.tradeFeeDenominator,
            info.ownerFeeNumerator, info.ownerFeeDenominator,
            info.creator
        );
        // Also set SAMM parameters on the pool
        ISAMMPool(shard).updateSAMMParams(info.beta1, info.rmin, info.rmax, info.c);
        emit ShardInitialized(shard, amountA, amountB, lpTokens);
        return lpTokens;
    }

    function getShardsForPair(address tokenA, address tokenB) external view returns (address[] memory) {
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);
        bytes32 key = keccak256(abi.encodePacked(tokenA, tokenB));
        return tokenPairShards[key];
    }

    function getShardInfo(address shard) external view returns (ShardInfo memory) {
        return shardInfo[shard];
    }

    function getAllShards() external view returns (address[] memory) {
        return allShards;
    }

    function deactivateShard(address shard) external onlyOwner {
        require(shardInfo[shard].isActive, "already inactive");
        shardInfo[shard].isActive = false;
        emit ShardDeactivated(shard);
    }

    function _getSymbol(address token) internal view returns (string memory) {
        try IERC20Metadata(token).symbol() returns (string memory s) {
            return s;
        } catch {
            return "UNK";
        }
    }
    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 t = v;
        uint256 digits;
        while (t != 0) { digits++; t /= 10; }
        bytes memory buf = new bytes(digits);
        while (v != 0) { buf[--digits] = bytes1(uint8(48 + (v % 10))); v /= 10; }
        return string(buf);
    }
}
