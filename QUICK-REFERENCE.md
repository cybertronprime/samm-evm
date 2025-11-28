# SAMM API - Quick Reference Card

## 🚀 One-Command Deploy

```bash
cd samm-evm && chmod +x DEPLOY-NOW.sh && ./DEPLOY-NOW.sh && cd services && node production-server-latest.js
```

## 📊 Contract Addresses (Monad Testnet)

```
Factory:  0x8ab2De0CD1C3bcAe3cB9a8028E28D60301dBf336

USDC:     0x9153bc242a5FD22b149B1cb252e3eE6314C37366
USDT:     0x39f0B52190CeA4B3569D5D501f0c637892F52379
DAI:      0xccA96CacCd9785f32C1ea02D688bc013D43D9f46

USDC/USDT-1: 0x986e6AA143Ecf491FbB9FFbcFB1A61424af1BC1e (5M)
USDC/USDT-2: 0xA68065D56C003D6982a6215Bd1C765726b2fCa13 (3M)
USDC/USDT-3: 0x58136Bb18639C7C3f2C552Bb734dA6D65Ff7D653 (2M)

USDT/DAI-1:  0x179e0308524c916a6F0452FF0ce999cEC88588e8 (10K)
USDT/DAI-2:  0x40767849365ff64F9EB341eD2Cf3E40590578749 (20K)
USDT/DAI-3:  0x302bB8B9Cf5722a2C69B19D98393041E007085Eb (30K)
```

## 🔌 API Endpoints

```bash
# Health
GET /health

# Deployment info
GET /api/deployment

# All shards
GET /api/shards

# Best shard
POST /api/swap/best-shard
{
  "amountOut": "1000000",
  "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
  "tokenOut": "0x39f0B52190CeA4B3569D5D501f0c637892F52379"
}

# Multi-hop
POST /api/swap/multi-hop
{
  "amountIn": "1000000",
  "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
  "tokenOut": "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46"
}

# Specific shard
GET /api/shard/0x986e6AA143Ecf491FbB9FFbcFB1A61424af1BC1e
```

## 🧪 Quick Test

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/deployment | jq
```

## ☁️ Deploy to Cloud

### Railway (FREE)
1. Push to GitHub
2. railway.app → New Project
3. Deploy from GitHub
4. Done!

### Render (FREE)
1. Push to GitHub
2. render.com → New Web Service
3. Build: `cd services && npm install`
4. Start: `cd services && node production-server-latest.js`

### Docker
```bash
cd services
docker build -f Dockerfile.latest -t samm-api .
docker run -p 3000:3000 samm-api
```

## 💻 Frontend Integration

```javascript
const API = 'https://your-api.com';

// Get deployment
const deployment = await fetch(`${API}/api/deployment`).then(r => r.json());

// Find best shard
const best = await fetch(`${API}/api/swap/best-shard`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amountOut: '1000000',
    tokenIn: deployment.tokens.USDC.address,
    tokenOut: deployment.tokens.USDT.address
  })
}).then(r => r.json());

console.log('Best shard:', best.bestShard.name);
```

## ✅ Features

- ✅ Multi-shard (6 shards)
- ✅ Multi-hop (USDC → USDT → DAI)
- ✅ c-smaller-better property
- ✅ Decimal normalization
- ✅ CORS enabled
- ✅ High liquidity (10M+)

## 📖 Full Docs

See `FINAL-DEPLOYMENT-GUIDE.md` for complete documentation.
