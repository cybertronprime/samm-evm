# 🚀 SAMM API - Ready for Deployment

## ✅ Status: TESTED & READY

All APIs tested locally and working perfectly with the correct Monad deployment data.

## 📊 Deployment Data (Monad Testnet v2)

### Network
- **Chain**: Monad Testnet
- **Chain ID**: 10143
- **RPC**: https://testnet-rpc.monad.xyz
- **Factory**: `0x8ab2De0CD1C3bcAe3cB9a8028E28D60301dBf336`

### Tokens
- **USDC**: `0x9153bc242a5FD22b149B1cb252e3eE6314C37366` (6 decimals)
- **USDT**: `0x39f0B52190CeA4B3569D5D501f0c637892F52379` (6 decimals)
- **DAI**: `0xccA96CacCd9785f32C1ea02D688bc013D43D9f46` (18 decimals)

### Pools (6 Shards)
**USDC/USDT (High Liquidity):**
1. `0x986e6AA143Ecf491FbB9FFbcFB1A61424af1BC1e` - 5M liquidity
2. `0xA68065D56C003D6982a6215Bd1C765726b2fCa13` - 3M liquidity
3. `0x58136Bb18639C7C3f2C552Bb734dA6D65Ff7D653` - 2M liquidity

**USDT/DAI:**
1. `0x179e0308524c916a6F0452FF0ce999cEC88588e8` - 10K liquidity
2. `0x40767849365ff64F9EB341eD2Cf3E40590578749` - 20K liquidity
3. `0x302bB8B9Cf5722a2C69B19D98393041E007085Eb` - 30K liquidity

## 🎯 Quick Deploy Options

### Option 1: Railway.app (RECOMMENDED - 2 minutes)
```bash
# 1. Push to GitHub
git add .
git commit -m "Deploy SAMM API"
git push

# 2. Go to railway.app
# 3. Deploy from GitHub
# 4. Get your URL!
```
See: `DEPLOY-RAILWAY.md`

### Option 2: Local Test
```bash
cd services
node production-server.js
# Access at http://localhost:3000
```

### Option 3: Docker
```bash
cd services
docker build -t samm-api -f Dockerfile .
docker run -p 3000:3000 samm-api
```

## 🧪 Test Your Deployment

```bash
# Test locally
./test-api-complete.sh

# Test production
./test-api-complete.sh https://your-app.up.railway.app
```

## 📡 API Endpoints

### 1. Health Check
```bash
GET /health
```

### 2. Deployment Info
```bash
GET /api/deployment
```

### 3. Get All Shards
```bash
GET /api/shards
```

### 4. Best Shard (c-smaller-better)
```bash
POST /api/swap/best-shard
{
  "amountOut": "1000000",
  "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
  "tokenOut": "0x39f0B52190CeA4B3569D5D501f0c637892F52379"
}
```

### 5. Multi-Hop Routing
```bash
POST /api/swap/multi-hop
{
  "amountIn": "1000000",
  "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
  "tokenOut": "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46"
}
```

### 6. Specific Shard
```bash
GET /api/shard/0x986e6AA143Ecf491FbB9FFbcFB1A61424af1BC1e
```

## ✅ Features Verified

- ✅ Health check working
- ✅ Deployment info correct
- ✅ All 6 shards loading
- ✅ Best shard selection (c-smaller-better)
- ✅ Multi-hop routing (USDC → USDT → DAI)
- ✅ Specific shard queries
- ✅ CORS enabled for all origins
- ✅ Decimal normalization
- ✅ Production-ready error handling

## 🌐 Frontend Integration

```javascript
const API_URL = 'https://your-app.up.railway.app';

// Initialize
const deployment = await fetch(`${API_URL}/api/deployment`).then(r => r.json());
console.log('Connected to:', deployment.network);

// Get shards
const shards = await fetch(`${API_URL}/api/shards`).then(r => r.json());
console.log('Total shards:', shards.total);

// Find best shard for swap
const best = await fetch(`${API_URL}/api/swap/best-shard`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amountOut: '1000000',
    tokenIn: deployment.tokens.USDC.address,
    tokenOut: deployment.tokens.USDT.address
  })
}).then(r => r.json());

console.log('Best shard:', best.bestShard.name);
console.log('Amount in:', best.bestShard.amountIn);

// Multi-hop swap
const route = await fetch(`${API_URL}/api/swap/multi-hop`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amountIn: '1000000',
    tokenIn: deployment.tokens.USDC.address,
    tokenOut: deployment.tokens.DAI.address
  })
}).then(r => r.json());

console.log('Route:', route.path.join(' → '));
console.log('Final output:', route.amountOut);
```

## 📝 Next Steps

1. **Deploy to Railway** (see DEPLOY-RAILWAY.md)
2. **Test with your frontend**
3. **Share the API URL**

## 🆘 Support

If you encounter issues:
1. Check Railway logs
2. Verify RPC connectivity
3. Test locally first
4. Ensure correct token addresses

---

**Ready to deploy!** 🎉

All APIs tested and working with correct Monad deployment data.
