# SAMM DEX API Documentation

Minimalist REST API for SAMM DEX on RiseChain Testnet.

## Quick Start

```bash
npm install
npm run api
```

Server runs on `http://localhost:3000`

## Environment Variables

```bash
RISECHAIN_RPC_URL=https://testnet.riselabs.xyz/http
PORT=3000
DEPLOYMENT_FILE=production-risechain-1770744587343.json
```

## API Endpoints

### GET /health
Health check

**Response:**
```json
{
  "status": "ok",
  "deployment": "production-risechain-1770744587343.json"
}
```

### GET /tokens
List all available tokens

**Response:**
```json
{
  "tokens": [
    {
      "symbol": "WBTC",
      "address": "0xEf6c9F206Ad4333Ca049C874ae6956f849e71479",
      "decimals": 8,
      "price": 100000
    }
  ]
}
```

### GET /stats
DEX statistics with real-time TVL

**Response:**
```json
{
  "totalPools": 33,
  "totalPairs": 12,
  "totalLiquidityUSD": "13877959.65",
  "tokens": 8,
  "router": "0x622c2D2719197A047f29BCBaaaEBBDbD54b45a11",
  "factory": "0x1114cF606d700bB8490C9D399500e35a31FaE27A"
}
```

### POST /quote
Get quote for single or multi-hop swap (unified endpoint)

**Single-hop request:**
```json
{
  "tokenIn": "USDC",
  "tokenOut": "DAI",
  "amountOut": "100"
}
```

**Multi-hop request:**
```json
{
  "route": ["USDC", "USDT", "DAI"],
  "amountOut": "100"
}
```

**Response includes:**
- `expectedAmountIn` - Total input needed
- `totalFee` - Sum of all fees
- `selectedShards` - Array of shard addresses used
- `shardsData` - Detailed pool data for each hop (reserves, liquidity, fees)
- `priceImpacts` - Price impact for each hop

**Single-hop response example:**
```json
{
  "route": ["USDC", "DAI"],
  "expectedAmountIn": "102.093508",
  "shardsData": [{
    "address": "0x6291aC35BcE864d37797Ab6c1ae9d0e8BCEc62dD",
    "reserveA": "49799.265208991137660259",
    "reserveB": "50218.003678",
    "liquidityUSD": 100017,
    "fee": "1.049752",
    "priceImpact": "0.01%"
  }]
}
```

**Multi-hop response example:**
```json
{
  "route": ["USDC", "USDT", "DAI"],
  "expectedAmountIn": "104.391973",
  "totalFee": "1.909680",
  "hops": 2,
  "shardsData": [
    {
      "address": "0xdf21cEeDE5846823691482Ba75CBfC2070BA5E38",
      "tokenIn": "USDC",
      "tokenOut": "USDT",
      "liquidityUSD": 100023,
      "fee": "1.068438"
    },
    {
      "address": "0x89fCF1e6E6fAD786580CeFf1eEE9326539E2a6F9",
      "tokenIn": "USDT",
      "tokenOut": "DAI",
      "liquidityUSD": 50008,
      "fee": "0.841242"
    }
  ]
}
```

### GET /price/:tokenA/:tokenB
Get current price (bypasses c-threshold for price discovery)

**Example:** `/price/USDC/WBTC`

**Response:**
```json
{
  "pair": "USDC/WBTC",
  "price": "115093.923403",
  "description": "1 WBTC = 115093.923403 USDC",
  "pool": "WBTC-USDC-Large"
}
```

### GET /pools
List all pools with real-time reserves

**Response:**
```json
{
  "pools": [
    {
      "pair": "WBTC-USDC",
      "shards": [
        {
          "name": "WBTC-USDC-Small",
          "address": "0x82C891CaF08ceD046853e82DE600e954820FE798",
          "tokenA": "USDC",
          "tokenB": "WBTC",
          "reserveA": "50202.054016",
          "reserveB": "0.49821311",
          "liquidityUSD": "100023.37"
        }
      ]
    }
  ]
}
```

### GET /pools/:tokenA/:tokenB
Get pools for specific pair (from deployment data)

**Example:** `/pools/WBTC/USDC`

### GET /shards/:tokenA/:tokenB
Get all shards for a token pair from blockchain (real-time, includes user-created pools)

**Example:** `/shards/USDC/DAI`

**Response:**
```json
{
  "tokenA": "USDC",
  "tokenB": "DAI",
  "shards": [
    {
      "address": "0x76d350Ade8775780839F8ddAE2Fdbd582F69169e",
      "tokenA": "DAI",
      "tokenB": "USDC",
      "reserveA": "5000.0",
      "reserveB": "5000.0",
      "liquidityUSD": 10000
    }
  ],
  "totalShards": 4,
  "totalLiquidityUSD": 2110206
}
```

### GET /balance/:address/:token
Get token balance for address

**Example:** `/balance/0x004566C322f5F1CBC0594928556441f8D38EA589/WBTC`

**Response:**
```json
{
  "address": "0x004566C322f5F1CBC0594928556441f8D38EA589",
  "token": "WBTC",
  "balance": "976.56125756",
  "balanceRaw": "97656125756"
}
```

### GET /balances/:address
Get all token balances for address

**Example:** `/balances/0x004566C322f5F1CBC0594928556441f8D38EA589`

## Usage Examples

### JavaScript
```javascript
// Get quote
const response = await fetch('http://localhost:3000/quote', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tokenIn: 'USDC',
    tokenOut: 'WBTC',
    amountOut: '0.01'
  })
});
const quote = await response.json();
console.log(`Need ${quote.expectedAmountIn} USDC for 0.01 WBTC`);
```

### cURL
```bash
# Get quote
curl -X POST http://localhost:3000/quote \
  -H "Content-Type: application/json" \
  -d '{"tokenIn":"USDC","tokenOut":"WBTC","amountOut":"0.01"}'

# Get price
curl http://localhost:3000/price/USDC/WBTC

# Get pools
curl http://localhost:3000/pools/WBTC/USDC
```

## Notes

- All data fetched in real-time from RiseChain blockchain
- Pool data cached for 10 seconds
- Price endpoint uses `calculateSwapSAMM()` to bypass c-threshold limits
- Quote endpoint respects c-threshold (1.04% of pool reserve per swap)
- API is read-only - swap execution happens on frontend with user's wallet

## Error Responses

```json
{
  "error": "Error message"
}
```

Status codes: `200` (success), `400` (bad request), `404` (not found), `500` (server error)
