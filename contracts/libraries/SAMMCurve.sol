// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SAMMCurve
 * @notice Library for constant product curve calculations
 * @dev Ported from Rust implementation in constant_product.rs
 *
 * Implements the constant product formula: x * y = k
 * Where x and y are token reserves, k is the invariant
 */
library SAMMCurve {
    /**
     * @notice Calculate input amount needed for a desired output amount
     * @param destinationAmount The exact amount of tokens user wants to receive
     * @param swapSourceAmount The current source token reserve
     * @param swapDestinationAmount The current destination token reserve
     * @return sourceAmountSwapped The amount of source tokens needed (before fees)
     * @return destinationAmountSwapped The amount of destination tokens to send
     *
     * @dev This is the core SAMM calculation (swap_revert in constant_product.rs:50-70)
     *
     * Formula:
     * invariant = source_reserve * destination_reserve
     * new_destination = destination_reserve - destination_amount
     * new_source = ceil(invariant / new_destination)
     * source_needed = new_source - source_reserve
     *
     * Uses ceiling division to favor the pool (round up source amount)
     */
    function swapRevert(
        uint256 destinationAmount,
        uint256 swapSourceAmount,
        uint256 swapDestinationAmount
    ) internal pure returns (uint256 sourceAmountSwapped, uint256 destinationAmountSwapped) {
        require(destinationAmount > 0, "SAMMCurve: zero destination amount");
        require(swapSourceAmount > 0, "SAMMCurve: zero source reserve");
        require(swapDestinationAmount > destinationAmount, "SAMMCurve: insufficient destination reserve");

        // Calculate invariant (k = x * y)
        uint256 invariant = swapSourceAmount * swapDestinationAmount;

        // Calculate new destination reserve after swap
        uint256 newSwapDestinationAmount = swapDestinationAmount - destinationAmount;

        // Calculate new source reserve (with ceiling division)
        // This ensures the invariant is maintained or slightly increased (favoring the pool)
        uint256 newSwapSourceAmount = invariant / newSwapDestinationAmount;

        // Add 1 if there's a remainder (ceiling division)
        if (newSwapSourceAmount * newSwapDestinationAmount != invariant) {
            newSwapSourceAmount += 1;
        }

        // Calculate how much source token is needed
        sourceAmountSwapped = newSwapSourceAmount - swapSourceAmount;
        destinationAmountSwapped = destinationAmount;

        return (sourceAmountSwapped, destinationAmountSwapped);
    }

    /**
     * @notice Traditional constant product swap (for reference/comparison)
     * @param sourceAmount The exact amount of tokens user wants to trade
     * @param swapSourceAmount The current source token reserve
     * @param swapDestinationAmount The current destination token reserve
     * @return sourceAmountSwapped The amount of source tokens used
     * @return destinationAmountSwapped The amount of destination tokens received
     *
     * @dev Traditional Uniswap-style swap (swap in constant_product.rs:27-46)
     *
     * Formula:
     * invariant = source_reserve * destination_reserve
     * new_source = source_reserve + source_amount
     * new_destination = ceil(invariant / new_source)
     * destination_out = destination_reserve - new_destination
     */
    function swap(
        uint256 sourceAmount,
        uint256 swapSourceAmount,
        uint256 swapDestinationAmount
    ) internal pure returns (uint256 sourceAmountSwapped, uint256 destinationAmountSwapped) {
        require(sourceAmount > 0, "SAMMCurve: zero source amount");
        require(swapSourceAmount > 0, "SAMMCurve: zero source reserve");
        require(swapDestinationAmount > 0, "SAMMCurve: zero destination reserve");

        // Calculate invariant
        uint256 invariant = swapSourceAmount * swapDestinationAmount;

        // Calculate new source reserve
        uint256 newSwapSourceAmount = swapSourceAmount + sourceAmount;

        // Calculate new destination reserve (with ceiling division)
        uint256 newSwapDestinationAmount = invariant / newSwapSourceAmount;
        if (newSwapDestinationAmount * newSwapSourceAmount < invariant) {
            newSwapDestinationAmount += 1;
        }

        // Calculate amounts swapped
        sourceAmountSwapped = newSwapSourceAmount - swapSourceAmount;
        destinationAmountSwapped = swapDestinationAmount - newSwapDestinationAmount;

        require(destinationAmountSwapped > 0, "SAMMCurve: insufficient output amount");

        return (sourceAmountSwapped, destinationAmountSwapped);
    }

    /**
     * @notice Calculate trading tokens for a given amount of pool tokens
     * @param poolTokens Amount of pool tokens
     * @param poolTokenSupply Total supply of pool tokens
     * @param swapTokenAAmount Reserve of token A
     * @param swapTokenBAmount Reserve of token B
     * @return tokenAAmount Amount of token A
     * @return tokenBAmount Amount of token B
     *
     * @dev Simple ratio calculation for LP token redemption
     * Formula: token_amount = (pool_tokens * reserve) / total_supply
     */
    function poolTokensToTradingTokens(
        uint256 poolTokens,
        uint256 poolTokenSupply,
        uint256 swapTokenAAmount,
        uint256 swapTokenBAmount
    ) internal pure returns (uint256 tokenAAmount, uint256 tokenBAmount) {
        require(poolTokenSupply > 0, "SAMMCurve: zero pool supply");

        tokenAAmount = (poolTokens * swapTokenAAmount) / poolTokenSupply;
        tokenBAmount = (poolTokens * swapTokenBAmount) / poolTokenSupply;

        return (tokenAAmount, tokenBAmount);
    }

    /**
     * @notice Validate that the invariant is maintained
     * @param oldSource Old source reserve
     * @param oldDestination Old destination reserve
     * @param newSource New source reserve
     * @param newDestination New destination reserve
     * @return true if invariant is maintained or increased
     */
    function validateInvariant(
        uint256 oldSource,
        uint256 oldDestination,
        uint256 newSource,
        uint256 newDestination
    ) internal pure returns (bool) {
        uint256 oldInvariant = oldSource * oldDestination;
        uint256 newInvariant = newSource * newDestination;
        return newInvariant >= oldInvariant;
    }
}
