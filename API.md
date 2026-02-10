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
Get single-hop swap quote

**Request:**
```json
{
  "tokenIn": "USDC",
  "tokenOut": "WBTC",
  "amountOut": "0.01"
}
```

**Response:**
```json
{
  "tokenIn": "USDC",
  "tokenOut": "WBTC",
  "amountOut": "0.01",
  "expectedAmountIn": "1016.775201",
  "fee": "12.503194",
  "priceImpact": "0.02%",
  "selectedShard": "0x7377C79551D632A02F2D4263832dae707206a735",
  "route": ["USDC", "WBTC"]
}
```

### POST /quote-multi
Get multi-hop swap quote

**Request:**
```json
{
  "route": ["USDC", "WETH", "WBTC"],
  "amountOut": "0.01"
}
```

**Response:**
```json
{
  "route": ["USDC", "WETH", "WBTC"],
  "amountOut": "0.01",
  "expectedAmountIn": "1037.999059",
  "totalFee": "12.713362",
  "hops": 2,
  "selectedShards": [
    "0xD2fb6c93c43F79b09ba17a4F895212A32f5868Bf",
    "0x0e45Ed7c251F196757D0c6eA35C7bE9125b21C75"
  ],
  "priceImpacts": ["0.02%", "0.02%"]
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
Get pools for specific pair

**Example:** `/pools/WBTC/USDC`

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
