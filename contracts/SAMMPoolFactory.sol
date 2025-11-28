// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./SAMMPool.sol";
import "./interfaces/ISAMMPoolFactory.sol";

/**
 * @title SAMMPoolFactory
 * @notice Factory contract for creating and managing multiple SAMM pool shards
 * @dev Enables multi-shard support as specified in SAMM research paper
 *
 * Key Features:
 * - Create multiple shards for the same token pair
 * - Track all shards for routing and discovery
 * - Enforce SAMM parameters consistency
 * - Support shard-specific configurations
 */
contract SAMMPoolFactory is Ownable, ReentrancyGuard, ISAMMPoolFactory {
    
    // SAMM parameters from research paper (scaled by 1e6)
    int256 public constant BETA1_DEFAULT = -1050000; // -1.05 * 1e6
    uint256 public constant RMIN_DEFAULT = 1000;     // 0.001 * 1e6
    uint256 public constant RMAX_DEFAULT = 12000;    // 0.012 * 1e6
    uint256 public constant C_DEFAULT = 10400;       // 0.0104 * 1e6
    
    // Default fee parameters
    uint256 public constant TRADE_FEE_NUMERATOR_DEFAULT = 25;   // 0.25%
    uint256 public constant TRADE_FEE_DENOMINATOR_DEFAULT = 10000;
    uint256 public constant OWNER_FEE_NUMERATOR_DEFAULT = 5;    // 0.05%
    uint256 public constant OWNER_FEE_DENOMINATOR_DEFAULT = 10000;

    // Storage
    mapping(bytes32 => address[]) public tokenPairShards;
    mapping(address => ShardInfo) public shardInfo;
    address[] public allShards;
    
    // Events are defined in the interface

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Create a new SAMM pool shard for a token pair
     * @param tokenA Address of token A
     * @param tokenB Address of token B
     * @param sammParams SAMM parameters (beta1, rmin, rmax, c)
     * @param feeParams Fee parameters (trade fee, owner fee)
     * @return shard Address of the created shard
     */
    function createShard(
        address tokenA,
        address tokenB,
        SAMMParams memory sammParams,
        FeeParams memory feeParams
    ) external override nonReentrant returns (address shard) {
        return _createShard(tokenA, tokenB, sammParams, feeParams);
    }

    function _createShard(
        address tokenA,
        address tokenB,
        SAMMParams memory sammParams,
        FeeParams memory feeParams
    ) internal returns (address shard) {
        require(tokenA != address(0) && tokenB != address(0), "SAMMFactory: zero address");
        require(tokenA != tokenB, "SAMMFactory: identical tokens");
        
        // Validate SAMM parameters
        _validateSAMMParams(sammParams);
        _validateFeeParams(feeParams);
        
        // Order tokens consistently (tokenA < tokenB)
        if (tokenA > tokenB) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }
        
        bytes32 pairKey = keccak256(abi.encodePacked(tokenA, tokenB));
        uint256 shardIndex = tokenPairShards[pairKey].length;
        
        // Create shard name and symbol
        string memory name = string(abi.encodePacked(
            "SAMM-",
            _getTokenSymbol(tokenA),
            "-",
            _getTokenSymbol(tokenB),
            "-S",
            _toString(shardIndex)
        ));
        
        string memory symbol = string(abi.encodePacked(
            "SAMM-",
            _getTokenSymbol(tokenA),
            _getTokenSymbol(tokenB),
            "-S",
            _toString(shardIndex)
        ));
        
        // Deploy new shard
        shard = address(new SAMMPool(tokenA, tokenB, name, symbol));
        
        // Store shard information
        shardInfo[shard] = ShardInfo({
            tokenA: tokenA,
            tokenB: tokenB,
            shardIndex: shardIndex,
            sammParams: sammParams,
            feeParams: feeParams,
            isActive: true,
            creator: msg.sender,
            createdAt: block.timestamp
        });
        
        // Add to tracking arrays
        tokenPairShards[pairKey].push(shard);
        allShards.push(shard);
        
        emit ShardCreated(shard, tokenA, tokenB, shardIndex, msg.sender);
        
        return shard;
    }

    /**
     * @notice Initialize a shard with initial liquidity and SAMM parameters
     * @param shard Address of the shard to initialize
     * @param amountA Initial amount of token A
     * @param amountB Initial amount of token B
     * @return lpTokens Amount of LP tokens minted
     */
    function initializeShard(
        address shard,
        uint256 amountA,
        uint256 amountB
    ) external override nonReentrant returns (uint256 lpTokens) {
        ShardInfo storage info = shardInfo[shard];
        require(info.isActive, "SAMMFactory: shard not found");
        require(info.creator == msg.sender || msg.sender == owner(), "SAMMFactory: not authorized");
        
        // Transfer tokens from user to factory first
        IERC20(info.tokenA).transferFrom(msg.sender, address(this), amountA);
        IERC20(info.tokenB).transferFrom(msg.sender, address(this), amountB);
        
        // Approve tokens to shard
        IERC20(info.tokenA).approve(shard, amountA);
        IERC20(info.tokenB).approve(shard, amountB);
        
        // Initialize with SAMM parameters
        lpTokens = ISAMMPool(shard).initialize(
            info.tokenA,
            info.tokenB,
            amountA,
            amountB,
            info.feeParams.tradeFeeNumerator,
            info.feeParams.tradeFeeDenominator,
            info.feeParams.ownerFeeNumerator,
            info.feeParams.ownerFeeDenominator
        );
        
        emit ShardInitialized(shard, amountA, amountB, lpTokens);
        
        return lpTokens;
    }

    /**
     * @notice Get all shards for a token pair
     * @param tokenA Address of token A
     * @param tokenB Address of token B
     * @return shards Array of shard addresses
     */
    function getShardsForPair(
        address tokenA,
        address tokenB
    ) external view override returns (address[] memory shards) {
        // Order tokens consistently
        if (tokenA > tokenB) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }
        
        bytes32 pairKey = keccak256(abi.encodePacked(tokenA, tokenB));
        return tokenPairShards[pairKey];
    }

    /**
     * @notice Get information about a specific shard
     * @param shard Address of the shard
     * @return info ShardInfo struct
     */
    function getShardInfo(address shard) external view override returns (ShardInfo memory info) {
        return shardInfo[shard];
    }

    /**
     * @notice Get all active shards
     * @return shards Array of all shard addresses
     */
    function getAllShards() external view override returns (address[] memory shards) {
        return allShards;
    }

    /**
     * @notice Get the number of shards for a token pair
     * @param tokenA Address of token A
     * @param tokenB Address of token B
     * @return count Number of shards
     */
    function getShardCount(address tokenA, address tokenB) external view override returns (uint256 count) {
        // Order tokens consistently
        if (tokenA > tokenB) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }
        
        bytes32 pairKey = keccak256(abi.encodePacked(tokenA, tokenB));
        return tokenPairShards[pairKey].length;
    }

    /**
     * @notice Deactivate a shard (admin only)
     * @param shard Address of the shard to deactivate
     */
    function deactivateShard(address shard) external onlyOwner {
        require(shardInfo[shard].isActive, "SAMMFactory: shard not active");
        shardInfo[shard].isActive = false;
        
        emit ShardDeactivated(shard);
    }

    /**
     * @notice Create a shard with default parameters
     * @param tokenA Address of token A
     * @param tokenB Address of token B
     * @return shard Address of the created shard
     */
    function createShardDefault(
        address tokenA,
        address tokenB
    ) external returns (address shard) {
        SAMMParams memory sammParams = SAMMParams({
            beta1: BETA1_DEFAULT,
            rmin: RMIN_DEFAULT,
            rmax: RMAX_DEFAULT,
            c: C_DEFAULT
        });
        
        FeeParams memory feeParams = FeeParams({
            tradeFeeNumerator: TRADE_FEE_NUMERATOR_DEFAULT,
            tradeFeeDenominator: TRADE_FEE_DENOMINATOR_DEFAULT,
            ownerFeeNumerator: OWNER_FEE_NUMERATOR_DEFAULT,
            ownerFeeDenominator: OWNER_FEE_DENOMINATOR_DEFAULT
        });
        
        return _createShard(tokenA, tokenB, sammParams, feeParams);
    }

    // Internal functions

    function _validateSAMMParams(SAMMParams memory params) internal pure {
        require(params.beta1 < 0, "SAMMFactory: beta1 must be negative");
        require(params.rmin > 0, "SAMMFactory: rmin must be positive");
        require(params.rmax > params.rmin, "SAMMFactory: rmax must be greater than rmin");
        require(params.c > 0, "SAMMFactory: c must be positive");
    }

    function _validateFeeParams(FeeParams memory params) internal pure {
        require(params.tradeFeeDenominator > 0, "SAMMFactory: invalid trade fee denominator");
        require(params.tradeFeeNumerator < params.tradeFeeDenominator, "SAMMFactory: trade fee too high");
        require(params.ownerFeeDenominator > 0, "SAMMFactory: invalid owner fee denominator");
        require(params.ownerFeeNumerator < params.ownerFeeDenominator, "SAMMFactory: owner fee too high");
    }

    function _getTokenSymbol(address token) internal view returns (string memory) {
        try IERC20Metadata(token).symbol() returns (string memory symbol) {
            return symbol;
        } catch {
            return "UNK";
        }
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}