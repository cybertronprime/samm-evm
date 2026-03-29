// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/ICrossPoolRouter.sol";
import "./interfaces/IUniswapV3.sol";

/**
 * @title UniswapSAMMAggregator
 * @notice On-chain meta-aggregator that routes swaps through whichever
 *         of SAMM's CrossPoolRouter or Uniswap V3 offers the better price.
 * @dev Deployed on Ethereum Sepolia for the Uniswap Foundation prize track.
 *      Uniswap V3 SwapRouter (Sepolia): 0xE592427A0AEce92De3Edee1F18E0157C05861564
 */
contract UniswapSAMMAggregator is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    ICrossPoolRouter public sammRouter;
    ISwapRouter public uniswapRouter;
    IQuoterV2 public uniswapQuoter;

    /// @notice Slippage tolerance in basis points (default 50 = 0.5%)
    uint256 public slippageBps;
    uint256 public constant MAX_SLIPPAGE_BPS = 1000; // 10%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Default Uniswap V3 fee tier to try when quoting
    uint24 public defaultFeeTier = 3000; // 0.3%

    // ============ Events ============

    event AggregatedSwap(
        address indexed user,
        string source,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    event SlippageUpdated(uint256 oldBps, uint256 newBps);
    event SAMMRouterUpdated(address oldRouter, address newRouter);
    event UniswapRouterUpdated(address oldRouter, address newRouter);
    event UniswapQuoterUpdated(address oldQuoter, address newQuoter);
    event DefaultFeeTierUpdated(uint24 oldFee, uint24 newFee);

    // ============ Errors ============

    error ZeroAddress();
    error InvalidSlippage(uint256 provided, uint256 max);
    error NoRouteAvailable();
    error DeadlineExceeded();

    // ============ Constructor ============

    /**
     * @param _sammRouter   Address of SAMM CrossPoolRouter
     * @param _uniswapRouter Address of Uniswap V3 SwapRouter
     * @param _uniswapQuoter Address of Uniswap V3 QuoterV2
     * @param _slippageBps  Initial slippage tolerance in bps
     */
    constructor(
        address _sammRouter,
        address _uniswapRouter,
        address _uniswapQuoter,
        uint256 _slippageBps
    ) Ownable(msg.sender) {
        if (_sammRouter == address(0) || _uniswapRouter == address(0) || _uniswapQuoter == address(0))
            revert ZeroAddress();
        if (_slippageBps > MAX_SLIPPAGE_BPS)
            revert InvalidSlippage(_slippageBps, MAX_SLIPPAGE_BPS);

        sammRouter = ICrossPoolRouter(_sammRouter);
        uniswapRouter = ISwapRouter(_uniswapRouter);
        uniswapQuoter = IQuoterV2(_uniswapQuoter);
        slippageBps = _slippageBps;
    }

    // ============ Core Function ============

    /**
     * @notice Execute a swap getting the best price from SAMM or Uniswap V3.
     * @param tokenIn    Address of the input token
     * @param tokenOut   Address of the output token
     * @param amountOut  Exact output amount desired
     * @param maxAmountIn Maximum input amount (slippage cap)
     * @param deadline   Transaction deadline timestamp
     * @param feeTier    Uniswap V3 fee tier to use (0 = use default)
     * @return amountIn  Actual input amount used
     */
    function aggregatedSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        uint256 deadline,
        uint24 feeTier
    ) external nonReentrant whenNotPaused returns (uint256 amountIn) {
        if (block.timestamp > deadline) revert DeadlineExceeded();

        uint24 fee = feeTier == 0 ? defaultFeeTier : feeTier;

        // Quote both sources
        uint256 sammQuote = _quoteSAMM(tokenIn, tokenOut, amountOut);
        uint256 uniQuote = _quoteUniswap(tokenIn, tokenOut, amountOut, fee);

        // Determine which source is cheaper (lower amountIn = better)
        bool useSAMM = _chooseSAMM(sammQuote, uniQuote);
        uint256 effectiveMax = maxAmountIn == 0 ? type(uint256).max : maxAmountIn;

        if (useSAMM && sammQuote != type(uint256).max) {
            amountIn = _executeSAMM(tokenIn, tokenOut, amountOut, effectiveMax, deadline);
            emit AggregatedSwap(msg.sender, "SAMM", tokenIn, tokenOut, amountIn, amountOut);
        } else if (!useSAMM && uniQuote != type(uint256).max) {
            amountIn = _executeUniswap(tokenIn, tokenOut, amountOut, effectiveMax, deadline, fee);
            emit AggregatedSwap(msg.sender, "Uniswap", tokenIn, tokenOut, amountIn, amountOut);
        } else {
            revert NoRouteAvailable();
        }
    }

    /**
     * @notice Get quotes from both sources without executing.
     * @return sammAmountIn  Amount SAMM would require (type(uint256).max if unavailable)
     * @return uniAmountIn   Amount Uniswap would require (type(uint256).max if unavailable)
     */
    function getQuotes(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint24 feeTier
    ) external returns (uint256 sammAmountIn, uint256 uniAmountIn) {
        uint24 fee = feeTier == 0 ? defaultFeeTier : feeTier;
        sammAmountIn = _quoteSAMM(tokenIn, tokenOut, amountOut);
        uniAmountIn = _quoteUniswap(tokenIn, tokenOut, amountOut, fee);
    }

    // ============ Internal Helpers ============

    function _quoteSAMM(
        address tokenIn,
        address tokenOut,
        uint256 amountOut
    ) internal view returns (uint256) {
        try sammRouter.quoteSwap(_buildSingleHop(tokenIn, tokenOut, amountOut)) returns (
            ICrossPoolRouter.QuoteResult memory result
        ) {
            return result.expectedAmountIn;
        } catch {
            return type(uint256).max;
        }
    }

    function _quoteUniswap(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint24 fee
    ) internal returns (uint256) {
        try
            uniswapQuoter.quoteExactOutputSingle(
                IQuoterV2.QuoteExactOutputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    amount: amountOut,
                    fee: fee,
                    sqrtPriceLimitX96: 0
                })
            )
        returns (uint256 amountIn, uint160, uint32, uint256) {
            return amountIn;
        } catch {
            return type(uint256).max;
        }
    }

    function _chooseSAMM(uint256 sammQuote, uint256 uniQuote) internal pure returns (bool) {
        if (sammQuote == type(uint256).max && uniQuote == type(uint256).max) return false;
        if (sammQuote == type(uint256).max) return false;
        if (uniQuote == type(uint256).max) return true;
        return sammQuote <= uniQuote;
    }

    function _executeSAMM(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        uint256 deadline
    ) internal returns (uint256) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), maxAmountIn);
        IERC20(tokenIn).forceApprove(address(sammRouter), maxAmountIn);

        ICrossPoolRouter.SwapPath memory path = ICrossPoolRouter.SwapPath({
            hops: _buildSingleHop(tokenIn, tokenOut, amountOut),
            maxAmountIn: maxAmountIn,
            deadline: deadline,
            recipient: msg.sender
        });

        ICrossPoolRouter.SwapResult memory result = sammRouter.swapExactOutput(path);

        // Refund any unused tokenIn
        uint256 unused = maxAmountIn - result.totalAmountIn;
        if (unused > 0) {
            IERC20(tokenIn).safeTransfer(msg.sender, unused);
        }

        return result.totalAmountIn;
    }

    function _executeUniswap(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        uint256 deadline,
        uint24 fee
    ) internal returns (uint256) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), maxAmountIn);
        IERC20(tokenIn).forceApprove(address(uniswapRouter), maxAmountIn);

        uint256 amountIn = uniswapRouter.exactOutputSingle(
            ISwapRouter.ExactOutputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: msg.sender,
                deadline: deadline,
                amountOut: amountOut,
                amountInMaximum: maxAmountIn,
                sqrtPriceLimitX96: 0
            })
        );

        // Refund unused
        uint256 unused = maxAmountIn - amountIn;
        if (unused > 0) {
            IERC20(tokenIn).safeTransfer(msg.sender, unused);
        }

        return amountIn;
    }

    function _buildSingleHop(
        address tokenIn,
        address tokenOut,
        uint256 amountOut
    ) internal pure returns (ICrossPoolRouter.SwapHop[] memory hops) {
        hops = new ICrossPoolRouter.SwapHop[](1);
        hops[0] = ICrossPoolRouter.SwapHop({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountOut: amountOut
        });
    }

    // ============ Admin Functions ============

    function setSlippageBps(uint256 _slippageBps) external onlyOwner {
        if (_slippageBps > MAX_SLIPPAGE_BPS)
            revert InvalidSlippage(_slippageBps, MAX_SLIPPAGE_BPS);
        emit SlippageUpdated(slippageBps, _slippageBps);
        slippageBps = _slippageBps;
    }

    function setSAMMRouter(address _sammRouter) external onlyOwner {
        if (_sammRouter == address(0)) revert ZeroAddress();
        emit SAMMRouterUpdated(address(sammRouter), _sammRouter);
        sammRouter = ICrossPoolRouter(_sammRouter);
    }

    function setUniswapRouter(address _uniswapRouter) external onlyOwner {
        if (_uniswapRouter == address(0)) revert ZeroAddress();
        emit UniswapRouterUpdated(address(uniswapRouter), _uniswapRouter);
        uniswapRouter = ISwapRouter(_uniswapRouter);
    }

    function setUniswapQuoter(address _uniswapQuoter) external onlyOwner {
        if (_uniswapQuoter == address(0)) revert ZeroAddress();
        emit UniswapQuoterUpdated(address(uniswapQuoter), _uniswapQuoter);
        uniswapQuoter = IQuoterV2(_uniswapQuoter);
    }

    function setDefaultFeeTier(uint24 _feeTier) external onlyOwner {
        emit DefaultFeeTierUpdated(defaultFeeTier, _feeTier);
        defaultFeeTier = _feeTier;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Rescue tokens accidentally sent to this contract
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
