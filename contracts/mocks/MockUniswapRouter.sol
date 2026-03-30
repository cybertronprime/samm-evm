// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../integrations/interfaces/IUniswapV3.sol";

/**
 * @title MockUniswapRouter
 * @notice Mock Uniswap V3 SwapRouter and QuoterV2 for testing.
 *         Returns a configurable amountIn for exactOutput calls.
 */
contract MockUniswapRouter is ISwapRouter {
    using SafeERC20 for IERC20;

    /// @notice Fixed amountIn returned for any exactOutput request (0 = revert)
    uint256 public mockAmountIn;
    bool public shouldRevert;

    event SwapExecuted(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    constructor(uint256 _mockAmountIn) {
        mockAmountIn = _mockAmountIn;
    }

    function setMockAmountIn(uint256 _amount) external {
        mockAmountIn = _amount;
    }

    function setShouldRevert(bool _revert) external {
        shouldRevert = _revert;
    }

    function exactOutputSingle(ExactOutputSingleParams calldata params)
        external
        payable
        override
        returns (uint256 amountIn)
    {
        require(!shouldRevert, "MockUniswapRouter: reverted");
        amountIn = mockAmountIn;
        // Transfer tokenIn from caller (already approved by aggregator)
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        // Give tokenOut to recipient
        IERC20(params.tokenOut).safeTransfer(params.recipient, params.amountOut);
        emit SwapExecuted(params.tokenIn, params.tokenOut, amountIn, params.amountOut);
    }

    function exactOutput(ExactOutputParams calldata)
        external
        payable
        override
        returns (uint256 amountIn)
    {
        require(!shouldRevert, "MockUniswapRouter: reverted");
        amountIn = mockAmountIn;
    }
}

/**
 * @title MockUniswapQuoter
 * @notice Mock Uniswap V3 QuoterV2 for testing.
 */
contract MockUniswapQuoter {
    uint256 public mockAmountIn;
    bool public shouldRevert;

    constructor(uint256 _mockAmountIn) {
        mockAmountIn = _mockAmountIn;
    }

    function setMockAmountIn(uint256 _amount) external {
        mockAmountIn = _amount;
    }

    function setShouldRevert(bool _revert) external {
        shouldRevert = _revert;
    }

    function quoteExactOutputSingle(
        IQuoterV2.QuoteExactOutputSingleParams memory
    )
        external
        view
        returns (
            uint256 amountIn,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 gasEstimate
        )
    {
        require(!shouldRevert, "MockUniswapQuoter: reverted");
        return (mockAmountIn, 0, 0, 50_000);
    }
}
