// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/ICrossPoolRouter.sol";

/**
 * @title MockCrossPoolRouter
 * @notice Mock CrossPoolRouter for testing UniswapSAMMAggregator.
 *         By default, quoteSwap reverts (simulating no SAMM pools available)
 *         and swapExactOutput can optionally succeed.
 */
contract MockCrossPoolRouter is ICrossPoolRouter {
    using SafeERC20 for IERC20;

    bool public shouldQuoteRevert = true;
    bool public shouldSwapRevert = true;
    uint256 public mockAmountIn;

    event SwapExecuted(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    function setQuoteBehavior(bool _revert, uint256 _amountIn) external {
        shouldQuoteRevert = _revert;
        mockAmountIn = _amountIn;
    }

    function setSwapBehavior(bool _revert) external {
        shouldSwapRevert = _revert;
    }

    function quoteSwap(SwapHop[] calldata hops)
        external
        view
        override
        returns (QuoteResult memory result)
    {
        require(!shouldQuoteRevert, "MockCrossPoolRouter: no quote available");

        uint256[] memory amounts = new uint256[](hops.length);
        uint256[] memory fees = new uint256[](hops.length);
        address[] memory shards = new address[](hops.length);
        uint256[] memory impacts = new uint256[](hops.length);
        amounts[0] = mockAmountIn;

        result = QuoteResult({
            expectedAmountIn: mockAmountIn,
            hopAmountsIn: amounts,
            hopFees: fees,
            selectedShards: shards,
            priceImpacts: impacts
        });
    }

    function swapExactOutput(SwapPath calldata path)
        external
        override
        returns (SwapResult memory result)
    {
        require(!shouldSwapRevert, "MockCrossPoolRouter: swap unavailable");

        // Transfer tokenIn from aggregator (which already holds the tokens)
        IERC20(path.hops[0].tokenIn).transferFrom(msg.sender, address(this), mockAmountIn);
        // Transfer tokenOut to recipient
        IERC20(path.hops[0].tokenOut).transfer(path.recipient, path.hops[0].amountOut);

        HopResult[] memory hopResults = new HopResult[](1);
        hopResults[0] = HopResult({
            pool: address(0),
            tokenIn: path.hops[0].tokenIn,
            tokenOut: path.hops[0].tokenOut,
            amountIn: mockAmountIn,
            amountOut: path.hops[0].amountOut,
            fee: 0
        });

        result = SwapResult({
            hopResults: hopResults,
            totalAmountIn: mockAmountIn,
            totalAmountOut: path.hops[0].amountOut,
            totalFees: 0
        });
    }

    // ---- Stub admin functions ----

    function getSelectedShard(address, address, uint256) external pure override returns (address) {
        return address(0);
    }

    function pause() external override {}
    function unpause() external override {}
    function setFactory(address) external override {}
    function rescueTokens(address, address, uint256) external override {}
    function factory() external pure override returns (address) { return address(0); }
    function paused() external pure override returns (bool) { return false; }
    function maxHops() external pure override returns (uint256) { return 4; }
}
