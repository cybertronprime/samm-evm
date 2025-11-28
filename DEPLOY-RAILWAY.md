# Deploy SAMM API to Railway.app (2 Minutes)

## ✅ What You Get
- Free hosting
- HTTPS URL automatically
- Auto-deploys from GitHub
- Zero configuration
- Built-in monitoring

## 🚀 Deployment Steps

### 1. Push to GitHub (if not already)
```bash
git add .
git commit -m "Ready for deployment"
git push origin main
```

### 2. Deploy to Railway
1. Go to [railway.app](https://railway.app)
2. Click **"Start a New Project"**
3. Click **"Deploy from GitHub repo"**
4. Select your repository
5. Railway will auto-detect Node.js and deploy!

### 3. Get Your URL
- Railway will provide a URL like: `https://samm-api-production.up.railway.app`
- Click on your deployment
- Go to **Settings** → **Networking** → **Generate Domain**

## 🧪 Test Your Deployment

Once deployed, test with your public URL:

```bash
# Replace with your Railway URL
export API_URL="https://your-app.up.railway.app"

# Health check
curl $API_URL/health

# Get deployment info
curl $API_URL/api/deployment

# Get all shards
curl $API_URL/api/shards

# Best shard
curl -X POST $API_URL/api/swap/best-shard \
  -H "Content-Type: application/json" \
  -d '{
    "amountOut": "1000000",
    "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
    "tokenOut": "0x39f0B52190CeA4B3569D5D501f0c637892F52379"
  }'

# Multi-hop (USDC → USDT → DAI)
curl -X POST $API_URL/api/swap/multi-hop \
  -H "Content-Type: application/json" \
  -d '{
    "amountIn": "1000000",
    "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
    "tokenOut": "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46"
  }'
```

## 📊 Deployment Data (Monad Testnet)

### Tokens
- **USDC**: `0x9153bc242a5FD22b149B1cb252e3eE6314C37366`
- **USDT**: `0x39f0B52190CeA4B3569D5D501f0c637892F52379`
- **DAI**: `0xccA96CacCd9785f32C1ea02D688bc013D43D9f46`

### Factory
- `0x8ab2De0CD1C3bcAe3cB9a8028E28D60301dBf336`

### Pools
**USDC/USDT:**
- Shard-1: `0x986e6AA143Ecf491FbB9FFbcFB1A61424af1BC1e` (5M liquidity)
- Shard-2: `0xA68065D56C003D6982a6215Bd1C765726b2fCa13` (3M liquidity)
- Shard-3: `0x58136Bb18639C7C3f2C552Bb734dA6D65Ff7D653` (2M liquidity)

**USDT/DAI:**
- Shard-1: `0x179e0308524c916a6F0452FF0ce999cEC88588e8` (10K liquidity)
- Shard-2: `0x40767849365ff64F9EB341eD2Cf3E40590578749` (20K liquidity)
- Shard-3: `0x302bB8B9Cf5722a2C69B19D98393041E007085Eb` (30K liquidity)

## 🌐 Frontend Integration

```javascript
const API_URL = 'https://your-app.up.railway.app';

// Get deployment info
const deployment = await fetch(`${API_URL}/api/deployment`).then(r => r.json());

// Get all shards
const shards = await fetch(`${API_URL}/api/shards`).then(r => r.json());

// Find best shard
const best = await fetch(`${API_URL}/api/swap/best-shard`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amountOut: '1000000',
    tokenIn: deployment.tokens.USDC.address,
    tokenOut: deployment.tokens.USDT.address
  })
}).then(r => r.json());

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
```

## ✅ Features
- ✅ CORS enabled for all origins
- ✅ Multi-hop routing (USDC → USDT → DAI)
- ✅ c-smaller-better property demonstrated
- ✅ 6 shards across 2 pairs
- ✅ Decimal normalization
- ✅ Production-ready

## 🔧 Monitoring
- View logs in Railway dashboard
- Check deployment status
- Monitor resource usage
- Auto-restarts on failure

## 💰 Cost
- **Free tier**: Perfect for testing and demos
- Automatic scaling
- No credit card required to start

---

**That's it!** Your API is live and ready to use with your frontend.
