# SAMM EVM Implementation

SAMM (Stableswap Automated Market Maker) - An output-based AMM with dynamic fees for EVM chains.

## Overview

This is an EVM (Solidity) implementation of SAMM, ported from the original Solana Rust implementation. SAMM differs from traditional AMMs like Uniswap by:

- **Output-based swaps**: Users specify exact output amount desired
- **Dynamic fees**: Fees adapt from 1x to 5x base rate based on trade impact
- **Better UX**: Users know exactly what they'll receive

## Architecture

```
contracts/
├── SAMMPool.sol          # Main pool contract with swap logic
├── libraries/
│   ├── SAMMCurve.sol     # Constant product curve calculations
│   └── SAMMFees.sol      # Dynamic fee calculations
├── interfaces/
│   └── ISAMMPool.sol     # Pool interface
└── mocks/
    └── MockERC20.sol     # Mock tokens for testing
```

## Key Algorithms

### Constant Product Formula
```
x * y = k
input_needed = k / (destination_reserve - output) - source_reserve
```

### Dynamic Fee Formula
```
max_fee = base_fee * 5
adaptive_component = (output * 1.2) / output_reserve

if (adaptive_component + base_fee > max_fee) {
    fee = output * base_fee * input_reserve / output_reserve
} else {
    fee = output * (max_fee - adaptive_component) * input_reserve / output_reserve
}
```

## Installation

```bash
npm install
```

## Compile Contracts

```bash
npm run compile
```

## Run Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# Offchain calculation tests
npm run test:offchain
```

## Deploy

```bash
# Local network
npm run node  # In one terminal
npm run deploy:local  # In another terminal

# Testnet
npm run deploy:testnet
```

## Usage Example

```javascript
const pool = await SAMMPool.deploy(tokenA, tokenB, baseFee);

// Swap: Get exactly 100 tokenB
// Specify maximalAmountIn for slippage protection
await pool.swapSAMM(
  100,              // amountOut - exact amount to receive
  110,              // maximalAmountIn - max willing to pay
  tokenA,           // sourceToken
  tokenB,           // destinationToken
  user.address
);
```

## Testing Services

```bash
# Start backend service
npm run service:dev
```

## License

MIT
