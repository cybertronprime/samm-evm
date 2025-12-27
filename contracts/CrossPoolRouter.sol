// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/ICrossPoolRouter.sol";
import "./interfaces/ISAMMPool.sol";
import "./interfaces/ISAMMPoolFactory.sol";

/**
 * @title CrossPoolRouter
 * @notice Enables atomic multi-hop swaps across multiple SAMM pool shards
 * @dev Implements SAMM research paper's routing strategy with smallest shard selection
 * 
 * Requirements covered:
 * - 8.3: Support updating the SAMM_Pool_Factory address by the contract owner
 * - 10.1: Include a pause mechanism that halts all swap operations
 */
contract CrossPoolRouter is ICrossPoolRouter, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    /// @notice The SAMM Pool Factory contract for shard discovery
    ISAMMPoolFactory private _factory;

    /// @notice Maximum number of hops allowed in a swap path
    uint256 public constant MAX_HOPS = 4;

    /// @notice Scale factor for c-threshold calculations (1e6)
    uint256 private constant SCALE_FACTOR = 1e6;

    // ============ Internal Structs ============

    /**
     * @notice Internal struct for caching shard selection results
     * @param shardAddress Address of the selected shard
     * @param requiredInput Required input amount for the swap
     * @param fee Total fee for the swap
     */
    struct ShardSelection {
        address shardAddress;
        uint256 requiredInput;
        uint256 fee;
    }

    /**
     * @notice Internal struct for caching shard data during transaction
     * @dev Used to avoid redundant external calls to factory and pools
     * Requirements covered: 9.1 - Cache shard data within a transaction
     * @param shardAddress Address of the shard
     * @param reserveIn Input token reserve
     * @param reserveOut Output token reserve
     * @param cThreshold c-threshold parameter from pool
     * @param isActive Whether the shard is active
     * @param inputDecimals Decimals of input token
     * @param outputDecimals Decimals of output token
     */
    struct CachedShardData {
        address shardAddress;
        uint256 reserveIn;
        uint256 reserveOut;
        uint256 cThreshold;
        bool isActive;
        uint8 inputDecimals;
        uint8 outputDecimals;
    }

    /**
     * @notice Internal struct for batch approval tracking
     * @dev Used to batch approve tokens when multiple hops use same input token
     * Requirements covered: 9.4 - Batch approve tokens when multiple hops use same input token
     * @param token Token address to approve
     * @param spender Spender address (shard)
     * @param amount Amount to approve
     */
    struct ApprovalEntry {
        address token;
        address spender;
        uint256 amount;
    }

    // ============ Constructor ============

    /**
     * @notice Initialize the CrossPoolRouter with a factory address
     * @param factoryAddress Address of the SAMMPoolFactory contract
     * @dev Reverts if factory address is zero
     */
    constructor(address factoryAddress) Ownable(msg.sender) {
        if (factoryAddress == address(0)) {
            revert InvalidFactory();
        }
        _factory = ISAMMPoolFactory(factoryAddress);
    }

    // ============ Modifiers ============

    /**
     * @notice Validates a swap path before execution
     * @param path The swap path to validate
     * @dev Checks deadline, hop count, path connectivity, and recipient
     * Requirements covered:
     * - 4.4: Deadline validation
     * - 5.1: Path connectivity (hop[i].tokenOut == hop[i+1].tokenIn)
     * - 5.3: Maximum hop count validation
     * - 5.5: Support paths with 1 to 4 hops maximum
     */
    modifier validatePath(SwapPath calldata path) {
        // Check deadline not exceeded (Requirement 4.4)
        if (block.timestamp > path.deadline) {
            revert DeadlineExceeded(path.deadline, block.timestamp);
        }

        // Check hop count within bounds 1-4 (Requirements 5.3, 5.5)
        if (path.hops.length == 0 || path.hops.length > MAX_HOPS) {
            revert InvalidHopCount(path.hops.length, MAX_HOPS);
        }

        // Verify recipient is not zero address
        if (path.recipient == address(0)) {
            revert InvalidRecipient();
        }

        // Verify path connectivity (Requirement 5.1)
        // hop[i].tokenOut must equal hop[i+1].tokenIn
        for (uint256 i = 0; i < path.hops.length - 1; i++) {
            if (path.hops[i].tokenOut != path.hops[i + 1].tokenIn) {
                revert PathNotConnected(i);
            }
        }

        _;
    }

    // ============ Core Functions ============

    /**
     * @notice Execute a multi-hop swap with exact output amounts
     * @param path The swap path containing hops, slippage protection, and recipient
     * @return result The complete swap result with all hop details
     * @dev Implements atomic multi-hop execution with smallest shard selection
     * 
     * Requirements covered:
     * - 1.1: Execute all hops in sequence within a single transaction
     * - 1.2: Revert entire transaction if any hop fails (automatic via Solidity)
     * - 1.3: Transfer final output tokens to specified recipient
     * - 1.4: Emit events for each successful hop and overall swap completion
     * - 1.5: Return actual amounts used and received for each hop
     * - 4.4: Deadline validation (via validatePath modifier)
     * - 9.1: Cache shard data within a transaction to avoid redundant external calls
     * - 9.2: Use efficient memory arrays for path iteration
     * - 9.3: Minimize storage reads/writes by using memory variables
     * - 9.4: Batch approve tokens when multiple hops use same input token
     * - 10.2: Revert when paused (via whenNotPaused modifier)
     */
    /// @inheritdoc ICrossPoolRouter
    function swapExactOutput(SwapPath calldata path) 
        external 
        override 
        nonReentrant 
        whenNotPaused 
        validatePath(path)
        returns (SwapResult memory result) 
    {
        uint256 numHops = path.hops.length;
        
        // ============ Step 1: Cache shard data and select shards (reverse order) ============
        // Task 9.1: Cache shard data in memory during transaction
        // Task 9.2: Use efficient memory arrays for path iteration
        // Requirements: 2.2, 2.5, 9.1, 9.2, 9.3
        ShardSelection[] memory selections = new ShardSelection[](numHops);
        uint256[] memory hopAmountsOut = new uint256[](numHops);
        
        // Store the desired output amounts for each hop
        for (uint256 i = 0; i < numHops; i++) {
            hopAmountsOut[i] = path.hops[i].amountOut;
        }
        
        // Select shards from last hop to first (reverse order)
        // Use caching for multi-hop swaps to avoid redundant factory calls
        for (uint256 i = numHops; i > 0; i--) {
            uint256 idx = i - 1;
            SwapHop calldata hop = path.hops[idx];
            
            // For multi-hop swaps, cache shard data to avoid redundant calls
            // For single-hop, direct selection is more efficient
            if (numHops > 1) {
                CachedShardData[] memory cachedShards = _cacheShardData(hop.tokenIn, hop.tokenOut);
                selections[idx] = _selectSmallestShardFromCache(
                    cachedShards,
                    hop.tokenIn,
                    hop.tokenOut,
                    hopAmountsOut[idx]
                );
            } else {
                selections[idx] = _selectSmallestShard(
                    hop.tokenIn,
                    hop.tokenOut,
                    hopAmountsOut[idx]
                );
            }
            
            // For non-first hops, the required input becomes the output of the previous hop
            if (idx > 0) {
                hopAmountsOut[idx - 1] = selections[idx].requiredInput;
            }
        }
        
        // ============ Step 2: Validate slippage ============
        // Requirements: 4.2, 4.3
        uint256 totalInputRequired = selections[0].requiredInput;
        if (totalInputRequired > path.maxAmountIn) {
            revert ExcessiveSlippage(totalInputRequired, path.maxAmountIn);
        }
        
        // ============ Step 3: Transfer input tokens from user to router ============
        // Requirements: 6.1, 6.2
        address firstTokenIn = path.hops[0].tokenIn;
        IERC20(firstTokenIn).safeTransferFrom(msg.sender, address(this), totalInputRequired);
        
        // ============ Step 4: Batch approve tokens (Task 9.3) ============
        // Task 9.3: Batch approve tokens when multiple hops use same input token
        // Requirement 9.4
        _batchApprove(path.hops, selections, numHops);
        
        // ============ Step 5: Execute hops (forward order) ============
        // Requirements: 6.3, 6.4, 6.5
        result.hopResults = new HopResult[](numHops);
        result.totalFees = 0;
        
        for (uint256 i = 0; i < numHops; i++) {
            SwapHop calldata hop = path.hops[i];
            ShardSelection memory selection = selections[i];
            
            // Execute swap on the selected shard
            ISAMMPool pool = ISAMMPool(selection.shardAddress);
            uint256 actualAmountIn = pool.swapSAMM(
                hopAmountsOut[i],           // amountOut
                selection.requiredInput,     // maximalAmountIn
                hop.tokenIn,                 // tokenIn
                hop.tokenOut,                // tokenOut
                address(this)                // recipient (router receives intermediate tokens)
            );
            
            // Build hop result and emit event
            result.hopResults[i] = HopResult({
                pool: selection.shardAddress,
                tokenIn: hop.tokenIn,
                tokenOut: hop.tokenOut,
                amountIn: actualAmountIn,
                amountOut: hopAmountsOut[i],
                fee: selection.fee
            });
            
            result.totalFees += selection.fee;
            
            emit HopExecuted(
                i,                           // hopIndex
                selection.shardAddress,      // pool
                hop.tokenIn,                 // tokenIn
                hop.tokenOut,                // tokenOut
                actualAmountIn,              // amountIn
                hopAmountsOut[i],            // amountOut
                selection.fee                // fee
            );
        }
        
        // ============ Step 6: Clear remaining approvals ============
        // Requirement 6.4
        _clearRemainingApprovals(path.hops, selections, numHops);
        
        // ============ Step 7: Transfer final output to recipient ============
        // Requirement 1.3
        address lastTokenOut = path.hops[numHops - 1].tokenOut;
        uint256 finalAmountOut = hopAmountsOut[numHops - 1];
        IERC20(lastTokenOut).safeTransfer(path.recipient, finalAmountOut);
        
        // ============ Step 8: Build final result and emit SwapExecuted ============
        // Requirements: 1.4, 1.5
        result.totalAmountIn = result.hopResults[0].amountIn;
        result.totalAmountOut = finalAmountOut;
        
        emit SwapExecuted(
            msg.sender,                      // user
            firstTokenIn,                    // tokenIn (first hop's input)
            lastTokenOut,                    // tokenOut (last hop's output)
            result.totalAmountIn,            // amountIn
            result.totalAmountOut,           // amountOut
            numHops                          // numHops
        );
        
        return result;
    }

    // ============ Quote Functions ============

    /**
     * @notice Calculate expected amounts for a swap without executing
     * @param hops Array of swap hops to quote
     * @return result Quote result with expected amounts and selected shards
     * @dev Calculates from last hop to first (reverse order) since we need output amounts to calculate inputs
     * 
     * Requirements covered:
     * - 7.1: Provide a view function to calculate expected input amounts for a given output and path
     * - 7.2: Provide a view function to calculate expected fees for each hop
     * - 7.3: Provide a view function to identify which shard would be selected for each hop
     * - 7.4: Use current on-chain reserve data when calculating quotes
     * - 7.5: Return price impact estimates for each hop in the quote
     * - 9.1: Cache shard data within a transaction to avoid redundant external calls
     * - 9.2: Use efficient memory arrays for path iteration
     * - 9.3: Minimize storage reads/writes by using memory variables
     */
    /// @inheritdoc ICrossPoolRouter
    function quoteSwap(SwapHop[] calldata hops) 
        external 
        view 
        override 
        returns (QuoteResult memory result) 
    {
        // Validate hop count
        if (hops.length == 0 || hops.length > MAX_HOPS) {
            revert InvalidHopCount(hops.length, MAX_HOPS);
        }
        
        // Validate path connectivity
        for (uint256 i = 0; i < hops.length - 1; i++) {
            if (hops[i].tokenOut != hops[i + 1].tokenIn) {
                revert PathNotConnected(i);
            }
        }
        
        uint256 numHops = hops.length;
        
        // Initialize result arrays (Task 9.2: efficient memory arrays)
        result.hopAmountsIn = new uint256[](numHops);
        result.hopFees = new uint256[](numHops);
        result.selectedShards = new address[](numHops);
        result.priceImpacts = new uint256[](numHops);
        
        // Store the desired output amounts for each hop
        // These may be updated as we calculate backwards
        uint256[] memory hopAmountsOut = new uint256[](numHops);
        for (uint256 i = 0; i < numHops; i++) {
            hopAmountsOut[i] = hops[i].amountOut;
        }
        
        // Calculate from last hop to first (reverse order)
        // For multi-hop quotes, use caching to avoid redundant factory calls
        for (uint256 i = numHops; i > 0; i--) {
            uint256 idx = i - 1;
            SwapHop calldata hop = hops[idx];
            
            ShardSelection memory selection;
            
            // Use caching for multi-hop quotes (Task 9.1)
            if (numHops > 1) {
                CachedShardData[] memory cachedShards = _cacheShardData(hop.tokenIn, hop.tokenOut);
                selection = _selectSmallestShardFromCache(
                    cachedShards,
                    hop.tokenIn,
                    hop.tokenOut,
                    hopAmountsOut[idx]
                );
            } else {
                selection = _selectSmallestShard(
                    hop.tokenIn,
                    hop.tokenOut,
                    hopAmountsOut[idx]
                );
            }
            
            // Store shard selection results
            result.selectedShards[idx] = selection.shardAddress;
            result.hopAmountsIn[idx] = selection.requiredInput;
            result.hopFees[idx] = selection.fee;
            
            // Calculate price impact for this hop
            result.priceImpacts[idx] = _calculatePriceImpact(
                ISAMMPool(selection.shardAddress),
                hop.tokenIn,
                hop.tokenOut,
                selection.requiredInput,
                hopAmountsOut[idx]
            );
            
            // For non-first hops, the required input becomes the output of the previous hop
            // Update the previous hop's amountOut to match what this hop needs as input
            if (idx > 0) {
                hopAmountsOut[idx - 1] = selection.requiredInput;
            }
        }
        
        // The total input is the first hop's required input
        result.expectedAmountIn = result.hopAmountsIn[0];
        
        return result;
    }

    /// @inheritdoc ICrossPoolRouter
    function getSelectedShard(
        address tokenIn,
        address tokenOut,
        uint256 amountOut
    ) external view override returns (address shard) {
        ShardSelection memory selection = _selectSmallestShard(tokenIn, tokenOut, amountOut);
        return selection.shardAddress;
    }

    // ============ Admin Functions ============

    /// @inheritdoc ICrossPoolRouter
    function pause() external override onlyOwner {
        _pause();
        emit RouterPaused(msg.sender);
    }

    /// @inheritdoc ICrossPoolRouter
    function unpause() external override onlyOwner {
        _unpause();
        emit RouterUnpaused(msg.sender);
    }

    /**
     * @notice Update the factory address
     * @param newFactory New factory contract address
     * @dev Only callable by owner. Validates new factory is not zero address.
     * 
     * Requirements covered:
     * - 8.3: Support updating the SAMM_Pool_Factory address by the contract owner
     * - 10.4: Emit events when emergency actions are taken
     */
    /// @inheritdoc ICrossPoolRouter
    function setFactory(address newFactory) external override onlyOwner {
        if (newFactory == address(0)) {
            revert InvalidFactory();
        }
        
        address oldFactory = address(_factory);
        _factory = ISAMMPoolFactory(newFactory);
        
        emit FactoryUpdated(oldFactory, newFactory);
    }

    /**
     * @notice Rescue stuck tokens from the contract
     * @param token Address of token to rescue
     * @param to Address to send tokens to
     * @param amount Amount of tokens to rescue
     * @dev Only callable by owner, for emergency recovery of stuck tokens
     * 
     * Requirements covered:
     * - 10.3: Allow the owner to rescue stuck tokens in emergency situations
     * - 10.4: Emit events when emergency actions are taken
     */
    /// @inheritdoc ICrossPoolRouter
    function rescueTokens(address token, address to, uint256 amount) external override onlyOwner {
        if (to == address(0)) {
            revert InvalidRecipient();
        }
        
        IERC20(token).safeTransfer(to, amount);
        
        emit TokensRescued(token, to, amount);
    }

    // ============ View Functions ============

    /// @inheritdoc ICrossPoolRouter
    function factory() external view override returns (address) {
        return address(_factory);
    }

    /// @inheritdoc ICrossPoolRouter
    function paused() public view override(ICrossPoolRouter, Pausable) returns (bool) {
        return super.paused();
    }

    /// @inheritdoc ICrossPoolRouter
    function maxHops() external pure override returns (uint256) {
        return MAX_HOPS;
    }

    // ============ Internal Functions ============

    /**
     * @notice Cache shard data for a token pair to avoid redundant external calls
     * @param tokenIn Address of the input token
     * @param tokenOut Address of the output token
     * @return cachedShards Array of cached shard data
     * @dev Caches reserves, c-threshold, and activity status in memory
     * 
     * Requirements covered:
     * - 9.1: Cache shard data within a transaction to avoid redundant external calls
     */
    function _cacheShardData(
        address tokenIn,
        address tokenOut
    ) internal view returns (CachedShardData[] memory cachedShards) {
        // Query factory once for all shards
        address[] memory shards = _factory.getShardsForPair(tokenIn, tokenOut);
        
        if (shards.length == 0) {
            revert NoPoolsAvailable(tokenIn, tokenOut);
        }

        // Get token decimals once (avoid repeated calls)
        uint8 inputDecimals = IERC20Metadata(tokenIn).decimals();
        uint8 outputDecimals = IERC20Metadata(tokenOut).decimals();

        // Pre-allocate array for cached data
        cachedShards = new CachedShardData[](shards.length);
        
        // Cache all shard data in a single pass
        for (uint256 i = 0; i < shards.length; i++) {
            address shardAddress = shards[i];
            
            // Get shard info from factory (includes isActive)
            ISAMMPoolFactory.ShardInfo memory info = _factory.getShardInfo(shardAddress);
            
            ISAMMPool pool = ISAMMPool(shardAddress);
            
            // Get reserves
            (uint256 reserveA, uint256 reserveB) = pool.getReserves();
            address poolTokenA = pool.tokenA();
            
            // Determine which reserve is input/output
            bool isTokenAInput = poolTokenA == tokenIn;
            
            // Get c-threshold from pool
            (,,, uint256 cThreshold) = pool.getSAMMParams();
            
            // Store cached data
            cachedShards[i] = CachedShardData({
                shardAddress: shardAddress,
                reserveIn: isTokenAInput ? reserveA : reserveB,
                reserveOut: isTokenAInput ? reserveB : reserveA,
                cThreshold: cThreshold,
                isActive: info.isActive,
                inputDecimals: inputDecimals,
                outputDecimals: outputDecimals
            });
        }
        
        return cachedShards;
    }

    /**
     * @notice Select the smallest shard from cached data that can handle the swap
     * @param cachedShards Array of cached shard data
     * @param tokenIn Address of the input token
     * @param tokenOut Address of the output token
     * @param amountOut Desired output amount
     * @return selection ShardSelection struct with selected shard and required input
     * @dev Uses cached data to avoid redundant external calls
     * 
     * Requirements covered:
     * - 2.2: Select the shard with the smallest input token reserve
     * - 2.3: If multiple shards have identical smallest reserves, select the first one found
     * - 9.1: Use cached shard data to avoid redundant external calls
     */
    function _selectSmallestShardFromCache(
        CachedShardData[] memory cachedShards,
        address tokenIn,
        address tokenOut,
        uint256 amountOut
    ) internal view returns (ShardSelection memory selection) {
        uint256 smallestReserve = type(uint256).max;
        bool foundValidShard = false;

        // Iterate through cached shards to find the smallest valid one
        for (uint256 i = 0; i < cachedShards.length; i++) {
            CachedShardData memory cached = cachedShards[i];
            
            // Skip inactive shards
            if (!cached.isActive) {
                continue;
            }

            // Validate c-threshold using cached data
            if (!_validateCThresholdCached(cached, amountOut)) {
                continue;
            }

            // Check if this is the smallest valid shard
            if (cached.reserveIn < smallestReserve) {
                smallestReserve = cached.reserveIn;
                
                // Calculate required input amount using pool's calculation
                ISAMMPool pool = ISAMMPool(cached.shardAddress);
                ISAMMPool.SwapResult memory swapCalc = pool.calculateSwapSAMM(
                    amountOut,
                    tokenIn,
                    tokenOut
                );
                
                selection.shardAddress = cached.shardAddress;
                selection.requiredInput = swapCalc.amountIn;
                selection.fee = swapCalc.tradeFee + swapCalc.ownerFee;
                foundValidShard = true;
            }
        }

        // Revert if no valid shard found
        if (!foundValidShard) {
            revert ExceedsCThreshold(tokenIn, tokenOut, amountOut);
        }

        return selection;
    }

    /**
     * @notice Validate c-threshold using cached shard data
     * @param cached Cached shard data
     * @param amountOut Desired output amount
     * @return valid True if OA/RA <= c
     * @dev Uses cached decimals and reserves to avoid external calls
     * 
     * Requirements covered:
     * - 3.1: Validate that OA/RA ≤ c for the selected shard
     * - 9.1: Use cached data to avoid redundant external calls
     */
    function _validateCThresholdCached(
        CachedShardData memory cached,
        uint256 amountOut
    ) internal pure returns (bool) {
        if (cached.reserveIn == 0) {
            return false;
        }

        // Normalize amounts to 18 decimals using cached decimals
        uint256 normalizedAmountOut = _normalize(amountOut, cached.outputDecimals);
        uint256 normalizedInputReserve = _normalize(cached.reserveIn, cached.inputDecimals);

        // Validate OA/RA <= c
        uint256 oaRaRatio = (normalizedAmountOut * SCALE_FACTOR) / normalizedInputReserve;
        
        return oaRaRatio <= cached.cThreshold;
    }

    /**
     * @notice Select the smallest shard that can handle the swap within c-threshold
     * @param tokenIn Address of the input token
     * @param tokenOut Address of the output token
     * @param amountOut Desired output amount
     * @return selection ShardSelection struct with selected shard and required input
     * @dev Implements SAMM research paper's "c-smaller-better" property
     * 
     * Requirements covered:
     * - 2.1: Query all available shards from the SAMM_Pool_Factory
     * - 2.2: Select the shard with the smallest input token reserve that can handle the swap
     * - 2.3: If multiple shards have identical smallest reserves, select the first one found
     * - 2.4: When no shard can handle the swap within c_Threshold, revert with descriptive error
     * - 8.1: Query the SAMM_Pool_Factory to discover all shards for a token pair
     * - 8.2: Filter out inactive shards when selecting pools
     */
    function _selectSmallestShard(
        address tokenIn,
        address tokenOut,
        uint256 amountOut
    ) internal view returns (ShardSelection memory selection) {
        // Query factory for all shards for the token pair (Requirement 2.1, 8.1)
        address[] memory shards = _factory.getShardsForPair(tokenIn, tokenOut);
        
        // Revert if no pools available (Requirement 8.4)
        if (shards.length == 0) {
            revert NoPoolsAvailable(tokenIn, tokenOut);
        }

        uint256 smallestReserve = type(uint256).max;
        bool foundValidShard = false;

        // Iterate through all shards to find the smallest valid one
        for (uint256 i = 0; i < shards.length; i++) {
            address shardAddress = shards[i];
            
            // Filter out inactive shards (Requirement 8.2)
            ISAMMPoolFactory.ShardInfo memory info = _factory.getShardInfo(shardAddress);
            if (!info.isActive) {
                continue;
            }

            ISAMMPool pool = ISAMMPool(shardAddress);
            
            // Get reserves and determine which is input/output
            (uint256 reserveA, uint256 reserveB) = pool.getReserves();
            address poolTokenA = pool.tokenA();
            
            bool isTokenAInput = poolTokenA == tokenIn;
            uint256 inputReserve = isTokenAInput ? reserveA : reserveB;
            
            // Validate c-threshold for this shard (Requirement 3.1, 3.3, 3.4)
            if (!_validateCThreshold(pool, tokenIn, tokenOut, amountOut, inputReserve)) {
                continue;
            }

            // Check if this is the smallest valid shard (Requirement 2.2, 2.3)
            // Note: Using < ensures first shard wins on tie (Requirement 2.3)
            if (inputReserve < smallestReserve) {
                smallestReserve = inputReserve;
                
                // Calculate required input amount using pool's calculation
                ISAMMPool.SwapResult memory swapCalc = pool.calculateSwapSAMM(
                    amountOut,
                    tokenIn,
                    tokenOut
                );
                
                selection.shardAddress = shardAddress;
                selection.requiredInput = swapCalc.amountIn;
                selection.fee = swapCalc.tradeFee + swapCalc.ownerFee;
                foundValidShard = true;
            }
        }

        // Revert if no valid shard found (Requirement 2.4, 3.2)
        if (!foundValidShard) {
            revert ExceedsCThreshold(tokenIn, tokenOut, amountOut);
        }

        return selection;
    }

    /**
     * @notice Validate that a swap satisfies the c-threshold constraint
     * @param pool The SAMM pool to validate against
     * @param tokenIn Address of the input token
     * @param tokenOut Address of the output token
     * @param amountOut Desired output amount
     * @param inputReserve Current input reserve of the pool
     * @return valid True if OA/RA <= c (maintains SAMM properties)
     * @dev Normalizes amounts to 18 decimals for consistent comparison
     * 
     * Requirements covered:
     * - 3.1: Validate that OA/RA ≤ c for the selected shard
     * - 3.3: Use the c parameter from each individual SAMM_Pool's configuration
     * - 3.4: Normalize amounts to 18 decimals for consistent comparison
     */
    function _validateCThreshold(
        ISAMMPool pool,
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 inputReserve
    ) internal view returns (bool) {
        if (inputReserve == 0) {
            return false;
        }

        // Get c-threshold from pool's SAMM parameters (Requirement 3.3)
        (,,, uint256 cThreshold) = pool.getSAMMParams();

        // Get token decimals for normalization
        uint8 inputDecimals = IERC20Metadata(tokenIn).decimals();
        uint8 outputDecimals = IERC20Metadata(tokenOut).decimals();

        // Normalize amounts to 18 decimals (Requirement 3.4)
        uint256 normalizedAmountOut = _normalize(amountOut, outputDecimals);
        uint256 normalizedInputReserve = _normalize(inputReserve, inputDecimals);

        // Validate OA/RA <= c (Requirement 3.1)
        // Calculate ratio: (amountOut * SCALE_FACTOR) / inputReserve
        // Compare with cThreshold (which is already scaled by 1e6)
        uint256 oaRaRatio = (normalizedAmountOut * SCALE_FACTOR) / normalizedInputReserve;
        
        return oaRaRatio <= cThreshold;
    }

    /**
     * @notice Normalize amount to 18 decimals for calculations
     * @param amount Amount in token's native decimals
     * @param tokenDecimals Token's decimal places
     * @return Normalized amount (18 decimals)
     */
    function _normalize(uint256 amount, uint8 tokenDecimals) internal pure returns (uint256) {
        if (tokenDecimals == 18) {
            return amount;
        } else if (tokenDecimals < 18) {
            return amount * (10 ** (18 - tokenDecimals));
        } else {
            return amount / (10 ** (tokenDecimals - 18));
        }
    }

    /**
     * @notice Calculate price impact for a swap based on reserve changes
     * @param pool The SAMM pool to calculate price impact for
     * @param tokenIn Address of the input token
     * @param tokenOut Address of the output token
     * @param amountIn Input amount for the swap
     * @param amountOut Output amount for the swap
     * @return priceImpact Price impact scaled by 1e4 (0.01% precision)
     * @dev Price impact = |1 - (amountOut/amountIn) / (reserveOut/reserveIn)| * 10000
     * 
     * Requirements covered:
     * - 7.5: Return price impact estimates for each hop in the quote
     */
    function _calculatePriceImpact(
        ISAMMPool pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    ) internal view returns (uint256 priceImpact) {
        // Get current reserves
        (uint256 reserveA, uint256 reserveB) = pool.getReserves();
        address poolTokenA = pool.tokenA();
        
        // Determine which reserve is input/output
        bool isTokenAInput = poolTokenA == tokenIn;
        uint256 reserveIn = isTokenAInput ? reserveA : reserveB;
        uint256 reserveOut = isTokenAInput ? reserveB : reserveA;
        
        // Avoid division by zero
        if (reserveIn == 0 || amountIn == 0) {
            return 0;
        }
        
        // Get token decimals for normalization
        uint8 inputDecimals = IERC20Metadata(tokenIn).decimals();
        uint8 outputDecimals = IERC20Metadata(tokenOut).decimals();
        
        // Normalize all amounts to 18 decimals for consistent calculation
        uint256 normalizedAmountIn = _normalize(amountIn, inputDecimals);
        uint256 normalizedAmountOut = _normalize(amountOut, outputDecimals);
        uint256 normalizedReserveIn = _normalize(reserveIn, inputDecimals);
        uint256 normalizedReserveOut = _normalize(reserveOut, outputDecimals);
        
        // Avoid division by zero after normalization
        if (normalizedReserveIn == 0 || normalizedAmountIn == 0) {
            return 0;
        }
        
        // Calculate spot price: reserveOut / reserveIn (scaled by 1e18 for precision)
        uint256 spotPrice = (normalizedReserveOut * 1e18) / normalizedReserveIn;
        
        // Calculate execution price: amountOut / amountIn (scaled by 1e18 for precision)
        uint256 executionPrice = (normalizedAmountOut * 1e18) / normalizedAmountIn;
        
        // Avoid division by zero
        if (spotPrice == 0) {
            return 0;
        }
        
        // Calculate price impact: |1 - executionPrice/spotPrice| * 10000
        // This gives us the percentage difference scaled by 1e4 (0.01% precision)
        if (executionPrice >= spotPrice) {
            // Positive slippage (rare, but possible in some AMM designs)
            priceImpact = ((executionPrice - spotPrice) * 10000) / spotPrice;
        } else {
            // Negative slippage (typical case - user gets less than spot price)
            priceImpact = ((spotPrice - executionPrice) * 10000) / spotPrice;
        }
        
        return priceImpact;
    }

    /**
     * @notice Batch approve tokens for multiple hops
     * @param hops Array of swap hops
     * @param selections Array of shard selections
     * @param numHops Number of hops
     * @dev Aggregates approvals for same token-spender pairs to reduce gas
     * 
     * Requirements covered:
     * - 9.4: Batch approve tokens when multiple hops use same input token
     */
    function _batchApprove(
        SwapHop[] calldata hops,
        ShardSelection[] memory selections,
        uint256 numHops
    ) internal {
        // For small number of hops, simple approach is more gas efficient
        // Batch optimization is most beneficial for 3+ hops with same tokens
        if (numHops <= 2) {
            // Simple per-hop approval
            for (uint256 i = 0; i < numHops; i++) {
                IERC20(hops[i].tokenIn).safeIncreaseAllowance(
                    selections[i].shardAddress,
                    selections[i].requiredInput
                );
            }
            return;
        }

        // For 3+ hops, check for duplicate token-spender pairs and batch
        // Use a simple approach: track seen pairs and aggregate amounts
        
        // First pass: count unique token-spender pairs
        // We use a simple O(n^2) approach since MAX_HOPS is 4
        bool[] memory processed = new bool[](numHops);
        
        for (uint256 i = 0; i < numHops; i++) {
            if (processed[i]) continue;
            
            address token = hops[i].tokenIn;
            address spender = selections[i].shardAddress;
            uint256 totalAmount = selections[i].requiredInput;
            
            // Look for duplicates
            for (uint256 j = i + 1; j < numHops; j++) {
                if (!processed[j] && 
                    hops[j].tokenIn == token && 
                    selections[j].shardAddress == spender) {
                    totalAmount += selections[j].requiredInput;
                    processed[j] = true;
                }
            }
            
            // Approve the aggregated amount
            IERC20(token).safeIncreaseAllowance(spender, totalAmount);
            processed[i] = true;
        }
    }

    /**
     * @notice Clear remaining approvals after swap execution
     * @param hops Array of swap hops
     * @param selections Array of shard selections
     * @param numHops Number of hops
     * @dev Clears any unused allowances for security
     * 
     * Requirements covered:
     * - 6.4: Clear any remaining approvals after swap completion
     */
    function _clearRemainingApprovals(
        SwapHop[] calldata hops,
        ShardSelection[] memory selections,
        uint256 numHops
    ) internal {
        // Track which token-spender pairs we've already cleared
        // Use simple O(n^2) approach since MAX_HOPS is 4
        bool[] memory cleared = new bool[](numHops);
        
        for (uint256 i = 0; i < numHops; i++) {
            if (cleared[i]) continue;
            
            address token = hops[i].tokenIn;
            address spender = selections[i].shardAddress;
            
            // Check for remaining allowance
            uint256 remainingAllowance = IERC20(token).allowance(address(this), spender);
            if (remainingAllowance > 0) {
                IERC20(token).safeDecreaseAllowance(spender, remainingAllowance);
            }
            
            // Mark all hops with same token-spender as cleared
            for (uint256 j = i + 1; j < numHops; j++) {
                if (hops[j].tokenIn == token && selections[j].shardAddress == spender) {
                    cleared[j] = true;
                }
            }
            cleared[i] = true;
        }
    }
}
