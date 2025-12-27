// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICrossPoolRouter
 * @notice Interface for Cross-Pool Router contract that enables atomic multi-hop swaps
 * @dev Implements SAMM research paper's routing strategy with smallest shard selection
 */
interface ICrossPoolRouter {
    // ============ Structs ============

    /**
     * @notice Represents a single hop in a multi-hop swap path
     * @param tokenIn Address of the input token for this hop
     * @param tokenOut Address of the output token for this hop
     * @param amountOut Exact output amount desired for this hop
     */
    struct SwapHop {
        address tokenIn;
        address tokenOut;
        uint256 amountOut;
    }

    /**
     * @notice Complete swap path with slippage protection
     * @param hops Array of swap hops to execute
     * @param maxAmountIn Maximum input amount (slippage protection)
     * @param deadline Transaction deadline timestamp
     * @param recipient Address to receive final output tokens
     */
    struct SwapPath {
        SwapHop[] hops;
        uint256 maxAmountIn;
        uint256 deadline;
        address recipient;
    }

    /**
     * @notice Result of a single hop execution
     * @param pool Address of the shard used for this hop
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Actual input amount used
     * @param amountOut Actual output amount received
     * @param fee Total fee paid for this hop
     */
    struct HopResult {
        address pool;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        uint256 fee;
    }

    /**
     * @notice Complete result of a multi-hop swap
     * @param hopResults Array of results for each hop
     * @param totalAmountIn Total input amount used
     * @param totalAmountOut Total output amount received
     * @param totalFees Total fees paid across all hops
     */
    struct SwapResult {
        HopResult[] hopResults;
        uint256 totalAmountIn;
        uint256 totalAmountOut;
        uint256 totalFees;
    }

    /**
     * @notice Quote result for previewing a swap
     * @param expectedAmountIn Expected total input amount
     * @param hopAmountsIn Expected input amount for each hop
     * @param hopFees Expected fee for each hop
     * @param selectedShards Addresses of shards that would be selected
     * @param priceImpacts Price impact for each hop (scaled by 1e4 for 0.01% precision)
     */
    struct QuoteResult {
        uint256 expectedAmountIn;
        uint256[] hopAmountsIn;
        uint256[] hopFees;
        address[] selectedShards;
        uint256[] priceImpacts;
    }

    // ============ Events ============

    /**
     * @notice Emitted when a complete multi-hop swap is executed
     * @param user Address that initiated the swap
     * @param tokenIn First input token address
     * @param tokenOut Final output token address
     * @param amountIn Total input amount used
     * @param amountOut Total output amount received
     * @param numHops Number of hops in the swap path
     */
    event SwapExecuted(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 numHops
    );

    /**
     * @notice Emitted for each hop in a multi-hop swap
     * @param hopIndex Index of the hop (0-based)
     * @param pool Address of the shard used
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Input amount used
     * @param amountOut Output amount received
     * @param fee Fee paid for this hop
     */
    event HopExecuted(
        uint256 indexed hopIndex,
        address indexed pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );

    /**
     * @notice Emitted when the router is paused
     * @param by Address that paused the router
     */
    event RouterPaused(address indexed by);

    /**
     * @notice Emitted when the router is unpaused
     * @param by Address that unpaused the router
     */
    event RouterUnpaused(address indexed by);

    /**
     * @notice Emitted when the factory address is updated
     * @param oldFactory Previous factory address
     * @param newFactory New factory address
     */
    event FactoryUpdated(address indexed oldFactory, address indexed newFactory);

    /**
     * @notice Emitted when stuck tokens are rescued
     * @param token Address of the rescued token
     * @param to Address that received the tokens
     * @param amount Amount of tokens rescued
     */
    event TokensRescued(address indexed token, address indexed to, uint256 amount);

    // ============ Custom Errors ============

    /// @notice Thrown when factory address is invalid (zero address)
    error InvalidFactory();

    /// @notice Thrown when hop count is invalid (0 or exceeds MAX_HOPS)
    error InvalidHopCount(uint256 provided, uint256 max);

    /// @notice Thrown when path hops are not connected (tokenOut != next tokenIn)
    error PathNotConnected(uint256 hopIndex);

    /// @notice Thrown when no pools are available for a token pair
    error NoPoolsAvailable(address tokenIn, address tokenOut);

    /// @notice Thrown when swap would exceed c-threshold for all available shards
    error ExceedsCThreshold(address tokenIn, address tokenOut, uint256 amountOut);

    /// @notice Thrown when required input exceeds maximum allowed (slippage)
    error ExcessiveSlippage(uint256 required, uint256 maxAllowed);

    /// @notice Thrown when transaction deadline has passed
    error DeadlineExceeded(uint256 deadline, uint256 currentTime);

    /// @notice Thrown when recipient address is invalid (zero address)
    error InvalidRecipient();

    /// @notice Thrown when pool returns less output than expected
    error InsufficientOutput(uint256 expected, uint256 received);

    // ============ Core Functions ============

    /**
     * @notice Execute a multi-hop swap with exact output amounts
     * @param path The swap path containing hops, slippage protection, and recipient
     * @return result The complete swap result with all hop details
     * @dev Reverts if any hop fails, ensuring atomic execution
     */
    function swapExactOutput(SwapPath calldata path) external returns (SwapResult memory result);

    // ============ Quote Functions ============

    /**
     * @notice Calculate expected amounts for a swap without executing
     * @param hops Array of swap hops to quote
     * @return result Quote result with expected amounts and selected shards
     */
    function quoteSwap(SwapHop[] calldata hops) external view returns (QuoteResult memory result);

    /**
     * @notice Get which shard would be selected for a single hop
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountOut Desired output amount
     * @return shard Address of the shard that would be selected
     */
    function getSelectedShard(
        address tokenIn,
        address tokenOut,
        uint256 amountOut
    ) external view returns (address shard);

    // ============ Admin Functions ============

    /**
     * @notice Pause all swap operations
     * @dev Only callable by owner
     */
    function pause() external;

    /**
     * @notice Unpause swap operations
     * @dev Only callable by owner
     */
    function unpause() external;

    /**
     * @notice Update the factory address
     * @param newFactory New factory contract address
     * @dev Only callable by owner
     */
    function setFactory(address newFactory) external;

    /**
     * @notice Rescue stuck tokens from the contract
     * @param token Address of token to rescue
     * @param to Address to send tokens to
     * @param amount Amount of tokens to rescue
     * @dev Only callable by owner, for emergency recovery
     */
    function rescueTokens(address token, address to, uint256 amount) external;

    // ============ View Functions ============

    /**
     * @notice Get the current factory address
     * @return The factory contract address
     */
    function factory() external view returns (address);

    /**
     * @notice Check if the router is paused
     * @return True if paused, false otherwise
     */
    function paused() external view returns (bool);

    /**
     * @notice Get the maximum number of hops allowed
     * @return The maximum hop count (4)
     */
    function maxHops() external view returns (uint256);
}
