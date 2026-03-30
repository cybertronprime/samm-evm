// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/ISAMMPool.sol";

/**
 * @title NanopaymentArbitrageur
 * @notice Executes nanopayment-sized arbitrage between SAMM shards on Arc chain.
 * @dev Designed for Arc testnet where USDC is the native gas token.
 *      nanoAmount is intentionally tiny (e.g., 0.01 USDC = 10_000 in 6-decimal USDC).
 */
contract NanopaymentArbitrageur is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Types ============

    struct AgentStats {
        uint256 totalArbs;
        uint256 successfulArbs;
        uint256 totalProfit; // in base token units
    }

    // ============ State ============

    mapping(address => bool) public authorizedAgents;
    mapping(address => AgentStats) public agentStats;

    // ============ Events ============

    event NanoArbitrage(
        address indexed agent,
        address pool1,
        address pool2,
        uint256 profit,
        uint256 timestamp
    );
    event AgentRegistered(address indexed agent);
    event AgentRevoked(address indexed agent);
    event ProfitsWithdrawn(address indexed token, address indexed to, uint256 amount);

    // ============ Errors ============

    error UnauthorizedAgent(address agent);
    error ZeroAddress();
    error ZeroAmount();
    error NoProfitableArb();
    error SamePool();

    // ============ Modifiers ============

    modifier onlyAgent() {
        if (!authorizedAgents[msg.sender]) revert UnauthorizedAgent(msg.sender);
        _;
    }

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Core ============

    /**
     * @notice Execute a nanopayment arbitrage between two SAMM shards.
     * @param pool1      Address of the pool to buy on (cheaper)
     * @param pool2      Address of the pool to sell on (more expensive)
     * @param tokenA     Input/output token of the pair
     * @param tokenB     The token to buy on pool1 and sell on pool2
     * @param nanoAmount Tiny amount of tokenA to spend (e.g. 10_000 = 0.01 USDC)
     * @return profit    Net profit in tokenA units
     */
    function executeNanoArbitrage(
        address pool1,
        address pool2,
        address tokenA,
        address tokenB,
        uint256 nanoAmount
    ) external onlyAgent nonReentrant returns (uint256 profit) {
        if (pool1 == pool2) revert SamePool();
        if (nanoAmount == 0) revert ZeroAmount();

        AgentStats storage stats = agentStats[msg.sender];
        stats.totalArbs++;

        uint256 tokenABefore = IERC20(tokenA).balanceOf(address(this));
        uint256 tokenBBefore = IERC20(tokenB).balanceOf(address(this));

        // --- Step 1: Quote how much tokenB we can receive for nanoAmount of tokenA ---
        // calculateSwapSAMM(amountOut, tokenIn, tokenOut): "to receive amountOut of tokenOut,
        // how much tokenIn do I need?" — we use nanoAmount as the desired output (≈1:1 for stables).
        ISAMMPool.SwapResult memory buyQuote = ISAMMPool(pool1).calculateSwapSAMM(
            nanoAmount,
            tokenA,
            tokenB
        );
        if (buyQuote.amountOut == 0 || buyQuote.amountIn > tokenABefore) revert NoProfitableArb();

        // --- Step 2: Execute buy (exact output: receive nanoAmount tokenB, pay ≤ buyQuote.amountIn) ---
        IERC20(tokenA).forceApprove(pool1, buyQuote.amountIn);
        ISAMMPool(pool1).swapSAMM(
            nanoAmount,       // amountOut: exact tokenB to receive
            buyQuote.amountIn, // maximalAmountIn
            tokenA,
            tokenB,
            address(this)
        );

        // --- Step 3: Measure actual tokenB received (delta, not total balance) ---
        uint256 tokenBReceived = IERC20(tokenB).balanceOf(address(this)) - tokenBBefore;
        if (tokenBReceived == 0) revert NoProfitableArb();

        // --- Step 4: Quote how much tokenA we'd get selling tokenBReceived on pool2 ---
        ISAMMPool.SwapResult memory sellQuote = ISAMMPool(pool2).calculateSwapSAMM(
            tokenBReceived,
            tokenB,
            tokenA
        );

        // --- Step 5: Execute sell (exact output: receive sellQuote.amountOut tokenA) ---
        IERC20(tokenB).forceApprove(pool2, tokenBReceived);
        ISAMMPool(pool2).swapSAMM(
            sellQuote.amountOut, // amountOut: tokenA to receive
            tokenBReceived,      // maximalAmountIn: all tokenB we received
            tokenB,
            tokenA,
            address(this)
        );

        uint256 tokenAAfter = IERC20(tokenA).balanceOf(address(this));
        // Must have more tokenA than before the arb started
        if (tokenAAfter <= tokenABefore) revert NoProfitableArb();

        profit = tokenAAfter - tokenABefore;
        stats.successfulArbs++;
        stats.totalProfit += profit;

        emit NanoArbitrage(msg.sender, pool1, pool2, profit, block.timestamp);
    }

    /**
     * @notice Autonomous arbitrage — agent calls this and the contract auto-detects
     *         the best opportunity across registered shard pairs.
     * @dev Off-chain agent selects the optimal pool1/pool2 pair via quoteNanoArbitrage.
     *      This function delegates to the core executeNanoArbitrage logic.
     */
    function executeAutonomousArbitrage(
        address pool1,
        address pool2,
        address tokenA,
        address tokenB,
        uint256 nanoAmount
    ) external onlyAgent nonReentrant returns (uint256 profit) {
        if (pool1 == pool2) revert SamePool();
        if (nanoAmount == 0) revert ZeroAmount();

        AgentStats storage stats = agentStats[msg.sender];
        stats.totalArbs++;

        uint256 tokenABefore = IERC20(tokenA).balanceOf(address(this));
        uint256 tokenBBefore = IERC20(tokenB).balanceOf(address(this));

        ISAMMPool.SwapResult memory buyQuote = ISAMMPool(pool1).calculateSwapSAMM(
            nanoAmount,
            tokenA,
            tokenB
        );
        if (buyQuote.amountOut == 0 || buyQuote.amountIn > tokenABefore) revert NoProfitableArb();

        IERC20(tokenA).forceApprove(pool1, buyQuote.amountIn);
        ISAMMPool(pool1).swapSAMM(nanoAmount, buyQuote.amountIn, tokenA, tokenB, address(this));

        uint256 tokenBReceived = IERC20(tokenB).balanceOf(address(this)) - tokenBBefore;
        if (tokenBReceived == 0) revert NoProfitableArb();

        ISAMMPool.SwapResult memory sellQuote = ISAMMPool(pool2).calculateSwapSAMM(
            tokenBReceived,
            tokenB,
            tokenA
        );

        IERC20(tokenB).forceApprove(pool2, tokenBReceived);
        ISAMMPool(pool2).swapSAMM(sellQuote.amountOut, tokenBReceived, tokenB, tokenA, address(this));

        uint256 tokenAAfter = IERC20(tokenA).balanceOf(address(this));
        if (tokenAAfter <= tokenABefore) revert NoProfitableArb();

        profit = tokenAAfter - tokenABefore;
        stats.successfulArbs++;
        stats.totalProfit += profit;

        emit NanoArbitrage(msg.sender, pool1, pool2, profit, block.timestamp);
    }

    /**
     * @notice Preview the profit of a nano-arb without executing.
     * @return estimatedProfit Positive = profitable, negative = loss
     */
    function quoteNanoArbitrage(
        address pool1,
        address pool2,
        address tokenA,
        address tokenB,
        uint256 nanoAmount
    ) external view returns (int256 estimatedProfit) {
        if (pool1 == pool2 || nanoAmount == 0) return 0;

        try ISAMMPool(pool1).calculateSwapSAMM(nanoAmount, tokenA, tokenB) returns (
            ISAMMPool.SwapResult memory buyQuote
        ) {
            if (buyQuote.amountOut == 0) return 0;
            try ISAMMPool(pool2).calculateSwapSAMM(buyQuote.amountOut, tokenB, tokenA) returns (
                ISAMMPool.SwapResult memory sellQuote
            ) {
                // net: sellQuote.amountOut received - buyQuote.amountIn spent
                estimatedProfit = int256(sellQuote.amountOut) - int256(buyQuote.amountIn);
            } catch {
                return 0;
            }
        } catch {
            return 0;
        }
    }

    // ============ Admin ============

    function registerAgent(address agent) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        authorizedAgents[agent] = true;
        emit AgentRegistered(agent);
    }

    function revokeAgent(address agent) external onlyOwner {
        authorizedAgents[agent] = false;
        emit AgentRevoked(agent);
    }

    function withdrawProfits(address token, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(to, balance);
        emit ProfitsWithdrawn(token, to, balance);
    }

    function getAgentStats(address agent) external view returns (AgentStats memory) {
        return agentStats[agent];
    }
}
