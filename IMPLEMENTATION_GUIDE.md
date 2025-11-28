# SAMM EVM Implementation Guide

## Overview

This is a complete EVM (Solidity) implementation of SAMM (Stableswap Automated Market Maker), ported from the original Solana Rust implementation.

## Architecture

### Core Contracts

1. **SAMMPool.sol** - Main pool contract
   - Manages liquidity pools
   - Executes SAMM swaps (output-based)
   - Handles LP token minting/burning
   - Collects and distributes fees

2. **SAMMCurve.sol** (Library) - Mathematical calculations
   - `swapRevert()` - Calculate input needed for desired output
   - Constant product formula (x * y = k)
   - LP token calculations
   - Invariant validation

3. **SAMMFees.sol** (Library) - Dynamic fee calculations
   - `calculateFeeSAMM()` - Adaptive fee from 1x to 5x base rate
   - Owner and host fee calculations
   - Fee validation

### Key Differences from Traditional AMMs

| Feature | Uniswap | SAMM |
|---------|---------|------|
| Input Type | Fixed input | Fixed output |
| Fee Model | Static (0.3%) | Dynamic (1x-5x base) |
| User Experience | "Swap X in for ~Y out" | "Get exactly Y out for ~X in" |
| Slippage Protection | `minimumAmountOut` | `maximalAmountIn` |
| Fee Calculation | Before swap | After swap calculation |

## Implementation Details

### SAMM Swap Algorithm

```solidity
// 1. User specifies exact output amount
uint256 amountOut = 1000 tokens;

// 2. Calculate dynamic fee based on trade impact
uint256 tradeFee = calculateFeeSAMM(
    amountOut,
    outputReserve,
    inputReserve,
    feeNumerator,
    feeDenominator
);

// 3. Calculate input needed (constant product)
(uint256 sourceAmountSwapped, ) = swapRevert(
    amountOut,
    inputReserve,
    outputReserve
);

// 4. Total input = base + fees
uint256 totalInput = sourceAmountSwapped + tradeFee + ownerFee;

// 5. Verify slippage protection
require(totalInput <= maximalAmountIn, "Excessive input");

// 6. Execute swap
```

### Dynamic Fee Formula

```javascript
max_fee = base_fee * 5
adaptive_component = (output * 1.2) / output_reserve

if (adaptive_component + base_fee > max_fee) {
    // Large pool or small trade -> minimal fee
    fee = output * base_fee * input_reserve / output_reserve
} else {
    // Smaller pool or larger trade -> adaptive fee
    fee = output * (max_fee - adaptive_component) * input_reserve / output_reserve
}
```

### Constant Product Calculation

```javascript
// Want specific output, calculate input needed
invariant = source_reserve * dest_reserve
new_dest = dest_reserve - output_amount
new_source = ceil(invariant / new_dest)  // Ceiling division favors pool
input_needed = new_source - source_reserve
```

## Testing Strategy

### 1. Offchain Tests (`test/offchain/`)
- Pure JavaScript mathematical validation
- Ensures formulas match Rust implementation
- Fast iteration without blockchain

```bash
npm run test:offchain
```

### 2. Solidity Unit Tests (`test/unit/`)
- Contract functionality testing
- Integration between contracts
- Edge case validation

```bash
npm run test:unit
```

### 3. Integration Tests (`test/integration/`)
- End-to-end swap flows
- Multi-user scenarios
- Gas optimization

```bash
npm run test:integration
```

## Deployment

### Local Development

```bash
# 1. Install dependencies
npm install

# 2. Start local Hardhat node
npm run node

# 3. Deploy (in another terminal)
npm run deploy:local
```

### Testnet Deployment

```bash
# 1. Configure .env
cp .env.example .env
# Edit .env with your settings

# 2. Deploy
npm run deploy:testnet
```

### Production Deployment

1. Audit all contracts
2. Set production fee parameters
3. Deploy with multisig owner
4. Initialize with deep liquidity
5. Enable monitoring

## Backend Service

The included Express.js backend provides:

- Pool state queries
- Swap quote calculations
- Price discovery
- User balance tracking
- TVL calculation

### Start Service

```bash
cd services
npm install
cp .env.example .env
# Configure contract addresses
npm run dev
```

### API Endpoints

- `GET /api/pool/info` - Pool state
- `POST /api/swap/quote` - Calculate swap
- `GET /api/price` - Get price
- `GET /api/user/:address/balances` - User balances

## Gas Optimization

### Techniques Used

1. **Immutable Variables** - `tokenA`, `tokenB`
2. **Packed Structs** - Efficient storage
3. **Libraries** - Code reuse without deployment
4. **Minimal Storage Reads** - Cache values
5. **Unchecked Math** - Where overflow impossible

### Gas Costs (Estimated)

| Operation | Gas Cost |
|-----------|----------|
| Swap | ~120k |
| Add Liquidity | ~150k |
| Remove Liquidity | ~130k |
| Initialize Pool | ~250k |

## Security Considerations

### Implemented Protections

1. **ReentrancyGuard** - Prevents reentrancy attacks
2. **SafeERC20** - Safe token transfers
3. **Slippage Protection** - `maximalAmountIn` parameter
4. **Invariant Validation** - K maintained or increased
5. **Overflow Protection** - Solidity 0.8+ built-in
6. **Access Control** - Ownable for admin functions

### Known Considerations

1. **Flash Loans** - Not protected (by design)
2. **MEV** - Users should use private mempools
3. **Impermanent Loss** - Standard AMM risk
4. **Token Compatibility** - Assumes standard ERC20

## Comparison with Rust Implementation

### Accurate Ports

✅ `swap_revert` → `SAMMCurve.swapRevert`
✅ `calculate_fee_samm` → `SAMMFees.calculateFeeSAMM`
✅ `swap_samm` → `SAMMPool.swapSAMM`
✅ Constant product formula
✅ Dynamic fee calculation
✅ Ceiling division for pool protection

### EVM Adaptations

- Solana accounts → ERC20 interfaces
- Program Derived Addresses → Contract ownership
- Solana Token Program → OpenZeppelin ERC20
- Borsh serialization → ABI encoding

## Rust vs Solidity Mapping

| Rust File | Solidity File | Function |
|-----------|---------------|----------|
| `fees.rs:47-78` | `SAMMFees.sol:34-68` | Fee calculation |
| `constant_product.rs:50-70` | `SAMMCurve.sol:22-57` | Swap revert |
| `base.rs:71-106` | `SAMMPool.sol:147-205` | SAMM swap |
| `processor.rs:382-616` | `SAMMPool.sol:147-205` | Swap execution |

## Future Enhancements

1. **Multi-hop Routing** - Swap through multiple pools
2. **Concentrated Liquidity** - Uniswap V3 style
3. **Oracle Integration** - TWAP price feeds
4. **Governance** - DAO-controlled parameters
5. **Yield Farming** - LP rewards
6. **Cross-chain** - Bridge integrations

## Support & Resources

- **Rust Reference**: `../token-swap/program/src/`
- **Tests**: Run comprehensive test suite
- **Docs**: This file + inline comments
- **Issues**: Report bugs and suggestions

## License

MIT - Same as Solana Program Library
