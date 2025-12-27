# SAMM - Sharded Automated Market Maker

A novel decentralized exchange protocol implementing **sharded liquidity pools** with dynamic fee optimization based on the SAMM research paper.

## What is SAMM?

SAMM (Sharded Automated Market Maker) is an innovative AMM design that solves the liquidity fragmentation problem by:

1. **Sharding liquidity** - Instead of one large pool per token pair, SAMM creates multiple smaller "shards" with different liquidity levels
2. **Dynamic fee optimization** - Fees adjust based on trade size relative to pool reserves using the formula: `fee = max(rmin, β1 × (OA/RA) + rmax)`
3. **Optimal shard selection** - The router automatically selects the smallest shard that can handle your trade, giving you the best rates

### The "c-smaller-better" Property

The key insight from the SAMM research paper: **smaller pools give better rates for smaller trades**.

When you swap on SAMM:
- The router queries all available shards for your token pair
- It selects the **smallest shard** where your trade satisfies `OA/RA ≤ c` (the c-threshold)
- Smaller shards = lower fees = better rates for appropriately-sized trades

This is the opposite of traditional AMMs where everyone competes in one large pool!

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CrossPoolRouter                          │
│  • Multi-hop swap execution                                  │
│  • Automatic shard selection (smallest valid shard)          │
│  • Slippage protection & deadline validation                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    SAMMPoolFactory                           │
│  • Creates and tracks pool shards                            │
│  • Manages shard lifecycle (create, initialize, deactivate)  │
│  • Provides shard discovery for routing                      │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
     ┌───────────┐     ┌───────────┐     ┌───────────┐
     │ SAMMPool  │     │ SAMMPool  │     │ SAMMPool  │
     │ (Small)   │     │ (Medium)  │     │ (Large)   │
     │ $50K TVL  │     │ $250K TVL │     │ $1M TVL   │
     └───────────┘     └───────────┘     └───────────┘
         WETH-USDC Shards (example)
```

## Deployed Contracts (Rise Testnet)

**Network:** Rise Testnet (Chain ID: 11155931)

### Core Contracts

| Contract | Address |
|----------|---------|
| SAMMPoolFactory | `0xA74a8271C02237083c53eEE4153C07252F3925a3` |
| CrossPoolRouter | `0x8a4ED210afE6Ed5B374CFEcBA2A5aD283FAB2fDa` |
| TokenFaucet | `0x983A8fe1408bBba8a1EF02641E5ECD05b9a4BA1c` |

### Tokens

| Token | Address | Decimals |
|-------|---------|----------|
| WBTC | `0xD08FB4eB0E146aA02a6590221E7d74f4fc1Ce6a3` | 8 |
| WETH | `0x489A4BD9a9698e9B0755D1741DD254C90afbA594` | 18 |
| USDC | `0x3FfDe07200eE114f0b173505735563bd93D7814f` | 6 |
| USDT | `0x23dd84CBc68474BA537d76e11D29239a2CB9754F` | 6 |
| DAI | `0xfF9F562e690c86818a84242b38E23820c3caE20c` | 18 |
| LINK | `0x2C171917A571812FAa3cFd945467f99f700BCBdB` | 18 |
| UNI | `0xf3D5C03C1437fb927d183Fe1FfCB8325b1cc1598` | 18 |
| AAVE | `0xad4bA4E0Ca3090946eEC92b4FB570503Fab890f9` | 18 |

### Liquidity Pools

33 shards deployed across 12 token pairs with **$13.875M total TVL**:

- **Major pairs:** WETH-USDC, WBTC-USDC, WETH-WBTC (3 shards each)
- **Stablecoin pairs:** USDC-USDT, USDC-DAI, USDT-DAI (3 shards each)
- **DeFi pairs:** LINK-USDC, UNI-USDC, AAVE-USDC (3 shards each)
- **Cross pairs:** WETH-LINK, WETH-UNI, WETH-AAVE (2 shards each)

## Getting Started

### Prerequisites

- Node.js v18+
- npm or yarn

### Installation

```bash
git clone <repo-url>
cd samm-v2
npm install
```

### Configuration

Create a `.env` file:

```env
PRIVATE_KEY=your_private_key
RISECHAIN_RPC_URL=https://testnet.riselabs.xyz
```

### Compile Contracts

```bash
npx hardhat compile
```

### Run Tests

```bash
# Run all tests
npx hardhat test

# Run specific test file
npx hardhat test test/CrossPoolRouter.integration.test.js
```

### Deploy

```bash
# Deploy full production setup (tokens, factory, router, pools)
npx hardhat run scripts/deploy-production-risechain.js --network risechain

# Deploy faucet only
npx hardhat run scripts/deploy-faucet-risechain.js --network risechain
```

## Usage

### Get Test Tokens

Call `requestTokens()` on the Faucet contract to receive:
- 1 WBTC (~$100,000)
- 10 WETH (~$35,000)
- 10,000 USDC
- 10,000 USDT
- 10,000 DAI
- 500 LINK (~$7,500)
- 1,000 UNI (~$8,000)
- 50 AAVE (~$9,000)

```solidity
// Get tokens for yourself
faucet.requestTokens();

// Get tokens for any address
faucet.requestTokensFor(recipientAddress);
```

### Execute a Swap

```solidity
// Approve router to spend your tokens
IERC20(tokenIn).approve(routerAddress, amount);

// Execute swap
router.swapExactOutput({
    hops: [{
        tokenIn: USDC_ADDRESS,
        tokenOut: DAI_ADDRESS,
        amountOut: 100e18  // Get exactly 100 DAI
    }],
    maxAmountIn: 105e6,    // Pay at most 105 USDC
    deadline: block.timestamp + 3600,
    recipient: msg.sender
});
```

### Multi-Hop Swap

```solidity
// Swap LINK → USDC → DAI in one transaction
router.swapExactOutput({
    hops: [
        { tokenIn: LINK, tokenOut: USDC, amountOut: 50e6 },
        { tokenIn: USDC, tokenOut: DAI, amountOut: 45e18 }
    ],
    maxAmountIn: 10e18,  // Max 10 LINK
    deadline: block.timestamp + 3600,
    recipient: msg.sender
});
```

### Get a Quote

```solidity
QuoteResult memory quote = router.quoteSwap([
    SwapHop({
        tokenIn: USDC,
        tokenOut: DAI,
        amountOut: 100e18
    })
]);

// quote.expectedAmountIn - how much USDC you'll need
// quote.selectedShards[0] - which shard will be used
// quote.hopFees[0] - fee for this hop
```

## SAMM Parameters

The protocol uses these parameters from the SAMM research paper:

| Parameter | Value | Description |
|-----------|-------|-------------|
| β1 | -1.05 | Fee curve slope (negative = fees decrease with size) |
| rmin | 0.001 (0.1%) | Minimum fee rate |
| rmax | 0.012 (1.2%) | Maximum fee rate |
| c | 0.0104 | c-threshold for shard selection |

### Fee Formula

```
tradeFee = (RB/RA) × OA × max(rmin, β1 × (OA/RA) + rmax)
```

Where:
- `RA` = Input token reserve
- `RB` = Output token reserve  
- `OA` = Output amount requested

## Project Structure

```
├── contracts/
│   ├── CrossPoolRouter.sol      # Multi-hop swap router
│   ├── SAMMPool.sol             # Liquidity pool with SAMM curve
│   ├── SAMMPoolFactory.sol      # Factory for creating shards
│   ├── TokenFaucet.sol          # Test token faucet
│   ├── interfaces/              # Contract interfaces
│   ├── libraries/               # SAMM math (SAMMCurve, SAMMFees)
│   └── mocks/                   # Mock tokens for testing
├── scripts/
│   ├── deploy-production-risechain.js    # Full deployment
│   ├── deploy-faucet-risechain.js        # Faucet deployment
│   ├── deploy-crosspool-router-risechain.js
│   └── comprehensive-e2e-test-risechain.js
├── test/
│   ├── CrossPoolRouter.integration.test.js
│   ├── *.property.test.js       # Property-based tests
│   └── unit/                    # Unit tests
├── services/                    # Backend API services
├── config/                      # Chain configurations
└── deployment-data/             # Deployment artifacts
```

## Key Features

- **Atomic multi-hop swaps** - Execute complex routes in a single transaction
- **Automatic shard selection** - Router finds the optimal shard for your trade
- **Slippage protection** - Set maximum input amounts to protect against price movement
- **Deadline validation** - Transactions revert if not executed in time
- **Pausable** - Admin can pause swaps in emergencies
- **Token rescue** - Admin can recover stuck tokens

## Security

- ReentrancyGuard on all state-changing functions
- SafeERC20 for all token transfers
- Pausable for emergency stops
- Owner-only admin functions
- Comprehensive test coverage including property-based tests

## License

MIT
