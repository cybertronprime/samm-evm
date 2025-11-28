// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/SAMMFees.sol";

/**
 * @title SAMMFeesTest
 * @notice Test contract to expose SAMMFees library functions
 */
contract SAMMFeesTest {
    using SAMMFees for *;

    function calculateFeeSAMM(
        uint256 outputAmount,
        uint256 outputReserve,
        uint256 inputReserve,
        int256 beta1,
        uint256 rmin,
        uint256 rmax
    ) external pure returns (uint256) {
        return SAMMFees.calculateFeeSAMM(
            outputAmount,
            outputReserve,
            inputReserve,
            beta1,
            rmin,
            rmax
        );
    }

    function calculateFeeSAMMDefault(
        uint256 outputAmount,
        uint256 outputReserve,
        uint256 inputReserve
    ) external pure returns (uint256) {
        return SAMMFees.calculateFeeSAMMDefault(
            outputAmount,
            outputReserve,
            inputReserve
        );
    }

    function validateCThreshold(
        uint256 outputAmount,
        uint256 inputReserve,
        uint256 cThreshold
    ) external pure returns (bool) {
        return SAMMFees.validateCThreshold(
            outputAmount,
            inputReserve,
            cThreshold
        );
    }

    function calculateFeeLegacy(
        uint256 outputAmount,
        uint256 outputReserve,
        uint256 inputReserve,
        uint256 feeNumerator,
        uint256 feeDenominator
    ) external pure returns (uint256) {
        return SAMMFees.calculateFeeLegacy(
            outputAmount,
            outputReserve,
            inputReserve,
            feeNumerator,
            feeDenominator
        );
    }

    // Expose constants for testing
    function getBeta1Scaled() external pure returns (int256) {
        return SAMMFees.BETA1_SCALED;
    }

    function getRminScaled() external pure returns (uint256) {
        return SAMMFees.RMIN_SCALED;
    }

    function getRmaxScaled() external pure returns (uint256) {
        return SAMMFees.RMAX_SCALED;
    }

    function getCScaled() external pure returns (uint256) {
        return SAMMFees.C_SCALED;
    }

    function getScaleFactor() external pure returns (uint256) {
        return SAMMFees.SCALE_FACTOR;
    }
}