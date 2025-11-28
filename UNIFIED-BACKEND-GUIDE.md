# 🚀 SAMM Unified Multi-Chain Backend

A single backend service that handles both **RiseChain** and **Monad** testnets with complete SAMM functionality.

## ✨ What This Provides

### **Single Backend, Multiple Chains**
- ✅ **RiseChain Testnet** - 5 shards deployed (3x USDC/USDT, 2x USDC/DAI)
- ✅ **Monad Testnet** - 5 shards deployed (3x USDC/USDT, 2x USDC/DAI)
- ✅ **Complete API Coverage** - All SAMM operations on both chains
- ✅ **Chain Isolation** - Independent operation per chain
- ✅ **SAMM Properties** - c-smaller-better, multi-shard routing

### **All APIs in One Service**
- 🔍 **Shard Discovery** - Find all shards across chains
- 🎯 **Optimal Routing** - c-smaller-better shard selection
- 🔀 **Cross-Pool Routing** - Multi-hop swaps (A→B→C)
- 💧 **Liquidity Management** - Pool analysis and recommendations
- 📊 **Real-time Data** - Live reserves, fees, and metrics

## 🚀 Quick Start

### 1. Start the Backend
```bash
npm run backend
```

### 2. Test All APIs
```bash
npm run backend:test
```

### 3. Access the APIs
- **Base URL**: `http://localhost:3000`
- **Health Check**: `http://localhost:3000/health`
- **All Chains**: `http://localhost:3000/api/chains`

## 📋 Complete API Reference

### **Global Endpoints**
```
GET  /health                    # Service health check
GET  /api/chains               # List all supported chains
GET  /api/isolation/test       # Test chain isolation
```

### **Chain-Specific Endpoints**
Replace `{chain}` with `risechain` or `monad`:

```
GET  /api/{chain}/info                    # Chain information
GET  /api/{chain}/shards                  # All shards on chain
GET  /api/{chain}/pools                   # All pools (legacy format)
POST /api/{chain}/swap/best-shard         # Find optimal shard
POST /api/{chain}/swap/cross-pool         # Multi-hop routing
GET  /api/{chain}/shard/{address}         # Specific shard info
```

## 🧪 API Examples

### **1. Get All Chains**
```bash
curl http://localhost:3000/api/chains
```

**Response:**
```json
{
  "totalChains": 2,
  "deployedChains": 2,
  "chains": [
    {
      "name": "risechain",
      "chainId": 11155931,
      "displayName": "RiseChain Testnet",
      "deployed": true,
      "totalShards": 5,
      "endpoints": {
        "shards": "/api/risechain/shards",
        "bestShard": "/api/risechain/swap/best-shard"
      }
    },
    {
      "name": "monad", 
      "chainId": 10143,
      "displayName": "Monad Testnet",
      "deployed": true,
      "totalShards": 5
    }
  ]
}
```

### **2. Get RiseChain Shards**
```bash
curl http://localhost:3000/api/risechain/shards
```

**Response:**
```json
{
  "chain": "risechain",
  "chainId": 11155931,
  "totalShards": 5,
  "shards": {
    "USDC/USDT": [
      {
        "name": "USDC/USDT-1",
        "address": "0x36A3950Ed31A2875dA4df2588528BDA6d9F4709A",
        "liquidity": "100.0",
        "reserves": { "tokenA": "...", "tokenB": "..." }
      }
    ],
    "USDC/DAI": [...]
  }
}
```

### **3. Find Best Shard (c-smaller-better)**
```bash
curl -X POST http://localhost:3000/api/risechain/swap/best-shard \
  -H "Content-Type: application/json" \
  -d '{
    "amountOut": "1000000",
    "tokenIn": "0x1D4a4B63733B36400BFD388937F5bE6CBd5902cb",
    "tokenOut": "0x2250AD5DE3eCb3C84CC0deBbfaE145E5B99835Cd"
  }'
```

**Response:**
```json
{
  "chain": "risechain",
  "bestShard": {
    "shardName": "USDC/USDT-1",
    "liquidity": "100.0",
    "amountIn": "1012101010101010102",
    "tradeFee": "1500"
  },
  "allShards": [...],
  "cSmallerBetterDemonstrated": true
}
```

### **4. Cross-Pool Routing**
```bash
curl -X POST http://localhost:3000/api/monad/swap/cross-pool \
  -H "Content-Type: application/json" \
  -d '{
    "amountIn": "10000000",
    "tokenIn": "0x67DcA5710a9dA091e00093dF04765d711759f435",
    "tokenOut": "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e"
  }'
```

**Response:**
```json
{
  "chain": "monad",
  "route": "direct",
  "path": ["USDC", "DAI"],
  "shards": ["USDC/DAI-1"],
  "amountIn": "10000000",
  "amountOut": "9950000000000000000",
  "steps": [...]
}
```

## 🔧 Deployment Information

### **RiseChain Testnet (Chain ID: 11155931)**
- **Factory**: `0xa0Bb5eaDE9Ea3C8661881884d3a0b0565921aE48`
- **USDC**: `0x1D4a4B63733B36400BFD388937F5bE6CBd5902cb`
- **USDT**: `0x2250AD5DE3eCb3C84CC0deBbfaE145E5B99835Cd`
- **DAI**: `0xAdE16eAbd36F0E9dea4224a1C27FA973dDe78d43`

**Shards:**
- USDC/USDT-1: `0x36A3950Ed31A2875dA4df2588528BDA6d9F4709A` (100 liquidity)
- USDC/USDT-2: `0x28784E66A02Eee695086Cd05F67d9B9866AA68F0` (500 liquidity)
- USDC/USDT-3: `0x7C68ebB44C1EA6CF3c48F12AB8BF77BD5A834Db7` (1000 liquidity)
- USDC/DAI-1: `0xD80bAf05268B9c8eF662ce14D5D92860CF3D3B90` (200 liquidity)
- USDC/DAI-2: `0xA2eb11c134e58B9fD423b9e5C66B990C15D484D5` (800 liquidity)

### **Monad Testnet (Chain ID: 10143)**
- **Factory**: `0x70fe868ac814CC197631B60eEEaEaa1553418D03`
- **USDC**: `0x67DcA5710a9dA091e00093dF04765d711759f435`
- **USDT**: `0x1888FF2446f2542cbb399eD179F4d6d966268C1F`
- **DAI**: `0x60CB213FCd1616FbBD44319Eb11A35d5671E692e`

**Shards:**
- USDC/USDT-1: `0x686ff8090b18C0DF4f828f02deAf122CeC40B1DE` (100 liquidity)
- USDC/USDT-2: `0x0481CD694F9C4EfC925C694f49835547404c0460` (500 liquidity)
- USDC/USDT-3: `0x49ac6067BB0b6d5b793e9F3af3CD78b3a108AA5a` (1000 liquidity)
- USDC/DAI-1: `0xdfE2C795465873c000a84A55dACb834226373e56` (200 liquidity)
- USDC/DAI-2: `0x67d3255147fa07adc747E76055f89b78aa4021c5` (800 liquidity)

## 🔬 SAMM Properties Validated

### **C-Smaller-Better Property**
- ✅ Smallest shards always provide best rates
- ✅ Demonstrated across all token pairs
- ✅ Works on both RiseChain and Monad

### **Multi-Shard Architecture**
- ✅ Multiple shards per token pair
- ✅ Different liquidity levels (100, 200, 500, 800, 1000)
- ✅ Independent shard selection

### **Cross-Pool Routing**
- ✅ Direct swaps when pairs exist
- ✅ Multi-hop routing through USDC
- ✅ Atomic execution across hops

## 🛠️ Development

### **Project Structure**
```
samm-evm/
├── services/src/multi-chain-server.js    # Main backend service
├── deployment-data/                      # Contract addresses
├── start-unified-backend.js              # Startup script
├── test-unified-backend.js               # Test script
└── UNIFIED-BACKEND-GUIDE.md             # This guide
```

### **Environment Variables**
```bash
# Required
MULTI_CHAIN_PORT=3000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Optional
NODE_ENV=development
DEBUG=false
```

### **Adding New Chains**
1. Add deployment data to `deployment-data/`
2. Update `CHAINS` config in `multi-chain-server.js`
3. Test with `npm run backend:test`

## 🚨 Troubleshooting

### **Backend Won't Start**
```bash
# Check if port is in use
lsof -i :3000

# Check environment variables
cat .env

# Check deployment data
ls deployment-data/
```

### **Chain Connection Issues**
```bash
# Test RPC endpoints
curl -X POST https://testnet.riselabs.xyz \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

curl -X POST https://testnet-rpc.monad.xyz \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

### **API Errors**
```bash
# Check backend health
curl http://localhost:3000/health

# Check specific chain
curl http://localhost:3000/api/risechain/info
curl http://localhost:3000/api/monad/info
```

## 🎯 Next Steps

1. **Start the backend**: `npm run backend`
2. **Test all APIs**: `npm run backend:test`
3. **Integrate with frontend**: Use the API endpoints
4. **Monitor performance**: Check `/health` endpoint
5. **Scale as needed**: Add more chains or shards

## 📞 Support

- **Health Check**: `GET /health`
- **Chain Status**: `GET /api/chains`
- **Isolation Test**: `GET /api/isolation/test`

The unified backend provides everything you need for SAMM operations across both RiseChain and Monad testnets in a single, efficient service! 🚀