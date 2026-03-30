
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICrossPoolRouter {
    struct SwapHop {
        address tokenIn;
        address tokenOut;
        uint256 amountOut;
    }

    struct SwapPath {
        SwapHop[] hops;
        uint256 maxAmountIn;
        uint256 deadline;
        address recipient;
    }

    struct HopResult {
        address pool;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        uint256 fee;
    }

    struct SwapResult {
        HopResult[] hopResults;
        uint256 totalAmountIn;
        uint256 totalAmountOut;
        uint256 totalFees;
    }

    struct QuoteResult {
        uint256 expectedAmountIn;
        uint256[] hopAmountsIn;
        uint256[] hopFees;
        address[] selectedShards;
        uint256[] priceImpacts;
    }

    event SwapExecuted(address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 numHops);
    event HopExecuted(uint256 indexed hopIndex, address indexed pool, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee);
    event RouterPaused(address indexed by);
    event RouterUnpaused(address indexed by);
    event FactoryUpdated(address indexed oldFactory, address indexed newFactory);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);

    function swapExactOutput(SwapPath calldata path) external returns (SwapResult memory);
    function quoteSwap(SwapHop[] calldata hops) external view returns (QuoteResult memory);
    function getSelectedShard(address tokenIn, address tokenOut, uint256 amountOut) external view returns (address shard);
    function pause() external;
    function unpause() external;
    function setFactory(address newFactory) external;
    function rescueTokens(address token, address to, uint256 amount) external;
    function factory() external view returns (address);
    function paused() external view returns (bool);
    function maxHops() external pure returns (uint256);
}
