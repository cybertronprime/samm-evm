// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SAMMFees
 * @notice Library for calculating dynamic fees in SAMM using research paper formula
 * @dev Implements the bounded-ratio polynomial fee function from SAMM research paper
 *
 * SAMM Fee Formula (Research Paper):
 * tf_SAMM(RA,RB,OA) = (RB/RA) × OA × max{rmin, β1×(OA/RA) + rmax}
 * 
 * Where:
 * - RA = input token reserve
 * - RB = output token reserve  
 * - OA = output amount requested
 * - β1 = -1.05 (slope parameter)
 * - rmin = 0.001 (minimum fee rate)
 * - rmax = 0.012 (maximum fee rate)
 */
library SAMMFees {
    // SAMM parameters from research paper (scaled by 1e6 for precision)
    int256 public constant BETA1_SCALED = -1050000; // -1.05 * 1e6
    uint256 public constant RMIN_SCALED = 1000;     // 0.001 * 1e6 
    uint256 public constant RMAX_SCALED = 12000;    // 0.012 * 1e6
    uint256 public constant C_SCALED = 10400;       // 0.0104 * 1e6
    uint256 public constant SCALE_FACTOR = 1e6;

    /**
     * @notice Calculate the SAMM fee using research paper formula
     * @param outputAmount The amount of tokens the user wants to receive (OA)
     * @param outputReserve The current reserve of the output token (RB)
     * @param inputReserve The current reserve of the input token (RA)
     * @param beta1 The β1 parameter (scaled by 1e6)
     * @param rmin The rmin parameter (scaled by 1e6)
     * @param rmax The rmax parameter (scaled by 1e6)
     * @return fee The calculated fee amount in input tokens
     *
     * @dev Implements: tf_SAMM(RA,RB,OA) = (RB/RA) × OA × max{rmin, β1×(OA/RA) + rmax}
     */
    function calculateFeeSAMM(
        uint256 outputAmount,
        uint256 outputReserve,
        uint256 inputReserve,
        int256 beta1,
        uint256 rmin,
        uint256 rmax
    ) internal pure returns (uint256) {
        // Return 0 if no output or reserves are zero
        if (outputAmount == 0 || outputReserve == 0 || inputReserve == 0) {
            return 0;
        }

        // Calculate OA/RA ratio (scaled by 1e6 for precision)
        uint256 oaRaRatio = (outputAmount * SCALE_FACTOR) / inputReserve;
        
        // Calculate β1 × (OA/RA) + rmax
        // Note: beta1 is negative, so this is actually rmax - |beta1| × (OA/RA)
        int256 feeRateScaled = (beta1 * int256(oaRaRatio)) / int256(SCALE_FACTOR) + int256(rmax);
        
        // Take max{rmin, β1×(OA/RA) + rmax}
        uint256 finalFeeRate;
        if (feeRateScaled <= int256(rmin)) {
            finalFeeRate = rmin;
        } else {
            finalFeeRate = uint256(feeRateScaled);
        }
        
        // Calculate final fee: (RB/RA) × OA × fee_rate
        // fee = (outputReserve * outputAmount * finalFeeRate) / (inputReserve * SCALE_FACTOR)
        uint256 fee = (outputReserve * outputAmount * finalFeeRate) / (inputReserve * SCALE_FACTOR);
        
        return fee;
    }

    /**
     * @notice Calculate SAMM fee with default research paper parameters
     * @param outputAmount The amount of tokens the user wants to receive
     * @param outputReserve The current reserve of the output token
     * @param inputReserve The current reserve of the input token
     * @return fee The calculated fee amount in input tokens
     */
    function calculateFeeSAMMDefault(
        uint256 outputAmount,
        uint256 outputReserve,
        uint256 inputReserve
    ) internal pure returns (uint256) {
        return calculateFeeSAMM(
            outputAmount,
            outputReserve,
            inputReserve,
            BETA1_SCALED,
            RMIN_SCALED,
            RMAX_SCALED
        );
    }

    /**
     * @notice Validate c-threshold for SAMM properties
     * @param outputAmount The output amount requested
     * @param inputReserve The input token reserve
     * @param cThreshold The c-threshold parameter (scaled by 1e6)
     * @return valid True if OA/RA <= c (maintains SAMM properties)
     */
    function validateCThreshold(
        uint256 outputAmount,
        uint256 inputReserve,
        uint256 cThreshold
    ) internal pure returns (bool) {
        if (inputReserve == 0) return false;
        
        uint256 oaRaRatio = (outputAmount * SCALE_FACTOR) / inputReserve;
        return oaRaRatio <= cThreshold;
    }

    /**
     * @notice Calculate the legacy dynamic fee (for backward compatibility)
     * @param outputAmount The amount of tokens the user wants to receive
     * @param outputReserve The current reserve of the output token
     * @param inputReserve The current reserve of the input token
     * @param feeNumerator The base fee numerator
     * @param feeDenominator The fee denominator
     * @return fee The calculated fee amount in input tokens
     */
    function calculateFeeLegacy(
        uint256 outputAmount,
        uint256 outputReserve,
        uint256 inputReserve,
        uint256 feeNumerator,
        uint256 feeDenominator
    ) internal pure returns (uint256) {
        // Return 0 if fee is disabled or no output
        if (feeNumerator == 0 || outputAmount == 0) {
            return 0;
        }

        // Calculate max fee (5x base fee)
        uint256 maxFeeNumerator = feeNumerator * 5;

        // Calculate adaptive component
        uint256 tmp = (outputAmount * 12 * feeDenominator) / (10 * outputReserve);

        // Check if we should use minimal fee
        if (tmp + feeNumerator > maxFeeNumerator) {
            uint256 fee = (outputAmount * feeNumerator * inputReserve) /
                          (outputReserve * feeDenominator);
            return fee;
        } else {
            uint256 fee = (outputAmount * (maxFeeNumerator - tmp) * inputReserve) /
                          (outputReserve * feeDenominator);
            return fee;
        }
    }

    /**
     * @notice Calculate standard proportional fee (for traditional swaps)
     * @param tokenAmount The amount of tokens to calculate fee on
     * @param feeNumerator The fee numerator
     * @param feeDenominator The fee denominator
     * @return The calculated fee amount
     */
    function calculateFee(
        uint256 tokenAmount,
        uint256 feeNumerator,
        uint256 feeDenominator
    ) internal pure returns (uint256) {
        if (feeNumerator == 0 || tokenAmount == 0) {
            return 0;
        }

        uint256 fee = (tokenAmount * feeNumerator) / feeDenominator;

        // Minimum fee of 1 token if calculation rounds to 0
        if (fee == 0) {
            return 1;
        }

        return fee;
    }

    /**
     * @notice Calculate the owner's portion of trading fees
     * @param tradingTokens The amount of tokens being traded
     * @param ownerFeeNumerator The owner fee numerator
     * @param ownerFeeDenominator The owner fee denominator
     * @return The owner fee amount
     */
    function ownerTradingFee(
        uint256 tradingTokens,
        uint256 ownerFeeNumerator,
        uint256 ownerFeeDenominator
    ) internal pure returns (uint256) {
        return calculateFee(tradingTokens, ownerFeeNumerator, ownerFeeDenominator);
    }

    /**
     * @notice Calculate the host's portion of owner fees
     * @param ownerFee The owner fee amount
     * @param hostFeeNumerator The host fee numerator
     * @param hostFeeDenominator The host fee denominator
     * @return The host fee amount
     */
    function hostFee(
        uint256 ownerFee,
        uint256 hostFeeNumerator,
        uint256 hostFeeDenominator
    ) internal pure returns (uint256) {
        return calculateFee(ownerFee, hostFeeNumerator, hostFeeDenominator);
    }

    /**
     * @notice Validate that fee fractions are reasonable
     * @param numerator The fee numerator
     * @param denominator The fee denominator
     * @return true if valid, false otherwise
     */
    function validateFraction(uint256 numerator, uint256 denominator) internal pure returns (bool) {
        // Both zero is allowed (no fee)
        if (denominator == 0 && numerator == 0) {
            return true;
        }
        // Numerator must be less than denominator (fee < 100%)
        return numerator < denominator;
    }
}
