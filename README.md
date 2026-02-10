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

**Network:** Rise Testnet  
**RPC:** https://testnet.riselabs.xyz/http

### Core Contracts

| Contract | Address |
|----------|---------|
| SAMMPoolFactory | `0x1114cF606d700bB8490C9D399500e35a31FaE27A` |
| CrossPoolRouter | `0x622c2D2719197A047f29BCBaaaEBBDbD54b45a11` |

### Tokens

| Token | Address | Decimals | Price |
|-------|---------|----------|-------|
| WBTC | `0xEf6c9F206Ad4333Ca049C874ae6956f849e71479` | 8 | $100,000 |
| WETH | `0x0ec0b10b40832cD9805481F132f966B156d70Cc7` | 18 | $3,500 |
| USDC | `0xDA4aABea512d4030863652dbB21907B6eC97ad23` | 6 | $1 |
| USDT | `0x89D668205724fbFBaAe1BDF32F0aA046f6bdD7Cd` | 6 | $1 |
| DAI | `0x9DcC3d09865292A2D5c39e08EEa583dd29390522` | 18 | $1 |
| LINK | `0xD4Afa6b83888aABbe74b288b4241F39Ad8A8e0bA` | 18 | $15 |
| UNI | `0xEebe649Cef7ed5b1fD4BE3222bA94f316eBdbE6c` | 18 | $8 |
| AAVE | `0x92EfA27dBb61069d4f65a656E1e9781509982ba7` | 18 | $180 |

### Liquidity Pools

**33 shards** across **12 token pairs** with **$13.88M total TVL**:

- **Major pairs:** WETH-USDC, WBTC-USDC, WETH-WBTC (3 shards each)
- **Stablecoin pairs:** USDC-USDT, USDC-DAI, USDT-DAI (3 shards each)
- **DeFi pairs:** LINK-USDC, UNI-USDC, AAVE-USDC (3 shards each)
- **Cross pairs:** WETH-LINK, WETH-UNI, WETH-AAVE (2 shards each)

### Recent Fixes

✅ **WBTC-USDC Pricing Bug Fixed** (Feb 2025)
- Fixed owner fee calculation in `SAMMPool._calculateSwapSAMM()`
- Fixed trade fee formula in `SAMMFees.calculateFeeSAMM()`
- All 33 pools tested and verified working in both directions
- See `FINAL_DIAGNOSIS.md` for technical details

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

# Test all pools (33 shards, both directions)
npx hardhat run scripts/test-wbtc-usdc-actual-swaps.js --network risechain
```

## Usage

### Execute a Swap

```solidity
// Approve router to spend your tokens
IERC20(tokenIn).approve(routerAddress, amount);

// Execute swap
router.swapExactOutput({
    hops: [{
        tokenIn: USDC_ADDRESS,
        tokenOut: WBTC_ADDRESS,
        amountOut: 1000000  // 0.01 WBTC (8 decimals)
    }],
    maxAmountIn: 1050000000,  // Max 1050 USDC (6 decimals)
    deadline: block.timestamp + 600,
    recipient: msg.sender
});
```

### Multi-Hop Swap

```solidity
// Swap USDC → WETH → WBTC in one transaction
router.swapExactOutput({
    hops: [
        { tokenIn: USDC, tokenOut: WETH, amountOut: 1e18 },      // Get 1 WETH
        { tokenIn: WETH, tokenOut: WBTC, amountOut: 1000000 }    // Get 0.01 WBTC
    ],
    maxAmountIn: 1100000000,  // Max 1100 USDC
    deadline: block.timestamp + 600,
    recipient: msg.sender
});
```

### Get a Quote

```solidity
// Get quote from router
QuoteResult memory quote = router.quoteSwap([
    SwapHop({
        tokenIn: USDC,
        tokenOut: WBTC,
        amountOut: 1000000  // 0.01 WBTC
    })
]);

// quote.expectedAmountIn - how much USDC you'll need (~1016 USDC)
// quote.selectedShards[0] - which shard will be used
// quote.hopFees[0] - fee for this hop (~12.5 USDC)
// quote.priceImpacts[0] - price impact (0.02%)
```

Or use the REST API:

```bash
curl -X POST http://localhost:3000/quote \
  -H "Content-Type: application/json" \
  -d '{"tokenIn":"USDC","tokenOut":"WBTC","amountOut":"0.01"}'
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

## REST API

A minimalist single-file REST API server provides real-time DEX data:

```bash
npm run api
```

Server runs on `http://localhost:3000`

### Quick Examples

```bash
# Get quote for swap
curl -X POST http://localhost:3000/quote \
  -H "Content-Type: application/json" \
  -d '{"tokenIn":"USDC","tokenOut":"WBTC","amountOut":"0.01"}'

# Get current price
curl http://localhost:3000/price/USDC/WBTC

# Get pool info
curl http://localhost:3000/pools/WBTC/USDC

# Get DEX stats
curl http://localhost:3000/stats
```

### Available Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/tokens` | GET | List all tokens |
| `/stats` | GET | DEX statistics (TVL, pool count) |
| `/quote` | POST | Single-hop swap quote |
| `/quote-multi` | POST | Multi-hop swap quote |
| `/price/:tokenA/:tokenB` | GET | Current price (bypasses c-threshold) |
| `/pools` | GET | All pools with real-time reserves |
| `/pools/:tokenA/:tokenB` | GET | Pools for specific pair |
| `/balance/:address/:token` | GET | Token balance |
| `/balances/:address` | GET | All token balances |

See `API.md` for full documentation.

### Features

- ✅ Real-time data from RiseChain blockchain
- ✅ 10-second caching for pool data
- ✅ Single-hop and multi-hop quotes
- ✅ Price discovery without c-threshold limits
- ✅ Live TVL calculation ($13.88M)
- ✅ CORS enabled for frontend integration

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
