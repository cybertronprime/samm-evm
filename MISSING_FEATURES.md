# SAMM EVM Implementation Status

## ✅ COMPLETED ENHANCEMENTS

After thorough review and enhancement, **the implementation now includes critical SAMM features** from the research paper.

### ✅ IMPLEMENTED: Research Paper SAMM Fee Formula

**Status:** ✅ **COMPLETED**

The Solidity implementation now correctly implements the bounded-ratio polynomial fee function from the SAMM research paper:

**Formula:** `tf_SAMM(RA,RB,OA) = (RB/RA) × OA × max{rmin, β1×(OA/RA) + rmax}`

**Parameters:**
- β1 = -1.05 (slope parameter)
- rmin = 0.001 (minimum fee rate)
- rmax = 0.012 (maximum fee rate)
- c = 0.0104 (c-threshold for SAMM properties)

**Implementation:** `contracts/libraries/SAMMFees.sol:calculateFeeSAMM()`

### ✅ IMPLEMENTED: Multi-Shard Support

**Status:** ✅ **COMPLETED**

Added comprehensive multi-shard support through factory pattern:

**New Contracts:**
- `SAMMPoolFactory.sol` - Creates and manages multiple shards for token pairs
- `ISAMMPoolFactory.sol` - Factory interface with shard management

**Features:**
- Create multiple shards for same token pair
- Track all shards for routing and discovery
- Enforce SAMM parameters consistency
- Support shard-specific configurations

### ✅ IMPLEMENTED: C-Threshold Validation

**Status:** ✅ **COMPLETED**

Added c-threshold validation to maintain SAMM properties:

**Implementation:**
- `SAMMFees.validateCThreshold()` - Validates OA/RA ≤ c
- Integrated into swap execution to enforce c-non-splitting property
- Prevents trades that would violate SAMM theoretical guarantees

### ✅ IMPLEMENTED: SAMM Parameter Management

**Status:** ✅ **COMPLETED**

Added full support for SAMM research paper parameters:

**New Functions:**
- `updateSAMMParams()` - Update β1, rmin, rmax, c parameters
- `getSAMMParams()` - Query current SAMM parameters
- Parameter validation with proper constraints

**Events:**
- `SAMMParamsUpdated` - Emitted when parameters change

## ⚠️ REMAINING ISSUES

---

## 🔴 CRITICAL: LP Token Minting for Owner Fees (MISSING)

### Issue
The Solidity implementation **does not mint LP tokens** to represent collected owner fees. This is a fundamental feature of the SAMM tokenomics model.

### Rust Implementation
**Location:** `token-swap/program/src/processor.rs:795-850` (regular swap) and lines 546-601 (SAMM swap)

```rust
if result.owner_fee > 0 {
    // Calculate equivalent LP tokens for the collected fee
    let mut pool_token_amount = token_swap
        .swap_curve()
        .calculator
        .withdraw_single_token_type_exact_out(
            result.owner_fee,              // Fee collected
            swap_token_a_amount,           // Reserve A after swap
            swap_token_b_amount,           // Reserve B after swap
            u128::from(pool_mint.supply),  // Total LP supply
            trade_direction,
            RoundDirection::Floor,
        )
        .ok_or(SwapError::FeeCalculationFailure)?;

    // Calculate and mint host fee (if host account provided)
    if let Ok(host_fee_account_info) = next_account_info(account_info_iter) {
        let host_fee = token_swap.fees().host_fee(pool_token_amount)?;
        if host_fee > 0 {
            pool_token_amount = pool_token_amount.checked_sub(host_fee)?;
            // Mint host_fee LP tokens to host account
            Self::token_mint_to(/* ... mint host_fee to host ... */)?;
        }
    }

    // Mint remaining LP tokens to pool fee account
    Self::token_mint_to(
        /* ... mint pool_token_amount to pool fee account ... */
    )?;
}
```

### Current Solidity Implementation
**Location:** `contracts/SAMMPool.sol:177-186`

```solidity
if (tokenIn == tokenA) {
    reserveA = inputReserve + result.amountIn;
    reserveB = outputReserve - amountOut;
    collectedFeesA += result.tradeFee + result.ownerFee;  // ❌ Only tracking, not minting!
} else {
    reserveA = outputReserve - amountOut;
    reserveB = inputReserve + result.amountIn;
    collectedFeesB += result.tradeFee + result.ownerFee;  // ❌ Only tracking, not minting!
}
```

**Status:** ❌ **COMPLETELY MISSING**

### Algorithm Required

The Balancer single-asset withdrawal formula (used for LP token calculation):

```
ratio = fee_amount / reserve
base = 1 - ratio
root = 1 - sqrt(base)
lp_tokens = total_supply * root
```

**Source:** `constant_product.rs:156-182`

### Impact
- **High:** Affects tokenomics and fee distribution model
- Pool fee account does not accumulate LP tokens representing collected fees
- Host accounts cannot receive their share of fees
- Protocol revenue mechanism is non-functional

---

## 🟠 HIGH: Host Fee Distribution (MISSING)

### Issue
Host fee mechanism allows frontend hosts to earn a share of owner fees. This is a critical feature for protocol adoption and frontend integration.

### Rust Implementation
**Location:** `curve/fees.rs:204-212`

```rust
/// Calculate the host fee based on the owner fee
pub fn host_fee(&self, owner_fee: u128) -> Option<u128> {
    calculate_fee(
        owner_fee,
        u128::from(self.host_fee_numerator),
        u128::from(self.host_fee_denominator),
    )
}
```

### Current Solidity Implementation
```solidity
// State variables exist but no implementation:
uint256 public hostFeeNumerator;
uint256 public hostFeeDenominator;
// ❌ No host fee calculation
// ❌ No host account parameter in swap functions
// ❌ No LP token minting to host
```

**Status:** ❌ **NOT IMPLEMENTED**

### Requirements
1. Add optional `hostFeeAccount` parameter to swap functions
2. Calculate host fee as percentage of owner fee LP tokens
3. Mint host fee LP tokens to host account
4. Mint remaining LP tokens to pool fee account
5. Emit events for host fee distribution

### Impact
- **High:** Frontend hosts cannot earn fees
- Reduces protocol adoption potential
- Missing revenue sharing mechanism

---

## 🟡 MEDIUM: Transfer Fee Handling (NOT SUPPORTED)

### Issue
Rust implementation has comprehensive support for tokens with transfer fees (Solana Token-2022 extension). Solidity implementation does not account for this.

### Rust Implementation
**Location:** `processor.rs:725-770`

```rust
// Calculate inverse transfer fee for source token
let source_transfer_amount = {
    let source_amount_swapped = to_u64(result.source_amount_swapped)?;
    if let Ok(transfer_fee_config) = source_mint.get_extension::<TransferFeeConfig>() {
        source_amount_swapped.saturating_add(
            transfer_fee_config
                .calculate_inverse_epoch_fee(Clock::get()?.epoch, source_amount_swapped)
                .ok_or(SwapError::FeeCalculationFailure)?,
        )
    } else {
        source_amount_swapped
    }
};

// Calculate forward transfer fee for destination token
let destination_transfer_amount = {
    let amount_out = to_u64(result.destination_amount_swapped)?;
    let amount_received = if let Ok(transfer_fee_config) =
        destination_mint.get_extension::<TransferFeeConfig>()
    {
        amount_out.saturating_sub(
            transfer_fee_config
                .calculate_epoch_fee(Clock::get()?.epoch, amount_out)
                .ok_or(SwapError::FeeCalculationFailure)?,
        )
    } else {
        amount_out
    }
};
```

### Current Solidity Implementation
```solidity
// ❌ No transfer fee detection
// ❌ No fee-on-transfer handling
// Assumes 1:1 transfer amounts
IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), result.amountIn);
IERC20(tokenOut).safeTransfer(recipient, amountOut);
```

**Status:** ❌ **NOT IMPLEMENTED**

### Decision Required
Two options:
1. **Add support:** Implement fee-on-transfer token detection and handling
2. **Document limitation:** Explicitly state that fee-on-transfer tokens are not supported

### Impact
- **Medium:** Pool may break with fee-on-transfer tokens
- Limits token compatibility
- Could lead to reserve imbalances

---

## 🟡 MEDIUM: Initial Pool Supply Constant (UNVERIFIED)

### Issue
Initial LP token calculation may not match Rust implementation.

### Rust Implementation
**Location:** `calculator.rs:11`

```rust
/// Initial amount of pool tokens for swap contract
pub const INITIAL_SWAP_POOL_AMOUNT: u128 = 1_000_000_000;
```

### Current Solidity Implementation
**Location:** `SAMMPool.sol:113-125`

```solidity
function _mintInitialLiquidity(uint256 amountA, uint256 amountB)
    private
    returns (uint256 liquidity)
{
    // Uniswap-style geometric mean: sqrt(amountA * amountB)
    liquidity = Math.sqrt(amountA * amountB);
    require(liquidity > MINIMUM_LIQUIDITY, "SAMMPool: insufficient initial liquidity");

    _mint(address(0xdead), MINIMUM_LIQUIDITY);
    liquidity -= MINIMUM_LIQUIDITY;

    return liquidity;
}
```

**Status:** ⚠️ **DIFFERENT APPROACH - NEEDS VERIFICATION**

The Rust implementation uses a **fixed initial supply** of 1 billion, while Solidity uses **Uniswap-style geometric mean** (sqrt(x * y)).

### Decision Required
Verify which approach is correct for SAMM, or if both are compatible.

### Impact
- **Medium:** Initial LP token amounts differ
- May affect liquidity provider incentives
- Could cause discrepancies in pool value calculations

---

## 🔵 LOW: Constraint Validation (MISSING)

### Issue
Rust implementation has a SwapConstraints system for validating pool parameters. Solidity implementation has basic validation but lacks the comprehensive constraint system.

### Rust Implementation
**Location:** `constraints.rs:35-60`

```rust
pub struct SwapConstraints {
    owner_key: String,
    valid_curve_types: &'static [CurveType],
    fees: Fees,
}

impl SwapConstraints {
    pub fn validate_fees(&self, fees: &Fees) -> ProgramResult {
        if fees.trade_fee_numerator >= self.fees.trade_fee_numerator
            && fees.trade_fee_denominator == self.fees.trade_fee_denominator
            && fees.owner_trade_fee_numerator >= self.fees.owner_trade_fee_numerator
            && fees.owner_trade_fee_denominator == self.fees.owner_trade_fee_denominator
            && fees.owner_withdraw_fee_numerator >= self.fees.owner_withdraw_fee_numerator
            && fees.owner_withdraw_fee_denominator == self.fees.owner_withdraw_fee_denominator
            && fees.host_fee_numerator == self.fees.host_fee_numerator
            && fees.host_fee_denominator == self.fees.host_fee_denominator
        {
            Ok(())
        } else {
            Err(SwapError::InvalidFee.into())
        }
    }
}
```

### Current Solidity Implementation
```solidity
// ❌ No constraint system
// ✅ Has basic validation in constructor
require(tradeFeeNumerator < tradeFeeDenominator, "Invalid trade fee");
require(ownerFeeNumerator < ownerFeeDenominator, "Invalid owner fee");
```

**Status:** ⚠️ **PARTIAL IMPLEMENTATION**

### Impact
- **Low:** Additional safety checks missing
- Could allow invalid fee configurations
- Less robust than Rust implementation

---

## 🔵 LOW: Events Missing Details

### Issue
Solidity events don't capture all information that Rust logs include.

### Current Events
```solidity
event Swap(
    address indexed sender,
    address indexed tokenIn,
    address indexed tokenOut,
    uint256 amountIn,
    uint256 amountOut,
    address recipient
);
```

### Missing Event Information
- Trade fee amount
- Owner fee amount
- Host fee amount (when implemented)
- LP tokens minted for fees (when implemented)
- Reserve states after swap

**Status:** ⚠️ **INCOMPLETE**

### Impact
- **Low:** Reduced off-chain analytics capability
- Harder to track fee collection
- Less transparency

---

## 📊 Summary Table

| Feature | Priority | Status | Rust Location | Impact |
|---------|----------|--------|---------------|--------|
| LP Token Minting for Owner Fees | 🔴 CRITICAL | ❌ Missing | processor.rs:795-850 | High - Tokenomics broken |
| Host Fee Distribution | 🟠 HIGH | ❌ Missing | fees.rs:204-212 | High - Revenue sharing broken |
| Transfer Fee Handling | 🟡 MEDIUM | ❌ Missing | processor.rs:725-770 | Medium - Token compatibility |
| Initial Pool Supply | 🟡 MEDIUM | ⚠️ Different | calculator.rs:11 | Medium - LP calculation differs |
| Constraint Validation | 🔵 LOW | ⚠️ Partial | constraints.rs:35-60 | Low - Safety checks |
| Event Details | 🔵 LOW | ⚠️ Incomplete | processor.rs | Low - Analytics |

---

## 🎯 Recommended Implementation Order

### Phase 1: Critical Fixes (Must Have)
1. **Implement LP token minting for owner fees**
   - Port `withdraw_single_token_type_exact_out` algorithm
   - Create library for Balancer single-asset withdrawal formula
   - Implement sqrt operations with sufficient precision
   - Add LP token minting in swap flow
   - Write comprehensive tests

2. **Implement host fee distribution**
   - Add optional `hostFeeAccount` parameter
   - Calculate host fee percentage
   - Mint host fee LP tokens
   - Update events

### Phase 2: Important Additions (Should Have)
3. **Transfer fee handling**
   - Research fee-on-transfer token detection
   - Implement fee calculation or document limitation
   - Add warnings in documentation

4. **Verify initial pool supply**
   - Compare approaches with Rust team
   - Standardize on one approach
   - Update tests

### Phase 3: Enhancements (Nice to Have)
5. **Add constraint validation system**
6. **Enhance events with full details**
7. **Add admin functions for fee updates**

---

## ⚠️ Current Status

**The Solidity implementation is NOT production-ready.**

While the core swap mathematics (fee calculation, swap revert, constant product) are correctly implemented, the **tokenomics and fee distribution mechanisms are incomplete**.

### What Works ✅
- SAMM dynamic fee calculation
- Swap revert (output-based swaps)
- Constant product invariant
- Basic swap execution
- Slippage protection
- ERC20 token handling

### What's Missing ❌
- LP token minting for owner fees
- Host fee distribution
- Transfer fee support
- Complete event emission
- Constraint validation system

---

**Document Created:** 2024-11-13
**Review Status:** Complete - Ready for Implementation Planning
