
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/ICrossPoolRouter.sol";
import "./interfaces/ISAMMPool.sol";
import "./interfaces/ISAMMPoolFactory.sol";

contract CrossPoolRouter is ICrossPoolRouter, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    ISAMMPoolFactory private _factory;
    uint256 public constant MAX_HOPS = 4;
    uint256 private constant SCALE_FACTOR = 1e6;

    struct ShardSelection { address shardAddress; uint256 requiredInput; uint256 fee; }

    constructor(address factoryAddress) Ownable(msg.sender) {
        require(factoryAddress != address(0), "InvalidFactory");
        _factory = ISAMMPoolFactory(factoryAddress);
    }

    modifier validatePath(SwapPath calldata path) {
        if (block.timestamp > path.deadline) revert DeadlineExceeded(path.deadline, block.timestamp);
        if (path.hops.length == 0 || path.hops.length > MAX_HOPS) revert InvalidHopCount(path.hops.length, MAX_HOPS);
        if (path.recipient == address(0)) revert InvalidRecipient();
        for (uint256 i = 0; i < path.hops.length - 1; i++) {
            if (path.hops[i].tokenOut != path.hops[i+1].tokenIn) revert PathNotConnected(i);
        }
        _;
    }

    function swapExactOutput(SwapPath calldata path) external override nonReentrant whenNotPaused validatePath(path) returns (SwapResult memory result) {
        uint256 numHops = path.hops.length;
        ShardSelection[] memory selections = new ShardSelection[](numHops);
        uint256[] memory hopAmountsOut = new uint256[](numHops);
        for (uint256 i = 0; i < numHops; i++) hopAmountsOut[i] = path.hops[i].amountOut;

        // Select cheapest shard for each hop (reverse order)
        for (uint256 i = numHops; i > 0; i--) {
            uint256 idx = i - 1;
            SwapHop calldata hop = path.hops[idx];
            selections[idx] = _selectCheapestShard(hop.tokenIn, hop.tokenOut, hopAmountsOut[idx]);
            if (idx > 0) hopAmountsOut[idx-1] = selections[idx].requiredInput;
        }

        uint256 totalInputRequired = selections[0].requiredInput;
        if (totalInputRequired > path.maxAmountIn) revert ExcessiveSlippage(totalInputRequired, path.maxAmountIn);

        IERC20(path.hops[0].tokenIn).safeTransferFrom(msg.sender, address(this), totalInputRequired);
        _batchApprove(path.hops, selections, numHops);

        result.hopResults = new HopResult[](numHops);
        result.totalFees = 0;
        for (uint256 i = 0; i < numHops; i++) {
            SwapHop calldata hop = path.hops[i];
            ShardSelection memory selection = selections[i];
            ISAMMPool pool = ISAMMPool(selection.shardAddress);
            uint256 actualIn = pool.swapSAMM(hopAmountsOut[i], selection.requiredInput, hop.tokenIn, hop.tokenOut, address(this));
            result.hopResults[i] = HopResult({
                pool: selection.shardAddress,
                tokenIn: hop.tokenIn,
                tokenOut: hop.tokenOut,
                amountIn: actualIn,
                amountOut: hopAmountsOut[i],
                fee: selection.fee
            });
            result.totalFees += selection.fee;
            emit HopExecuted(i, selection.shardAddress, hop.tokenIn, hop.tokenOut, actualIn, hopAmountsOut[i], selection.fee);
        }
        _clearRemainingApprovals(path.hops, selections, numHops);
        address lastTokenOut = path.hops[numHops-1].tokenOut;
        IERC20(lastTokenOut).safeTransfer(path.recipient, hopAmountsOut[numHops-1]);

        result.totalAmountIn = result.hopResults[0].amountIn;
        result.totalAmountOut = hopAmountsOut[numHops-1];
        emit SwapExecuted(msg.sender, path.hops[0].tokenIn, lastTokenOut, result.totalAmountIn, result.totalAmountOut, numHops);
        return result;
    }

    function quoteSwap(SwapHop[] calldata hops) external view override returns (QuoteResult memory result) {
        if (hops.length == 0 || hops.length > MAX_HOPS) revert InvalidHopCount(hops.length, MAX_HOPS);
        for (uint256 i = 0; i < hops.length-1; i++) if (hops[i].tokenOut != hops[i+1].tokenIn) revert PathNotConnected(i);
        uint256 numHops = hops.length;
        result.hopAmountsIn = new uint256[](numHops);
        result.hopFees = new uint256[](numHops);
        result.selectedShards = new address[](numHops);
        result.priceImpacts = new uint256[](numHops);
        uint256[] memory hopAmountsOut = new uint256[](numHops);
        for (uint256 i = 0; i < numHops; i++) hopAmountsOut[i] = hops[i].amountOut;
        for (uint256 i = numHops; i > 0; i--) {
            uint256 idx = i-1;
            SwapHop calldata hop = hops[idx];
            ShardSelection memory sel = _selectCheapestShard(hop.tokenIn, hop.tokenOut, hopAmountsOut[idx]);
            result.selectedShards[idx] = sel.shardAddress;
            result.hopAmountsIn[idx] = sel.requiredInput;
            result.hopFees[idx] = sel.fee;
            result.priceImpacts[idx] = _calculatePriceImpact(ISAMMPool(sel.shardAddress), hop.tokenIn, hop.tokenOut, sel.requiredInput, hopAmountsOut[idx]);
            if (idx > 0) hopAmountsOut[idx-1] = sel.requiredInput;
        }
        result.expectedAmountIn = result.hopAmountsIn[0];
        return result;
    }

    function getSelectedShard(address tokenIn, address tokenOut, uint256 amountOut) external view override returns (address shard) {
        return _selectCheapestShard(tokenIn, tokenOut, amountOut).shardAddress;
    }

    // ---------- New cheap selection logic ----------
    function _selectCheapestShard(address tokenIn, address tokenOut, uint256 amountOut) internal view returns (ShardSelection memory best) {
        address[] memory shards = _factory.getShardsForPair(tokenIn, tokenOut);
        if (shards.length == 0) revert NoPoolsAvailable(tokenIn, tokenOut);
        uint256 bestAmountIn = type(uint256).max;
        bool found = false;
        for (uint256 i = 0; i < shards.length; i++) {
            address shardAddr = shards[i];
            ISAMMPoolFactory.ShardInfo memory info = _factory.getShardInfo(shardAddr);
            if (!info.isActive) continue;
            ISAMMPool pool = ISAMMPool(shardAddr);
            // Quick c‑threshold check (optional, but we'll call calculateSwap anyway)
            (uint256 reserveIn, uint256 reserveOut) = _getReservesForToken(pool, tokenIn, tokenOut);
            uint8 outDec = IERC20Metadata(tokenOut).decimals();
            if (!_validateCThresholdQuick(amountOut, reserveOut, outDec, info.c)) continue;
            ISAMMPool.SwapResult memory swapCalc = pool.calculateSwapSAMM(amountOut, tokenIn, tokenOut);
            if (swapCalc.amountIn < bestAmountIn) {
                bestAmountIn = swapCalc.amountIn;
                best = ShardSelection({
                    shardAddress: shardAddr,
                    requiredInput: swapCalc.amountIn,
                    fee: swapCalc.tradeFee + swapCalc.ownerFee
                });
                found = true;
            }
        }
        if (!found) revert ExceedsCThreshold(tokenIn, tokenOut, amountOut);
        return best;
    }

    function _getReservesForToken(ISAMMPool pool, address tokenIn, address tokenOut) internal view returns (uint256 reserveIn, uint256 reserveOut) {
        (uint256 rA, uint256 rB) = pool.getReserves();
        address tokenA = pool.tokenA();
        if (tokenIn == tokenA) { reserveIn = rA; reserveOut = rB; }
        else { reserveIn = rB; reserveOut = rA; }
    }

    function _validateCThresholdQuick(uint256 amountOut, uint256 reserveOut, uint8 outDec, uint256 c) internal pure returns (bool) {
        if (reserveOut == 0) return false;
        uint256 normAmount = _normalize(amountOut, outDec);
        uint256 normReserve = _normalize(reserveOut, outDec);
        return (normAmount * SCALE_FACTOR) / normReserve <= c;
    }

    function _normalize(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        if (decimals == 18) return amount;
        else if (decimals < 18) return amount * (10 ** (18 - decimals));
        else return amount / (10 ** (decimals - 18));
    }

    function _calculatePriceImpact(ISAMMPool pool, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) internal view returns (uint256) {
        // Simplified; return 0 for testing
        return 0;
    }

    function _batchApprove(SwapHop[] calldata hops, ShardSelection[] memory selections, uint256 numHops) internal {
        for (uint256 i = 0; i < numHops; i++) {
            IERC20(hops[i].tokenIn).safeIncreaseAllowance(selections[i].shardAddress, selections[i].requiredInput);
        }
    }

    function _clearRemainingApprovals(SwapHop[] calldata hops, ShardSelection[] memory selections, uint256 numHops) internal {
        for (uint256 i = 0; i < numHops; i++) {
            uint256 remaining = IERC20(hops[i].tokenIn).allowance(address(this), selections[i].shardAddress);
            if (remaining > 0) {
                IERC20(hops[i].tokenIn).safeDecreaseAllowance(selections[i].shardAddress, remaining);
            }
        }
    }

    // Admin functions
    function pause() external onlyOwner { _pause(); emit RouterPaused(msg.sender); }
    function unpause() external onlyOwner { _unpause(); emit RouterUnpaused(msg.sender); }
    function setFactory(address newFactory) external onlyOwner {
        address oldFactory = address(_factory);
        _factory = ISAMMPoolFactory(newFactory);
        emit FactoryUpdated(oldFactory, newFactory);
    }
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner { IERC20(token).safeTransfer(to, amount); emit TokensRescued(token, to, amount); }
    function factory() external view returns (address) { return address(_factory); }
    function paused() public view override(ICrossPoolRouter, Pausable) returns (bool) { return super.paused(); }
    function maxHops() external pure override returns (uint256) { return MAX_HOPS; }

    // Custom errors
    error DeadlineExceeded(uint256 deadline, uint256 blockTimestamp);
    error InvalidHopCount(uint256 hops, uint256 maxHops);
    error InvalidRecipient();
    error PathNotConnected(uint256 hopIndex);
    error ExcessiveSlippage(uint256 amountIn, uint256 maxAmountIn);
    error NoPoolsAvailable(address tokenIn, address tokenOut);
    error ExceedsCThreshold(address tokenIn, address tokenOut, uint256 amountOut);
}
