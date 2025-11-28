# SAMM API Complete Guide

## Overview
You have **4 different API backends** deployed for your SAMM system:

### 1. **Basic Single-Pool API** (`src/index.js`)
- Port: 3000 (default)
- Purpose: Simple single-pool operations
- Best for: Basic pool queries and swaps

### 2. **Multi-Shard Backend** (`src/multi-shard-backend.js`)
- Port: 3000 (default)
- Purpose: Multi-shard operations on RiseChain
- Features: Best shard selection, c-smaller-better property demonstration
- Chain: RiseChain Testnet

### 3. **Monad Backend** (`src/monad-backend.js`)
- Port: 3001
- Purpose: Monad-specific operations
- Features: Multi-hop routing (USDC→USDT→DAI), best shard selection
- Chain: Monad Testnet
- **NEW DEPLOYMENT**: Uses fresh tokens and pools deployed on Monad

### 4. **Unified Multi-Chain Backend** (`src/unified-multi-chain-backend.js`)
- Port: 3000 (default)
- Purpose: Unified API for both RiseChain and Monad
- Features: Cross-chain comparison, chain-specific routing
- Chains: Both RiseChain and Monad

---

## Monad Deployment Details

### Tokens (Monad Testnet)
```json
{
  "USDC": "0x67DcA5710a9dA091e00093dF04765d711759f435",
  "USDT": "0x1888FF2446f2542cbb399eD179F4d6d966268C1F",
  "DAI": "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e"
}
```

### Pools (Monad Testnet)
**USDC/USDT Shards:**
1. Shard-1 (100 liquidity): `0x686ff8090b18C0DF4f828f02deAf122CeC40B1DE`
2. Shard-2 (500 liquidity): `0x0481CD694F9C4EfC925C694f49835547404c0460`
3. Shard-3 (1000 liquidity): `0x49ac6067BB0b6d5b793e9F3af3CD78b3a108AA5a`

**USDT/DAI Shards:**
1. Shard-1 (100 liquidity): `0x20c893A2706a71695894b15A4C385a3710C213eb`
2. Shard-2 (500 liquidity): `0xe369Fe406ecB270b0F73C641260791C5A2edEB81`
3. Shard-3 (1000 liquidity): `0x4d3c19832713A7993d69870cB421586CBC36dceA`

### Factory
`0x70fe868ac814CC197631B60eEEaEaa1553418D03`

---

## API Endpoints Reference

### 1. Basic Single-Pool API

#### Health Check
```bash
GET http://localhost:3000/health
```

#### Pool Info
```bash
GET http://localhost:3000/api/pool/info
```

#### Swap Quote
```bash
POST http://localhost:3000/api/swap/quote
Content-Type: application/json

{
  "amountOut": "1000000",
  "tokenIn": "0x...",
  "tokenOut": "0x..."
}
```

---

### 2. Multi-Shard Backend (RiseChain)

#### Health Check
```bash
GET http://localhost:3000/health
```
Returns: Shard count per pair, total shards

#### Get All Shards
```bash
GET http://localhost:3000/api/shards
```
Returns: Complete info for all shards including reserves, SAMM params, fees

#### Best Shard Selection (c-smaller-better)
```bash
POST http://localhost:3000/api/swap/best-shard
Content-Type: application/json

{
  "amountOut": "1000000",
  "tokenIn": "0x1D4a4B63733B36400BFD388937F5bE6CBd5902cb",
  "tokenOut": "0x2250AD5DE3eCb3C84CC0deBbfaE145E5B99835Cd"
}
```
Returns: Best shard + all shard comparisons, demonstrates c-smaller-better property

#### Cross-Pool Routing
```bash
POST http://localhost:3000/api/swap/cross-pool
Content-Type: application/json

{
  "amountIn": "1000000",
  "tokenIn": "0x1D4a4B63733B36400BFD388937F5bE6CBd5902cb",
  "tokenOut": "0xAdE16eAbd36F0E9dea4224a1C27FA973dDe78d43"
}
```
Returns: Multi-hop route through USDC

#### Get Specific Shard
```bash
GET http://localhost:3000/api/shard/0x36A3950Ed31A2875dA4df2588528BDA6d9F4709A
```

---

### 3. Monad Backend

#### Health Check
```bash
GET http://localhost:3001/health
```
Returns: Chain info, shard counts for Monad

#### Deployment Info
```bash
GET http://localhost:3001/api/deployment
```
Returns: Complete deployment data including all contracts

#### Get All Shards (Monad)
```bash
GET http://localhost:3001/api/shards
```
Returns: All Monad shards with reserves and SAMM params

#### Best Shard Selection (Monad)
```bash
POST http://localhost:3001/api/swap/best-shard
Content-Type: application/json

{
  "amountOut": "1000000",
  "tokenIn": "0x67DcA5710a9dA091e00093dF04765d711759f435",
  "tokenOut": "0x1888FF2446f2542cbb399eD179F4d6d966268C1F"
}
```
Returns: Best shard on Monad with c-smaller-better demonstration

#### Multi-Hop Routing (USDC→USDT→DAI on Monad)
```bash
POST http://localhost:3001/api/swap/cross-pool
Content-Type: application/json

{
  "amountIn": "1000000",
  "tokenIn": "0x67DcA5710a9dA091e00093dF04765d711759f435",
  "tokenOut": "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e"
}
```
Returns: Multi-hop route USDC→USDT→DAI on Monad

#### Get Specific Shard (Monad)
```bash
GET http://localhost:3001/api/shard/0x686ff8090b18C0DF4f828f02deAf122CeC40B1DE
```

#### Compare with RiseChain
```bash
GET http://localhost:3001/api/compare/risechain
```

---

### 4. Unified Multi-Chain Backend

#### Global Health Check
```bash
GET http://localhost:3000/health
```
Returns: Status of all chains, connection percentage

#### List All Chains
```bash
GET http://localhost:3000/api/chains
```
Returns: All supported chains with endpoints and status

#### Chain-Specific Info
```bash
GET http://localhost:3000/api/monad/info
GET http://localhost:3000/api/risechain/info
```
Returns: Chain details, block number, gas price, deployment info

#### Chain-Specific Shards
```bash
GET http://localhost:3000/api/monad/shards
GET http://localhost:3000/api/risechain/shards
```

#### Best Shard (Chain-Specific)
```bash
POST http://localhost:3000/api/monad/swap/best-shard
POST http://localhost:3000/api/risechain/swap/best-shard
Content-Type: application/json

{
  "amountOut": "1000000",
  "tokenIn": "0x...",
  "tokenOut": "0x..."
}
```

#### Cross-Pool Routing (Chain-Specific)
```bash
POST http://localhost:3000/api/monad/swap/cross-pool
POST http://localhost:3000/api/risechain/swap/cross-pool
Content-Type: application/json

{
  "amountIn": "1000000",
  "tokenIn": "0x...",
  "tokenOut": "0x..."
}
```

#### Cross-Chain Comparison
```bash
GET http://localhost:3000/api/compare/chains
```
Returns: Side-by-side comparison of all chains

#### Get Specific Shard (Chain-Specific)
```bash
GET http://localhost:3000/api/monad/shard/0x686ff8090b18C0DF4f828f02deAf122CeC40B1DE
GET http://localhost:3000/api/risechain/shard/0x36A3950Ed31A2875dA4df2588528BDA6d9F4709A
```

---

## Key Features Demonstrated

### 1. **c-smaller-better Property**
- Smaller shards provide better rates for the same trade
- Demonstrated via `/api/swap/best-shard` endpoint
- Returns all shards sorted by cost

### 2. **Multi-Hop Routing**
- USDC → USDT → DAI routing on Monad
- USDC → DAI routing on RiseChain
- Automatic path discovery through USDC hub

### 3. **Multi-Chain Support**
- Unified API for both chains
- Chain-specific endpoints
- Cross-chain comparison

### 4. **Shard Discovery**
- Automatic shard grouping by pair
- Best shard selection
- Complete shard state queries

---

## Testing Commands

### Start Monad Backend
```bash
cd samm-evm/services
PORT=3001 node src/monad-backend.js
```

### Start Unified Backend
```bash
cd samm-evm/services
node src/unified-multi-chain-backend.js
```

### Test Monad Health
```bash
curl http://localhost:3001/health
```

### Test Monad Shards
```bash
curl http://localhost:3001/api/shards
```

### Test Best Shard on Monad
```bash
curl -X POST http://localhost:3001/api/swap/best-shard \
  -H "Content-Type: application/json" \
  -d '{
    "amountOut": "1000000",
    "tokenIn": "0x67DcA5710a9dA091e00093dF04765d711759f435",
    "tokenOut": "0x1888FF2446f2542cbb399eD179F4d6d966268C1F"
  }'
```

### Test Multi-Hop on Monad (USDC→DAI)
```bash
curl -X POST http://localhost:3001/api/swap/cross-pool \
  -H "Content-Type: application/json" \
  -d '{
    "amountIn": "1000000",
    "tokenIn": "0x67DcA5710a9dA091e00093dF04765d711759f435",
    "tokenOut": "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e"
  }'
```

---

## Important Notes

1. **Monad uses NEW tokens** - Don't confuse with RiseChain tokens
2. **Different addresses** - Each chain has its own deployment
3. **Port 3001** - Monad backend runs on different port
4. **Multi-hop** - Monad supports USDC→USDT→DAI routing
5. **Unified API** - Can access both chains through single backend

---

## Next Steps for Deployment

1. Start the Monad backend on port 3001
2. Test all endpoints with actual calls
3. Verify multi-hop routing works
4. Compare performance across chains
5. Deploy to production server
