
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
    struct SwapResult {
        uint256 amountIn;
        uint256 amountOut;
        uint256 tradeFee;
        uint256 ownerFee;
    }

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

    function initialize(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB,
        uint256 tradeFeeNumerator,
        uint256 tradeFeeDenominator,
        uint256 ownerFeeNumerator,
        uint256 ownerFeeDenominator
    ) external returns (uint256 lpTokens);

    function initialize(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB,
        uint256 tradeFeeNumerator,
        uint256 tradeFeeDenominator,
        uint256 ownerFeeNumerator,
        uint256 ownerFeeDenominator,
        address liquidityRecipient
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

    function calculateSwapSAMM(
        uint256 amountOut,
        address tokenIn,
        address tokenOut
    ) external view returns (SwapResult memory);

    function getReserves() external view returns (uint256 reserveA, uint256 reserveB);
    function getPoolState() external view returns (PoolState memory);
    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) external pure returns (uint256 amountB);
    function updateFees(
        uint256 tradeFeeNumerator,
        uint256 tradeFeeDenominator,
        uint256 ownerFeeNumerator,
        uint256 ownerFeeDenominator
    ) external;
    function updateSAMMParams(int256 beta1, uint256 rmin, uint256 rmax, uint256 c) external;
    function getSAMMParams() external view returns (int256 beta1, uint256 rmin, uint256 rmax, uint256 c);
    function withdrawFees(address to) external;
    function tokenA() external view returns (address);
    function tokenB() external view returns (address);
}
