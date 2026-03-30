// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/**
 * @title ChainlinkPriceValidator
 * @notice Validates SAMM swap prices against Chainlink oracle prices.
 * @dev Deployed on Ethereum Sepolia with Chainlink Price Feed oracles.
 *
 *  Sepolia feed addresses:
 *   ETH/USD : 0x694AA1769357215DE4FAC081bf1f309aDC325306
 *   BTC/USD : 0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43
 *   LINK/USD: 0xc59E3633BAAC79493d908e63626716e204A45EdF
 *   USDC/USD: 0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E
 */
contract ChainlinkPriceValidator is Ownable {
    // ============ State ============

    /// @notice token address => Chainlink feed address
    mapping(address => address) public priceFeeds;

    /// @notice Maximum allowed deviation from oracle price (default 5%)
    uint256 public maxDeviation; // in basis points, e.g. 500 = 5%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Staleness threshold for Chainlink answers (default 1 hour)
    uint256 public stalenessThreshold;

    // ============ Events ============

    event FeedAdded(address indexed token, address indexed feed);
    event FeedRemoved(address indexed token);
    event FeedUpdated(address indexed token, address indexed oldFeed, address indexed newFeed);
    event MaxDeviationUpdated(uint256 oldDeviation, uint256 newDeviation);
    event StalenessThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    // ============ Errors ============

    error ZeroAddress();
    error FeedNotFound(address token);
    error StalePrice(address feed, uint256 updatedAt, uint256 threshold);
    error InvalidPrice(address feed, int256 price);
    error InvalidDeviation(uint256 provided, uint256 max);

    // ============ Constructor ============

    /**
     * @param _maxDeviation   Initial max deviation in bps (e.g. 500 = 5%)
     * @param _stalenessThreshold  Max age of a Chainlink answer in seconds
     */
    constructor(uint256 _maxDeviation, uint256 _stalenessThreshold) Ownable(msg.sender) {
        maxDeviation = _maxDeviation;
        stalenessThreshold = _stalenessThreshold;
    }

    // ============ Core View ============

    /**
     * @notice Validate a SAMM-reported swap price against Chainlink oracles.
     * @param tokenIn     Input token address
     * @param tokenOut    Output token address
     * @param sammPrice   SAMM price as (amountIn / amountOut) scaled by 1e18
     * @return isValid    True if deviation < maxDeviation
     * @return oraclePrice  Expected price from Chainlink (scaled by 1e18)
     * @return deviation   Absolute deviation in basis points
     */
    function validateSwapPrice(
        address tokenIn,
        address tokenOut,
        uint256 sammPrice
    ) external view returns (bool isValid, uint256 oraclePrice, uint256 deviation) {
        uint256 priceIn = _getTokenPrice(tokenIn);
        uint256 priceOut = _getTokenPrice(tokenOut);

        // oraclePrice = price(tokenIn) / price(tokenOut), scaled by 1e18
        oraclePrice = (priceIn * 1e18) / priceOut;

        if (oraclePrice == 0) {
            return (false, 0, BPS_DENOMINATOR);
        }

        // Absolute percentage deviation in bps
        uint256 diff = sammPrice > oraclePrice ? sammPrice - oraclePrice : oraclePrice - sammPrice;
        deviation = (diff * BPS_DENOMINATOR) / oraclePrice;
        isValid = deviation < maxDeviation;
    }

    /**
     * @notice Get the USD price (18 decimals) for a token.
     */
    function getTokenPrice(address token) external view returns (uint256 price) {
        return _getTokenPrice(token);
    }

    // ============ Internal ============

    function _getTokenPrice(address token) internal view returns (uint256) {
        address feed = priceFeeds[token];
        if (feed == address(0)) revert FeedNotFound(token);

        AggregatorV3Interface aggregator = AggregatorV3Interface(feed);
        (, int256 answer, , uint256 updatedAt, ) = aggregator.latestRoundData();

        if (block.timestamp - updatedAt > stalenessThreshold)
            revert StalePrice(feed, updatedAt, stalenessThreshold);
        if (answer <= 0) revert InvalidPrice(feed, answer);

        uint8 decimals = aggregator.decimals();
        // Normalize to 18 decimals
        return uint256(answer) * (10 ** (18 - decimals));
    }

    // ============ Admin ============

    function addFeed(address token, address feed) external onlyOwner {
        if (token == address(0) || feed == address(0)) revert ZeroAddress();
        priceFeeds[token] = feed;
        emit FeedAdded(token, feed);
    }

    function removeFeed(address token) external onlyOwner {
        if (priceFeeds[token] == address(0)) revert FeedNotFound(token);
        delete priceFeeds[token];
        emit FeedRemoved(token);
    }

    function updateFeed(address token, address newFeed) external onlyOwner {
        if (token == address(0) || newFeed == address(0)) revert ZeroAddress();
        address old = priceFeeds[token];
        priceFeeds[token] = newFeed;
        emit FeedUpdated(token, old, newFeed);
    }

    function setMaxDeviation(uint256 _maxDeviation) external onlyOwner {
        if (_maxDeviation > BPS_DENOMINATOR) revert InvalidDeviation(_maxDeviation, BPS_DENOMINATOR);
        emit MaxDeviationUpdated(maxDeviation, _maxDeviation);
        maxDeviation = _maxDeviation;
    }

    function setStalenessThreshold(uint256 _threshold) external onlyOwner {
        emit StalenessThresholdUpdated(stalenessThreshold, _threshold);
        stalenessThreshold = _threshold;
    }

    /// @notice Batch-add feeds for convenience
    function addFeeds(address[] calldata tokens, address[] calldata feeds) external onlyOwner {
        require(tokens.length == feeds.length, "Length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == address(0) || feeds[i] == address(0)) revert ZeroAddress();
            priceFeeds[tokens[i]] = feeds[i];
            emit FeedAdded(tokens[i], feeds[i]);
        }
    }
}
