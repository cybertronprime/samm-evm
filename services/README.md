# SAMM Service Backend

Backend API service for SAMM (Stableswap Automated Market Maker) integration.

## Features

- Pool information and state querying
- Swap quote calculations
- Price discovery
- User balance tracking
- TVL calculation
- Rate limiting and security

## Installation

```bash
cd services
npm install
```

## Configuration

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Update the following variables:
- `SAMM_POOL_ADDRESS`: Deployed SAMM pool contract address
- `TOKEN_A_ADDRESS`: Token A contract address
- `TOKEN_B_ADDRESS`: Token B contract address
- `RPC_URL`: Ethereum RPC endpoint

## Development

```bash
npm run dev
```

## Production

```bash
npm start
```

## API Endpoints

### Health Check
```
GET /health
```

### Pool Information
```
GET /api/pool/info
```

Returns complete pool state, token information, and fee parameters.

### Reserves
```
GET /api/pool/reserves
```

Returns current token reserves.

### Swap Quote
```
POST /api/swap/quote
Content-Type: application/json

{
  "amountOut": "1000000000000000000",
  "tokenIn": "0x...",
  "tokenOut": "0x..."
}
```

Returns swap calculation including fees and price impact.

### Price
```
GET /api/price?amountA=1000000000000000000
```

Returns simple price quote.

### User Balances
```
GET /api/user/:address/balances
```

Returns user's token and LP token balances.

### TVL
```
GET /api/pool/tvl
```

Returns Total Value Locked in the pool.

## Example Usage

### Get Pool Info

```bash
curl http://localhost:3000/api/pool/info
```

### Calculate Swap Quote

```bash
curl -X POST http://localhost:3000/api/swap/quote \
  -H "Content-Type: application/json" \
  -d '{
    "amountOut": "1000000000000000000",
    "tokenIn": "0x...",
    "tokenOut": "0x..."
  }'
```

### Get Price

```bash
curl http://localhost:3000/api/price?amountA=1000000000000000000
```

## Response Format

All endpoints return JSON responses:

### Success
```json
{
  "data": { ... },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Error
```json
{
  "error": "Error message"
}
```

## Rate Limiting

- Default: 100 requests per 15 minutes per IP
- Configurable via `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS`

## Security

- Helmet.js for security headers
- CORS enabled
- Rate limiting
- Input validation
- No private key exposure (read-only operations)

## License

MIT
