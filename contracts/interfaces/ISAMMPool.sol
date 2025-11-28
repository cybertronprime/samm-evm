// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISAMMPool
 * @notice Interface for SAMM Pool contract
 */
interface ISAMMPool {
    // Events
    event PoolInitialized(
        address indexed tokenA,
        address indexed tokenB,
        uint256 amountA,
        uint256 amountB,
        uint256 lpTokens
    );

    event SwapSAMM(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );

    event LiquidityAdded(
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 lpTokens
    );

    event LiquidityRemoved(
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 lpTokens
    );

    event FeesUpdated(
        uint256 tradeFeeNumerator,
        uint256 tradeFeeDenominator,
        uint256 ownerFeeNumerator,
        uint256 ownerFeeDenominator
    );

    event SAMMParamsUpdated(
        int256 beta1,
        uint256 rmin,
        uint256 rmax,
        uint256 c
    );

    // Structs
    struct PoolState {
        address tokenA;
        address tokenB;
        uint256 reserveA;
        uint256 reserveB;
        uint256 totalSupply;
        uint256 tradeFeeNumerator;
        uint256 tradeFeeDenominator;
        uint256 ownerFeeNumerator;
        uint256 ownerFeeDenominator;
    }

    struct SwapResult {
        uint256 amountIn;
        uint256 amountOut;
        uint256 tradeFee;
        uint256 ownerFee;
    }

    // Main functions
    function initialize(
        address _tokenA,
        address _tokenB,
        uint256 _amountA,
        uint256 _amountB,
        uint256 _tradeFeeNumerator,
        uint256 _tradeFeeDenominator,
        uint256 _ownerFeeNumerator,
        uint256 _ownerFeeDenominator
    ) external returns (uint256 lpTokens);

    function swapSAMM(
        uint256 amountOut,
        uint256 maximalAmountIn,
        address tokenIn,
        address tokenOut,
        address recipient
    ) external returns (uint256 amountIn);

    function addLiquidity(
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);

    function removeLiquidity(
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to
    ) external returns (uint256 amountA, uint256 amountB);

    // View functions
    function getReserves() external view returns (uint256 reserveA, uint256 reserveB);

    function getPoolState() external view returns (PoolState memory);

    function calculateSwapSAMM(
        uint256 amountOut,
        address tokenIn,
        address tokenOut
    ) external view returns (SwapResult memory);

    function quote(
        uint256 amountA,
        uint256 reserveA,
        uint256 reserveB
    ) external pure returns (uint256 amountB);
}
