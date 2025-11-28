// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./libraries/SAMMCurve.sol";
import "./libraries/SAMMFees.sol";
import "./interfaces/ISAMMPool.sol";

/**
 * @title SAMMPool
 * @notice SAMM (Stableswap Automated Market Maker) Pool implementation
 * @dev Output-based AMM with dynamic fees
 *
 * Key Features:
 * - Users specify exact output amount (not input)
 * - Dynamic fees from 1x to 5x base rate
 * - Constant product curve (x * y = k)
 * - Slippage protection via maximalAmountIn
 *
 * Ported from Solana Rust implementation
 */
contract SAMMPool is ERC20, Ownable, ReentrancyGuard, ISAMMPool {
    using SafeERC20 for IERC20;
    using SAMMCurve for *;
    using SAMMFees for *;

    // Pool tokens
    address public immutable tokenA;
    address public immutable tokenB;
    
    // Token decimals
    uint8 public immutable decimalsA;
    uint8 public immutable decimalsB;

    // Reserves (stored in token's native decimals)
    uint256 private reserveA;
    uint256 private reserveB;

    // Fee parameters
    uint256 public tradeFeeNumerator;
    uint256 public tradeFeeDenominator;
    uint256 public ownerFeeNumerator;
    uint256 public ownerFeeDenominator;
    uint256 public hostFeeNumerator;
    uint256 public hostFeeDenominator;

    // SAMM parameters from research paper (scaled by 1e6)
    int256 public beta1;     // β1 parameter
    uint256 public rmin;     // rmin parameter
    uint256 public rmax;     // rmax parameter
    uint256 public c;        // c-threshold parameter

    // Fee collection
    uint256 public collectedFeesA;
    uint256 public collectedFeesB;

    // Pool state
    bool private initialized;

    // Minimum liquidity locked forever
    uint256 private constant MINIMUM_LIQUIDITY = 1000;

    constructor(
        address _tokenA,
        address _tokenB,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        require(_tokenA != address(0), "SAMMPool: zero address for tokenA");
        require(_tokenB != address(0), "SAMMPool: zero address for tokenB");
        require(_tokenA != _tokenB, "SAMMPool: identical tokens");

        tokenA = _tokenA;
        tokenB = _tokenB;
        
        // Get decimals from tokens
        decimalsA = IERC20Metadata(_tokenA).decimals();
        decimalsB = IERC20Metadata(_tokenB).decimals();
    }

    /**
     * @notice Initialize the pool with initial liquidity and SAMM parameters
     * @param _tokenA Address of token A (ignored, uses immutable)
     * @param _tokenB Address of token B (ignored, uses immutable)
     * @param _amountA Initial amount of token A
     * @param _amountB Initial amount of token B
     * @param _tradeFeeNumerator Trading fee numerator
     * @param _tradeFeeDenominator Trading fee denominator
     * @param _ownerFeeNumerator Owner fee numerator
     * @param _ownerFeeDenominator Owner fee denominator
     * @return lpTokens Amount of LP tokens minted
     */
    function initialize(
        address _tokenA,
        address _tokenB,
        uint256 _amountA,
        uint256 _amountB,
        uint256 _tradeFeeNumerator,
        uint256 _tradeFeeDenominator,
        uint256 _ownerFeeNumerator,
        uint256 _ownerFeeDenominator
    ) external override onlyOwner returns (uint256 lpTokens) {
        require(!initialized, "SAMMPool: already initialized");
        require(_amountA > 0 && _amountB > 0, "SAMMPool: insufficient initial liquidity");

        // Validate fees
        require(
            SAMMFees.validateFraction(_tradeFeeNumerator, _tradeFeeDenominator),
            "SAMMPool: invalid trade fee"
        );
        require(
            SAMMFees.validateFraction(_ownerFeeNumerator, _ownerFeeDenominator),
            "SAMMPool: invalid owner fee"
        );

        // Set fee parameters
        tradeFeeNumerator = _tradeFeeNumerator;
        tradeFeeDenominator = _tradeFeeDenominator;
        ownerFeeNumerator = _ownerFeeNumerator;
        ownerFeeDenominator = _ownerFeeDenominator;
        hostFeeNumerator = 0;
        hostFeeDenominator = 1;

        // Set default SAMM parameters from research paper
        beta1 = SAMMFees.BETA1_SCALED;
        rmin = SAMMFees.RMIN_SCALED;
        rmax = SAMMFees.RMAX_SCALED;
        c = SAMMFees.C_SCALED;

        // Transfer tokens
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), _amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), _amountB);

        // Calculate LP tokens (geometric mean)
        lpTokens = sqrt(_amountA * _amountB);
        require(lpTokens > MINIMUM_LIQUIDITY, "SAMMPool: insufficient liquidity minted");

        // Lock minimum liquidity (burn to dead address, not address(0))
        _mint(address(0xdead), MINIMUM_LIQUIDITY);
        _mint(msg.sender, lpTokens - MINIMUM_LIQUIDITY);

        // Update reserves
        reserveA = _amountA;
        reserveB = _amountB;

        initialized = true;

        emit PoolInitialized(tokenA, tokenB, _amountA, _amountB, lpTokens);

        return lpTokens;
    }

    /**
     * @notice Execute a SAMM swap (output-based)
     * @param amountOut Exact amount of output tokens desired
     * @param maximalAmountIn Maximum amount of input tokens willing to pay
     * @param tokenIn Address of input token
     * @param tokenOut Address of output token
     * @param recipient Address to receive output tokens
     * @return amountIn Actual amount of input tokens used
     *
     * @dev Core SAMM function - user specifies output, contract calculates input + fees
     * Ported from processor.rs:process_swap_samm and base.rs:swap_samm
     */
    function swapSAMM(
        uint256 amountOut,
        uint256 maximalAmountIn,
        address tokenIn,
        address tokenOut,
        address recipient
    ) external override nonReentrant returns (uint256 amountIn) {
        require(initialized, "SAMMPool: not initialized");
        require(amountOut > 0, "SAMMPool: zero output amount");
        require(recipient != address(0), "SAMMPool: zero recipient");
        require(
            (tokenIn == tokenA && tokenOut == tokenB) || (tokenIn == tokenB && tokenOut == tokenA),
            "SAMMPool: invalid token pair"
        );

        // Get current reserves and decimals
        bool isAtoB = tokenIn == tokenA;
        uint256 inputReserve;
        uint256 outputReserve;
        uint8 inputDecimals;
        uint8 outputDecimals;
        
        if (isAtoB) {
            inputReserve = reserveA;
            outputReserve = reserveB;
            inputDecimals = decimalsA;
            outputDecimals = decimalsB;
        } else {
            inputReserve = reserveB;
            outputReserve = reserveA;
            inputDecimals = decimalsB;
            outputDecimals = decimalsA;
        }

        require(amountOut < outputReserve, "SAMMPool: insufficient liquidity");

        // Validate c-threshold for SAMM properties (using normalized values)
        require(
            SAMMFees.validateCThreshold(
                _normalize(amountOut, outputDecimals),
                _normalize(inputReserve, inputDecimals),
                c
            ),
            "SAMMPool: exceeds c-threshold"
        );

        // Calculate swap using SAMM algorithm
        SwapResult memory result = _calculateSwapSAMM(amountOut, inputReserve, outputReserve, inputDecimals, outputDecimals);

        // Check slippage protection
        require(result.amountIn <= maximalAmountIn, "SAMMPool: excessive input amount");

        // Update reserves
        if (isAtoB) {
            reserveA = inputReserve + result.amountIn;
            reserveB = outputReserve - amountOut;
            collectedFeesA += result.tradeFee + result.ownerFee;
        } else {
            reserveB = inputReserve + result.amountIn;
            reserveA = outputReserve - amountOut;
            collectedFeesB += result.tradeFee + result.ownerFee;
        }

        // Execute transfers
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), result.amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);

        emit SwapSAMM(msg.sender, tokenIn, tokenOut, result.amountIn, amountOut, result.tradeFee);

        return result.amountIn;
    }

    /**
     * @notice Add liquidity to the pool
     * @param amountADesired Desired amount of token A
     * @param amountBDesired Desired amount of token B
     * @param amountAMin Minimum amount of token A
     * @param amountBMin Minimum amount of token B
     * @param to Address to receive LP tokens
     * @return amountA Actual amount of token A added
     * @return amountB Actual amount of token B added
     * @return liquidity Amount of LP tokens minted
     */
    function addLiquidity(
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to
    ) external override nonReentrant returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        require(initialized, "SAMMPool: not initialized");

        // Calculate optimal amounts
        (amountA, amountB) = _calculateOptimalAmounts(
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin
        );

        // Transfer tokens
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);

        // Mint LP tokens
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            liquidity = sqrt(amountA * amountB) - MINIMUM_LIQUIDITY;
            _mint(address(0), MINIMUM_LIQUIDITY);
        } else {
            liquidity = min(
                (amountA * _totalSupply) / reserveA,
                (amountB * _totalSupply) / reserveB
            );
        }

        require(liquidity > 0, "SAMMPool: insufficient liquidity minted");
        _mint(to, liquidity);

        // Update reserves
        reserveA += amountA;
        reserveB += amountB;

        emit LiquidityAdded(to, amountA, amountB, liquidity);

        return (amountA, amountB, liquidity);
    }

    /**
     * @notice Remove liquidity from the pool
     * @param liquidity Amount of LP tokens to burn
     * @param amountAMin Minimum amount of token A to receive
     * @param amountBMin Minimum amount of token B to receive
     * @param to Address to receive tokens
     * @return amountA Amount of token A received
     * @return amountB Amount of token B received
     */
    function removeLiquidity(
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to
    ) external override nonReentrant returns (uint256 amountA, uint256 amountB) {
        require(initialized, "SAMMPool: not initialized");
        require(liquidity > 0, "SAMMPool: zero liquidity");

        uint256 _totalSupply = totalSupply();

        // Calculate amounts using balance * liquidity / totalSupply
        amountA = (liquidity * reserveA) / _totalSupply;
        amountB = (liquidity * reserveB) / _totalSupply;

        require(amountA >= amountAMin, "SAMMPool: insufficient A amount");
        require(amountB >= amountBMin, "SAMMPool: insufficient B amount");

        // Burn LP tokens
        _burn(msg.sender, liquidity);

        // Transfer tokens
        IERC20(tokenA).safeTransfer(to, amountA);
        IERC20(tokenB).safeTransfer(to, amountB);

        // Update reserves
        reserveA -= amountA;
        reserveB -= amountB;

        emit LiquidityRemoved(to, amountA, amountB, liquidity);

        return (amountA, amountB);
    }

    /**
     * @notice Calculate SAMM swap result without executing
     * @param amountOut Desired output amount (in output token's decimals)
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @return result SwapResult struct with calculated amounts (in respective token decimals)
     */
    function calculateSwapSAMM(
        uint256 amountOut,
        address tokenIn,
        address tokenOut
    ) external view override returns (SwapResult memory result) {
        require(
            (tokenIn == tokenA && tokenOut == tokenB) || (tokenIn == tokenB && tokenOut == tokenA),
            "SAMMPool: invalid token pair"
        );

        bool isAtoB = tokenIn == tokenA;
        (uint256 inputReserve, uint256 outputReserve) = isAtoB
            ? (reserveA, reserveB)
            : (reserveB, reserveA);
        
        (uint8 inputDecimals, uint8 outputDecimals) = isAtoB
            ? (decimalsA, decimalsB)
            : (decimalsB, decimalsA);

        return _calculateSwapSAMM(amountOut, inputReserve, outputReserve, inputDecimals, outputDecimals);
    }

    /**
     * @notice Get current reserves
     * @return _reserveA Reserve of token A
     * @return _reserveB Reserve of token B
     */
    function getReserves() external view override returns (uint256 _reserveA, uint256 _reserveB) {
        return (reserveA, reserveB);
    }

    /**
     * @notice Get complete pool state
     * @return state PoolState struct
     */
    function getPoolState() external view override returns (PoolState memory state) {
        return PoolState({
            tokenA: tokenA,
            tokenB: tokenB,
            reserveA: reserveA,
            reserveB: reserveB,
            totalSupply: totalSupply(),
            tradeFeeNumerator: tradeFeeNumerator,
            tradeFeeDenominator: tradeFeeDenominator,
            ownerFeeNumerator: ownerFeeNumerator,
            ownerFeeDenominator: ownerFeeDenominator
        });
    }

    /**
     * @notice Quote amount B for amount A
     * @param amountA Amount of token A
     * @param _reserveA Reserve of token A
     * @param _reserveB Reserve of token B
     * @return amountB Equivalent amount of token B
     */
    function quote(
        uint256 amountA,
        uint256 _reserveA,
        uint256 _reserveB
    ) external pure override returns (uint256 amountB) {
        require(amountA > 0, "SAMMPool: insufficient amount");
        require(_reserveA > 0 && _reserveB > 0, "SAMMPool: insufficient liquidity");
        amountB = (amountA * _reserveB) / _reserveA;
    }

    /**
     * @notice Update fee parameters
     * @param _tradeFeeNumerator New trade fee numerator
     * @param _tradeFeeDenominator New trade fee denominator
     * @param _ownerFeeNumerator New owner fee numerator
     * @param _ownerFeeDenominator New owner fee denominator
     */
    function updateFees(
        uint256 _tradeFeeNumerator,
        uint256 _tradeFeeDenominator,
        uint256 _ownerFeeNumerator,
        uint256 _ownerFeeDenominator
    ) external onlyOwner {
        require(
            SAMMFees.validateFraction(_tradeFeeNumerator, _tradeFeeDenominator),
            "SAMMPool: invalid trade fee"
        );
        require(
            SAMMFees.validateFraction(_ownerFeeNumerator, _ownerFeeDenominator),
            "SAMMPool: invalid owner fee"
        );

        tradeFeeNumerator = _tradeFeeNumerator;
        tradeFeeDenominator = _tradeFeeDenominator;
        ownerFeeNumerator = _ownerFeeNumerator;
        ownerFeeDenominator = _ownerFeeDenominator;

        emit FeesUpdated(
            _tradeFeeNumerator,
            _tradeFeeDenominator,
            _ownerFeeNumerator,
            _ownerFeeDenominator
        );
    }

    /**
     * @notice Update SAMM parameters
     * @param _beta1 New β1 parameter (scaled by 1e6)
     * @param _rmin New rmin parameter (scaled by 1e6)
     * @param _rmax New rmax parameter (scaled by 1e6)
     * @param _c New c-threshold parameter (scaled by 1e6)
     */
    function updateSAMMParams(
        int256 _beta1,
        uint256 _rmin,
        uint256 _rmax,
        uint256 _c
    ) external onlyOwner {
        require(_beta1 < 0, "SAMMPool: beta1 must be negative");
        require(_rmin > 0, "SAMMPool: rmin must be positive");
        require(_rmax > _rmin, "SAMMPool: rmax must be greater than rmin");
        require(_c > 0, "SAMMPool: c must be positive");

        beta1 = _beta1;
        rmin = _rmin;
        rmax = _rmax;
        c = _c;

        emit SAMMParamsUpdated(_beta1, _rmin, _rmax, _c);
    }

    /**
     * @notice Get SAMM parameters
     * @return _beta1 β1 parameter
     * @return _rmin rmin parameter
     * @return _rmax rmax parameter
     * @return _c c-threshold parameter
     */
    function getSAMMParams() external view returns (int256 _beta1, uint256 _rmin, uint256 _rmax, uint256 _c) {
        return (beta1, rmin, rmax, c);
    }

    /**
     * @notice Withdraw collected fees
     * @param to Address to receive fees
     */
    function withdrawFees(address to) external onlyOwner {
        require(to != address(0), "SAMMPool: zero address");

        if (collectedFeesA > 0) {
            uint256 fees = collectedFeesA;
            collectedFeesA = 0;
            IERC20(tokenA).safeTransfer(to, fees);
        }

        if (collectedFeesB > 0) {
            uint256 fees = collectedFeesB;
            collectedFeesB = 0;
            IERC20(tokenB).safeTransfer(to, fees);
        }
    }

    // Internal functions

    /**
     * @dev Normalize amount to 18 decimals for calculations
     * @param amount Amount in token's native decimals
     * @param tokenDecimals Token's decimal places
     * @return Normalized amount (18 decimals)
     */
    function _normalize(uint256 amount, uint8 tokenDecimals) private pure returns (uint256) {
        if (tokenDecimals == 18) {
            return amount;
        } else if (tokenDecimals < 18) {
            return amount * (10 ** (18 - tokenDecimals));
        } else {
            return amount / (10 ** (tokenDecimals - 18));
        }
    }

    /**
     * @dev Denormalize amount from 18 decimals back to token's native decimals
     * @param amount Amount in 18 decimals
     * @param tokenDecimals Token's decimal places
     * @return Denormalized amount (token's native decimals)
     */
    function _denormalize(uint256 amount, uint8 tokenDecimals) private pure returns (uint256) {
        if (tokenDecimals == 18) {
            return amount;
        } else if (tokenDecimals < 18) {
            return amount / (10 ** (18 - tokenDecimals));
        } else {
            return amount * (10 ** (tokenDecimals - 18));
        }
    }

    /**
     * @dev Calculate SAMM swap internally using research paper formula
     * Implements: tf_SAMM(RA,RB,OA) = (RB/RA) × OA × max{rmin, β1×(OA/RA) + rmax}
     * 
     * NOTE: All calculations are done in normalized 18-decimal space to handle
     * tokens with different decimal places correctly.
     * 
     * @param amountOut Desired output amount (in output token's native decimals)
     * @param inputReserve Input token reserve (in input token's native decimals)
     * @param outputReserve Output token reserve (in output token's native decimals)
     * @param inputDecimals Input token's decimal places
     * @param outputDecimals Output token's decimal places
     * @return SwapResult with amounts in respective token's native decimals
     */
    function _calculateSwapSAMM(
        uint256 amountOut,
        uint256 inputReserve,
        uint256 outputReserve,
        uint8 inputDecimals,
        uint8 outputDecimals
    ) private view returns (SwapResult memory) {
        // Normalize all amounts to 18 decimals for calculations
        uint256 amountOutNorm = _normalize(amountOut, outputDecimals);
        uint256 inputReserveNorm = _normalize(inputReserve, inputDecimals);
        uint256 outputReserveNorm = _normalize(outputReserve, outputDecimals);

        // Calculate trade fee using SAMM research paper formula (in normalized space)
        uint256 tradeFeeNorm = SAMMFees.calculateFeeSAMM(
            amountOutNorm,
            outputReserveNorm,
            inputReserveNorm,
            beta1,
            rmin,
            rmax
        );

        // Calculate owner fee (traditional percentage) (in normalized space)
        uint256 ownerFeeNorm = SAMMFees.ownerTradingFee(
            amountOutNorm,
            ownerFeeNumerator,
            ownerFeeDenominator
        );

        // Calculate input amount needed (without fees) using constant product (in normalized space)
        (uint256 sourceAmountSwappedNorm, ) = SAMMCurve.swapRevert(
            amountOutNorm,
            inputReserveNorm,
            outputReserveNorm
        );

        // Total input = base amount + fees (in normalized space)
        uint256 totalAmountInNorm = sourceAmountSwappedNorm + tradeFeeNorm + ownerFeeNorm;

        // Denormalize back to token's native decimals
        uint256 totalAmountIn = _denormalize(totalAmountInNorm, inputDecimals);
        uint256 tradeFee = _denormalize(tradeFeeNorm, inputDecimals);
        uint256 ownerFee = _denormalize(ownerFeeNorm, inputDecimals);

        return SwapResult({
            amountIn: totalAmountIn,
            amountOut: amountOut,
            tradeFee: tradeFee,
            ownerFee: ownerFee
        });
    }

    function _calculateOptimalAmounts(
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) private view returns (uint256 amountA, uint256 amountB) {
        if (reserveA == 0 && reserveB == 0) {
            return (amountADesired, amountBDesired);
        }

        uint256 amountBOptimal = (amountADesired * reserveB) / reserveA;
        if (amountBOptimal <= amountBDesired) {
            require(amountBOptimal >= amountBMin, "SAMMPool: insufficient B amount");
            return (amountADesired, amountBOptimal);
        } else {
            uint256 amountAOptimal = (amountBDesired * reserveA) / reserveB;
            require(amountAOptimal <= amountADesired, "SAMMPool: excessive A amount");
            require(amountAOptimal >= amountAMin, "SAMMPool: insufficient A amount");
            return (amountAOptimal, amountBDesired);
        }
    }

    function sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function min(uint256 x, uint256 y) private pure returns (uint256) {
        return x < y ? x : y;
    }
}
