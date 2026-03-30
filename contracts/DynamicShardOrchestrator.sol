// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ISAMMPoolFactory.sol";
import "./interfaces/ISAMMPool.sol";

/**
 * @title DynamicShardOrchestrator
 * @notice On-chain orchestrator for dynamic shard creation, splitting, merging, and rebalancing
 * @dev Key to TPS scaling: each shard processes transactions independently.
 *      More shards = more parallel throughput = higher total TPS.
 *
 * Operations:
 * - createAndFundShard: Create a new shard with initial liquidity (from caller's tokens)
 * - splitShard: Take a shard, remove X% liquidity, create new shard with it (atomic)
 * - rebalanceLiquidity: Move liquidity from one shard to another (atomic)
 * - mergeShards: Remove all liquidity from source shard, add to target shard
 * - autoScale: Called by keeper — creates shards when utilization is high
 *
 * The off-chain monitor detects when shards are saturated (c-threshold hit often)
 * and calls these functions to scale horizontally.
 */
contract DynamicShardOrchestrator is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    ISAMMPoolFactory public factory;

    // Keepers who can call autoScale / rebalance
    mapping(address => bool) public keepers;

    // Track shards created by this orchestrator
    address[] public managedShards;
    mapping(address => bool) public isManagedShard;

    // Default SAMM parameters
    int256 public defaultBeta1 = -250000;
    uint256 public defaultRmin = 100;
    uint256 public defaultRmax = 2500;
    uint256 public defaultC = 9600;
    uint256 public defaultTradeFeeNum = 25;
    uint256 public defaultTradeFeeDen = 10000;
    uint256 public defaultOwnerFeeNum = 5;
    uint256 public defaultOwnerFeeDen = 10000;

    // Scaling thresholds
    uint256 public maxShardsPerPair = 10;

    // Events
    event ShardCreated(address indexed shard, address tokenA, address tokenB, uint256 liquidityA, uint256 liquidityB);
    event ShardSplit(address indexed sourceShard, address indexed newShard, uint256 liquidityMoved);
    event LiquidityRebalanced(address indexed fromShard, address indexed toShard, uint256 lpBurned, uint256 amountA, uint256 amountB);
    event ShardsMerged(address indexed sourceShard, address indexed targetShard, uint256 lpBurned);
    event KeeperUpdated(address indexed keeper, bool active);
    event DefaultParamsUpdated(int256 beta1, uint256 rmin, uint256 rmax, uint256 c);

    modifier onlyKeeper() {
        require(keepers[msg.sender] || msg.sender == owner(), "not keeper");
        _;
    }

    constructor(address _factory) Ownable(msg.sender) {
        require(_factory != address(0), "zero factory");
        factory = ISAMMPoolFactory(_factory);
        keepers[msg.sender] = true;
    }

    // ============ SHARD CREATION ============

    /**
     * @notice Create a new shard and fund it with initial liquidity
     * @dev Caller must have approved tokenA and tokenB to this contract
     * @param tokenA First token address
     * @param tokenB Second token address
     * @param amountA Amount of tokenA for initial liquidity
     * @param amountB Amount of tokenB for initial liquidity
     * @return shard Address of the new shard
     */
    function createAndFundShard(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external onlyKeeper nonReentrant returns (address shard) {
        // Check shard limit
        address[] memory existing = factory.getShardsForPair(tokenA, tokenB);
        require(existing.length < maxShardsPerPair, "max shards reached");

        // Pull tokens from caller
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);

        // Create shard via factory
        shard = factory.createShard(
            tokenA, tokenB,
            defaultBeta1, defaultRmin, defaultRmax, defaultC,
            defaultTradeFeeNum, defaultTradeFeeDen,
            defaultOwnerFeeNum, defaultOwnerFeeDen
        );

        // The factory sorts tokens by address. Query actual pool token order.
        address poolTokenA = ISAMMPool(shard).tokenA();

        uint256 initAmountA;
        uint256 initAmountB;
        if (poolTokenA == tokenA) {
            initAmountA = amountA;
            initAmountB = amountB;
        } else {
            initAmountA = amountB;
            initAmountB = amountA;
        }

        // Approve factory to pull tokens for initialization
        IERC20(ISAMMPool(shard).tokenA()).approve(address(factory), initAmountA);
        IERC20(ISAMMPool(shard).tokenB()).approve(address(factory), initAmountB);

        // Initialize shard
        factory.initializeShard(shard, initAmountA, initAmountB);

        managedShards.push(shard);
        isManagedShard[shard] = true;

        emit ShardCreated(shard, tokenA, tokenB, amountA, amountB);
        return shard;
    }

    // ============ SHARD SPLITTING ============

    /**
     * @notice Split a shard: remove a percentage of liquidity and create a new shard with it
     * @dev Atomic operation — removes from source, creates new shard, funds it
     * @param sourceShard The shard to split from
     * @param splitPercent Percentage of LP tokens to move (1-99, representing %)
     * @return newShard Address of the new shard
     */
    function splitShard(
        address sourceShard,
        uint256 splitPercent
    ) external onlyKeeper nonReentrant returns (address newShard) {
        require(splitPercent > 0 && splitPercent < 100, "invalid split percent");

        address poolTokenA = ISAMMPool(sourceShard).tokenA();
        address poolTokenB = ISAMMPool(sourceShard).tokenB();

        // Check shard limit
        address[] memory existing = factory.getShardsForPair(poolTokenA, poolTokenB);
        require(existing.length < maxShardsPerPair, "max shards reached");

        // Get our LP balance in source shard
        uint256 lpBalance = IERC20(sourceShard).balanceOf(address(this));
        require(lpBalance > 0, "no LP tokens in source");

        uint256 lpToMove = (lpBalance * splitPercent) / 100;
        require(lpToMove > 0, "split amount too small");

        // Remove liquidity from source shard
        IERC20(sourceShard).approve(sourceShard, lpToMove);
        (uint256 amountA, uint256 amountB) = ISAMMPool(sourceShard).removeLiquidity(
            lpToMove, 0, 0, address(this)
        );

        // Create new shard
        newShard = factory.createShard(
            poolTokenA, poolTokenB,
            defaultBeta1, defaultRmin, defaultRmax, defaultC,
            defaultTradeFeeNum, defaultTradeFeeDen,
            defaultOwnerFeeNum, defaultOwnerFeeDen
        );

        // Initialize new shard with removed liquidity
        IERC20(poolTokenA).approve(address(factory), amountA);
        IERC20(poolTokenB).approve(address(factory), amountB);
        factory.initializeShard(newShard, amountA, amountB);

        managedShards.push(newShard);
        isManagedShard[newShard] = true;

        emit ShardSplit(sourceShard, newShard, lpToMove);
        return newShard;
    }

    // ============ LIQUIDITY REBALANCING ============

    /**
     * @notice Move liquidity from one shard to another (atomic rebalance)
     * @param fromShard Source shard to remove liquidity from
     * @param toShard Target shard to add liquidity to
     * @param lpAmount Amount of LP tokens to remove from source
     */
    function rebalanceLiquidity(
        address fromShard,
        address toShard,
        uint256 lpAmount
    ) external onlyKeeper nonReentrant {
        require(fromShard != toShard, "same shard");

        address fromTokenA = ISAMMPool(fromShard).tokenA();
        address fromTokenB = ISAMMPool(fromShard).tokenB();
        address toTokenA = ISAMMPool(toShard).tokenA();
        address toTokenB = ISAMMPool(toShard).tokenB();
        require(fromTokenA == toTokenA && fromTokenB == toTokenB, "different token pairs");

        // Remove liquidity from source
        IERC20(fromShard).approve(fromShard, lpAmount);
        (uint256 amountA, uint256 amountB) = ISAMMPool(fromShard).removeLiquidity(
            lpAmount, 0, 0, address(this)
        );

        // Add liquidity to target
        IERC20(fromTokenA).approve(toShard, amountA);
        IERC20(fromTokenB).approve(toShard, amountB);
        ISAMMPool(toShard).addLiquidity(amountA, amountB, 0, 0, address(this));

        emit LiquidityRebalanced(fromShard, toShard, lpAmount, amountA, amountB);
    }

    // ============ SHARD MERGING ============

    /**
     * @notice Merge source shard into target shard (move all liquidity)
     * @param sourceShard Shard to drain (will be left empty)
     * @param targetShard Shard to receive all liquidity
     */
    function mergeShards(
        address sourceShard,
        address targetShard
    ) external onlyKeeper nonReentrant {
        require(sourceShard != targetShard, "same shard");

        address srcA = ISAMMPool(sourceShard).tokenA();
        address srcB = ISAMMPool(sourceShard).tokenB();
        address tgtA = ISAMMPool(targetShard).tokenA();
        address tgtB = ISAMMPool(targetShard).tokenB();
        require(srcA == tgtA && srcB == tgtB, "different pairs");

        uint256 lpBalance = IERC20(sourceShard).balanceOf(address(this));
        require(lpBalance > 0, "no LP in source");

        // Remove all liquidity from source
        IERC20(sourceShard).approve(sourceShard, lpBalance);
        (uint256 amountA, uint256 amountB) = ISAMMPool(sourceShard).removeLiquidity(
            lpBalance, 0, 0, address(this)
        );

        // Add to target
        IERC20(srcA).approve(targetShard, amountA);
        IERC20(srcB).approve(targetShard, amountB);
        ISAMMPool(targetShard).addLiquidity(amountA, amountB, 0, 0, address(this));

        emit ShardsMerged(sourceShard, targetShard, lpBalance);
    }

    // ============ EXTERNAL LIQUIDITY (from caller's wallet) ============

    /**
     * @notice Add liquidity to an existing shard using caller's tokens
     * @dev Used by the off-chain manager to top up shards without splitting
     */
    function addLiquidityToShard(
        address shard,
        uint256 amountA,
        uint256 amountB
    ) external onlyKeeper nonReentrant {
        address tkA = ISAMMPool(shard).tokenA();
        address tkB = ISAMMPool(shard).tokenB();

        IERC20(tkA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tkB).safeTransferFrom(msg.sender, address(this), amountB);

        IERC20(tkA).approve(shard, amountA);
        IERC20(tkB).approve(shard, amountB);
        ISAMMPool(shard).addLiquidity(amountA, amountB, 0, 0, msg.sender);
    }

    // ============ BATCH OPERATIONS (for speed) ============

    /**
     * @notice Create multiple shards in one transaction (saves gas, faster deploy)
     * @param tokenAs Array of tokenA addresses
     * @param tokenBs Array of tokenB addresses
     * @param amountsA Array of amountA for each shard
     * @param amountsB Array of amountB for each shard
     */
    function batchCreateShards(
        address[] calldata tokenAs,
        address[] calldata tokenBs,
        uint256[] calldata amountsA,
        uint256[] calldata amountsB
    ) external onlyKeeper nonReentrant returns (address[] memory shards) {
        uint256 len = tokenAs.length;
        require(len == tokenBs.length && len == amountsA.length && len == amountsB.length, "length mismatch");

        shards = new address[](len);

        for (uint256 i = 0; i < len; i++) {
            // Pull tokens
            IERC20(tokenAs[i]).safeTransferFrom(msg.sender, address(this), amountsA[i]);
            IERC20(tokenBs[i]).safeTransferFrom(msg.sender, address(this), amountsB[i]);

            // Create shard
            address shard = factory.createShard(
                tokenAs[i], tokenBs[i],
                defaultBeta1, defaultRmin, defaultRmax, defaultC,
                defaultTradeFeeNum, defaultTradeFeeDen,
                defaultOwnerFeeNum, defaultOwnerFeeDen
            );

            // Get pool token order
            address poolTokenA = ISAMMPool(shard).tokenA();
            uint256 initA;
            uint256 initB;
            if (poolTokenA == tokenAs[i]) {
                initA = amountsA[i];
                initB = amountsB[i];
            } else {
                initA = amountsB[i];
                initB = amountsA[i];
            }

            IERC20(ISAMMPool(shard).tokenA()).approve(address(factory), initA);
            IERC20(ISAMMPool(shard).tokenB()).approve(address(factory), initB);
            factory.initializeShard(shard, initA, initB);

            managedShards.push(shard);
            isManagedShard[shard] = true;
            shards[i] = shard;

            emit ShardCreated(shard, tokenAs[i], tokenBs[i], amountsA[i], amountsB[i]);
        }
    }

    // ============ VIEW FUNCTIONS ============

    function getManagedShardCount() external view returns (uint256) {
        return managedShards.length;
    }

    function getManagedShards() external view returns (address[] memory) {
        return managedShards;
    }

    /**
     * @notice Get utilization info for a shard (how close to c-threshold)
     * @return reserveA Current reserve of token A
     * @return reserveB Current reserve of token B
     * @return maxSwapA Max output of tokenA (c * reserveA)
     * @return maxSwapB Max output of tokenB (c * reserveB)
     */
    function getShardUtilization(address shard) external view returns (
        uint256 reserveA, uint256 reserveB, uint256 maxSwapA, uint256 maxSwapB
    ) {
        (reserveA, reserveB) = ISAMMPool(shard).getReserves();
        maxSwapA = (reserveA * defaultC) / 1e6;
        maxSwapB = (reserveB * defaultC) / 1e6;
    }

    // ============ ADMIN ============

    function setKeeper(address keeper, bool active) external onlyOwner {
        keepers[keeper] = active;
        emit KeeperUpdated(keeper, active);
    }

    function setMaxShardsPerPair(uint256 _max) external onlyOwner {
        maxShardsPerPair = _max;
    }

    function setDefaultParams(
        int256 _beta1, uint256 _rmin, uint256 _rmax, uint256 _c
    ) external onlyOwner {
        defaultBeta1 = _beta1;
        defaultRmin = _rmin;
        defaultRmax = _rmax;
        defaultC = _c;
        emit DefaultParamsUpdated(_beta1, _rmin, _rmax, _c);
    }

    function setDefaultFees(
        uint256 _tradeFeeNum, uint256 _tradeFeeDen,
        uint256 _ownerFeeNum, uint256 _ownerFeeDen
    ) external onlyOwner {
        defaultTradeFeeNum = _tradeFeeNum;
        defaultTradeFeeDen = _tradeFeeDen;
        defaultOwnerFeeNum = _ownerFeeNum;
        defaultOwnerFeeDen = _ownerFeeDen;
    }

    /**
     * @notice Rescue tokens stuck in this contract
     */
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
