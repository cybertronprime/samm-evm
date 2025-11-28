# SAMM API Architecture Overview

## Summary

You have **4 different backend services** that can be deployed. Each serves a different purpose:

1. **Basic Service** (`index.js`) - Single pool API
2. **Monad Backend** (`monad-backend.js`) - Monad-specific multi-shard API
3. **Multi-Chain Server** (`multi-chain-server.js`) - Full multi-chain support
4. **Unified Backend** (`unified-multi-chain-backend.js`) - Simplified multi-chain API

## Which One Should You Use?

**For your current setup with the new decimal-aware deployment, use:**
- **Unified Backend** (`unified-multi-chain-backend.js`) on port 3000

This is the most complete and easiest to use. It supports both chains and has the cleanest API.

---

## Service Details

### 1. Basic Service (`services/src/index.js`)
**Port:** 3000 (default)  
**Purpose:** Simple single-pool API  
**Use Case:** Testing a single SAMM pool

**Endpoints:**
- `GET /health` - Health check
- `GET /api/pool/info` - Pool information
- `GET /api/pool/reserves` - Current reserves
- `POST /api/swap/quote` - Calculate swap quote
- `GET /api/price` - Simple price quote
- `GET /api/user/:address/balances` - User balances
- `GET /api/pool/tvl` - Total Value Locked

**Configuration:** Requires `.env` file with:
```env
SAMM_POOL_ADDRESS=0x...
TOKEN_A_ADDRESS=0x...
TOKEN_B_ADDRESS=0x...
RPC_URL=https://...
```

**Start:**
```bash
cd services
node src/index.js
```

---

### 2. Monad Backend (`services/src/monad-backend.js`)
**Port:** 3001 (default)  
**Purpose:** Monad Testnet multi-shard API  
**Use Case:** Working specifically with Monad deployment

**Endpoints:**
- `GET /health` - Health check with shard count
- `GET /api/deployment` - Full deployment info
- `GET /api/shards` - All shards with live data
- `POST /api/swap/best-shard` - Find optimal shard (c-smaller-better)
- `POST /api/swap/cross-pool` - Multi-hop routing
- `GET /api/shard/:address` - Specific shard info
- `GET /api/compare/risechain` - Cross-chain comparison

**Features:**
- Demonstrates c-smaller-better property
- Multi-hop routing through USDC
- Real-time shard comparison

**Start:**
```bash
cd services
MONAD_PORT=3001 node src/monad-backend.js
```

---

### 3. Multi-Chain Server (`services/src/multi-chain-server.js`)
**Port:** 3000 (default)  
**Purpose:** Full multi-chain support with chain isolation  
**Use Case:** Production multi-chain deployment

**Endpoints:**
- `GET /health` - Global health check
- `GET /api/chains` - List all supported chains
- `GET /api/:chainName/info` - Chain-specific info
- `GET /api/:chainName/shards` - Shards on specific chain
- `GET /api/:chainName/pools` - Pools on specific chain
- `POST /api/:chainName/swap/best-shard` - Best shard on chain
- `POST /api/:chainName/swap/cross-pool` - Multi-hop on chain
- `GET /api/:chainName/shard/:address` - Specific shard
- `POST /api/cross-chain/route` - Cross-chain routing (planned)
- `GET /api/isolation/test` - Test chain isolation

**Supported Chains:**
- `risechain` - RiseChain Testnet (Chain ID: 11155931)
- `monad` - Monad Testnet (Chain ID: 10143)

**Example Requests:**
```bash
# Get all chains
curl http://localhost:3000/api/chains

# Get Monad shards
curl http://localhost:3000/api/monad/shards

# Find best shard on RiseChain
curl -X POST http://localhost:3000/api/risechain/swap/best-shard \
  -H "Content-Type: application/json" \
  -d '{
    "amountOut": "1000000",
    "tokenIn": "0x...",
    "tokenOut": "0x..."
  }'
```

**Start:**
```bash
cd services
MULTI_CHAIN_PORT=3000 node src/multi-chain-server.js
```

---

### 4. Unified Backend (`services/src/unified-multi-chain-backend.js`) ⭐ **RECOMMENDED**
**Port:** 3000 (default)  
**Purpose:** Simplified multi-chain API with clean interface  
**Use Case:** **Use this for your current deployment**

**Endpoints:**
- `GET /health` - Global health with chain status
- `GET /api/chains` - All supported chains with endpoints
- `GET /api/:chain/info` - Chain information
- `GET /api/:chain/shards` - All shards on chain
- `POST /api/:chain/swap/best-shard` - Find optimal shard
- `POST /api/:chain/swap/cross-pool` - Multi-hop routing
- `GET /api/:chain/shard/:address` - Specific shard details
- `GET /api/compare/chains` - Compare all chains

**Supported Chains:**
- `risechain` - RiseChain Testnet
- `monad` - Monad Testnet

**Key Features:**
- ✅ Automatic chain validation
- ✅ Clean, consistent API across chains
- ✅ Demonstrates SAMM properties (c-smaller-better, c-non-splitting)
- ✅ Multi-hop routing
- ✅ Real-time pool data
- ✅ Backward compatible legacy endpoints

**Example Requests:**
```bash
# Health check
curl http://localhost:3000/health

# List all chains
curl http://localhost:3000/api/chains

# Get Monad shards
curl http://localhost:3000/api/monad/shards

# Find best shard for swap
curl -X POST http://localhost:3000/api/monad/swap/best-shard \
  -H "Content-Type: application/json" \
  -d '{
    "amountOut": "10000000",
    "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
    "tokenOut": "0x39f0B52190CeA4B3569D5D501f0c637892F52379"
  }'

# Multi-hop routing (USDC -> USDT -> DAI)
curl -X POST http://localhost:3000/api/monad/swap/cross-pool \
  -H "Content-Type: application/json" \
  -d '{
    "amountIn": "10000000",
    "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
    "tokenOut": "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46"
  }'

# Compare chains
curl http://localhost:3000/api/compare/chains
```

**Start:**
```bash
cd services
PORT=3000 node src/unified-multi-chain-backend.js
```

---

## Deployment Configuration

### Update Deployment Data

Before starting any backend, update the deployment file paths in the service code:

**For Unified Backend:**
```javascript
// In services/src/unified-multi-chain-backend.js
const monadData = require('../../deployment-data/complete-deployment-1764357709284.json');
```

**For Multi-Chain Server:**
```javascript
// In services/src/multi-chain-server.js
const monadData = require('../../deployment-data/complete-deployment-1764357709284.json');
```

**For Monad Backend:**
```javascript
// In services/src/monad-backend.js
const monadData = require('../../deployment-data/complete-deployment-1764357709284.json');
```

---

## Testing Your Deployment

### Step 1: Start the Unified Backend
```bash
cd samm-evm/services
PORT=3000 node src/unified-multi-chain-backend.js
```

### Step 2: Test Health
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "unified-multi-chain-backend",
  "chains": {
    "connected": 1,
    "total": 2,
    "percentage": 50
  },
  "supportedChains": ["risechain", "monad"],
  "timestamp": "2025-01-28T..."
}
```

### Step 3: Get Monad Shards
```bash
curl http://localhost:3000/api/monad/shards
```

### Step 4: Test Multi-Hop Swap
```bash
curl -X POST http://localhost:3000/api/monad/swap/cross-pool \
  -H "Content-Type: application/json" \
  -d '{
    "amountIn": "10000000",
    "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
    "tokenOut": "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46"
  }'
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend / Client                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Unified Multi-Chain Backend                     │
│                    (Port 3000)                               │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  API Gateway & Request Router                        │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                        │
│       ┌─────────────┴─────────────┐                         │
│       ▼                           ▼                         │
│  ┌─────────────┐           ┌─────────────┐                 │
│  │  Monad      │           │  RiseChain  │                 │
│  │  Provider   │           │  Provider   │                 │
│  └──────┬──────┘           └──────┬──────┘                 │
│         │                         │                         │
└─────────┼─────────────────────────┼─────────────────────────┘
          │                         │
          ▼                         ▼
┌──────────────────┐      ┌──────────────────┐
│  Monad Testnet   │      │ RiseChain Testnet│
│                  │      │                  │
│  ┌────────────┐  │      │  ┌────────────┐  │
│  │ USDC/USDT  │  │      │  │ USDC/USDT  │  │
│  │ Shards 1-3 │  │      │  │ Shards 1-3 │  │
│  └────────────┘  │      │  └────────────┘  │
│  ┌────────────┐  │      │  ┌────────────┐  │
│  │ USDT/DAI   │  │      │  │ USDT/DAI   │  │
│  │ Shards 1-3 │  │      │  │ Shards 1-3 │  │
│  └────────────┘  │      │  └────────────┘  │
└──────────────────┘      └──────────────────┘
```

---

## Recommendation

**For your current setup:**

1. **Use the Unified Backend** (`unified-multi-chain-backend.js`)
2. **Update the deployment path** to your new deployment file
3. **Start on port 3000**
4. **Test with the curl commands above**

This gives you:
- ✅ Clean API for both chains
- ✅ Multi-hop routing with decimal-aware contracts
- ✅ SAMM property demonstrations
- ✅ Easy to test and integrate with frontend

**Only one server needs to be running** - the Unified Backend handles everything!
