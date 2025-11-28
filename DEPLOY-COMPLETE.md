# 🚀 SAMM API - Complete Deployment Guide

## ✅ Tested & Ready to Deploy

Your API has been tested locally and is working perfectly with the correct Monad deployment data!

---

## 📊 Deployment Data (VERIFIED)

### Network
- **Chain:** Monad Testnet
- **Chain ID:** 10143
- **RPC:** https://testnet-rpc.monad.xyz
- **Version:** v2-decimal-aware

### Contracts
- **Factory:** `0x8ab2De0CD1C3bcAe3cB9a8028E28D60301dBf336`

### Tokens
- **USDC:** `0x9153bc242a5FD22b149B1cb252e3eE6314C37366` (6 decimals)
- **USDT:** `0x39f0B52190CeA4B3569D5D501f0c637892F52379` (6 decimals)
- **DAI:** `0xccA96CacCd9785f32C1ea02D688bc013D43D9f46` (18 decimals)

### Pools (6 Shards Total)

**USDC/USDT Shards:**
1. Shard-1 (5M liquidity): `0x986e6AA143Ecf491FbB9FFbcFB1A61424af1BC1e`
2. Shard-2 (3M liquidity): `0xA68065D56C003D6982a6215Bd1C765726b2fCa13`
3. Shard-3 (2M liquidity): `0x58136Bb18639C7C3f2C552Bb734dA6D65Ff7D653`

**USDT/DAI Shards:**
1. Shard-1 (10K liquidity): `0x179e0308524c916a6F0452FF0ce999cEC88588e8`
2. Shard-2 (20K liquidity): `0x40767849365ff64F9EB341eD2Cf3E40590578749`
3. Shard-3 (30K liquidity): `0x302bB8B9Cf5722a2C69B19D98393041E007085Eb`

---

## 🎯 Quick Deploy (Choose One)

### Option 1: Railway.app (RECOMMENDED - FREE & FAST)

**Why Railway?**
- ✅ Free tier (500 hours/month)
- ✅ Auto-deploys from GitHub
- ✅ HTTPS URL provided
- ✅ Zero configuration needed
- ✅ Built-in monitoring

**Steps:**
```bash
# 1. Push to GitHub (if not already)
git add .
git commit -m "Production-ready SAMM API"
git push origin main

# 2. Go to railway.app and sign in
# 3. Click "New Project" → "Deploy from GitHub"
# 4. Select your repository
# 5. Railway auto-detects Node.js and deploys!
# 6. Get your URL: https://your-app.up.railway.app
```

**Environment Variables (Auto-detected):**
Railway reads `.env.production` automatically - no manual config needed!

---

### Option 2: Render.com (FREE)

```bash
# 1. Push to GitHub
git push origin main

# 2. Go to render.com
# 3. New Web Service → Connect GitHub repo
# 4. Configure:
#    - Build Command: cd services && npm install
#    - Start Command: cd services && node production-server.js
# 5. Deploy!
```

---

### Option 3: Google Cloud Run (Serverless)

```bash
cd samm-evm/services

# Deploy
gcloud run deploy samm-api \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 3000

# Get URL
gcloud run services describe samm-api --region us-central1 --format 'value(status.url)'
```

---

### Option 4: Docker (Any Platform)

```bash
cd samm-evm/services

# Build
docker build -t samm-api .

# Run
docker run -d -p 3000:3000 --name samm-api samm-api

# Test
curl http://localhost:3000/health
```

---

### Option 5: PM2 (VPS/Server)

```bash
cd samm-evm/services

# Install PM2
npm install -g pm2

# Start
pm2 start ecosystem.config.js

# Save & auto-restart
pm2 save
pm2 startup
```

---

## 🧪 Test Your Deployment

### Health Check
```bash
curl https://your-url.com/health
```

Expected response:
```json
{
  "status": "healthy",
  "chain": "Monad Testnet",
  "chainId": 10143,
  "pools": {
    "USDC/USDT": 3,
    "USDT/DAI": 3
  },
  "totalShards": 6
}
```

### Get Deployment Info
```bash
curl https://your-url.com/api/deployment
```

### Get All Shards
```bash
curl https://your-url.com/api/shards
```

### Test Best Shard (c-smaller-better)
```bash
curl -X POST https://your-url.com/api/swap/best-shard \
  -H "Content-Type: application/json" \
  -d '{
    "amountOut": "1000000",
    "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
    "tokenOut": "0x39f0B52190CeA4B3569D5D501f0c637892F52379"
  }'
```

### Test Multi-Hop (USDC → USDT → DAI)
```bash
curl -X POST https://your-url.com/api/swap/multi-hop \
  -H "Content-Type: application/json" \
  -d '{
    "amountIn": "1000000",
    "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
    "tokenOut": "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46"
  }'
```

---

## 🌐 API Endpoints

### Base Endpoints
- `GET /` - API documentation
- `GET /health` - Health check
- `GET /api/deployment` - Full deployment info
- `GET /api/shards` - All shards with on-chain data

### Swap Endpoints
- `POST /api/swap/best-shard` - Find best shard (c-smaller-better)
- `POST /api/swap/multi-hop` - Multi-hop routing (USDC→USDT→DAI)
- `GET /api/shard/:address` - Specific shard info

---

## 💻 Frontend Integration

### JavaScript Example
```javascript
const API_URL = 'https://your-deployed-url.com';

// Get deployment info
async function getDeployment() {
  const res = await fetch(`${API_URL}/api/deployment`);
  return await res.json();
}

// Get all shards
async function getShards() {
  const res = await fetch(`${API_URL}/api/shards`);
  return await res.json();
}

// Find best shard
async function findBestShard(amountOut, tokenIn, tokenOut) {
  const res = await fetch(`${API_URL}/api/swap/best-shard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amountOut, tokenIn, tokenOut })
  });
  return await res.json();
}

// Multi-hop swap
async function multiHopSwap(amountIn, tokenIn, tokenOut) {
  const res = await fetch(`${API_URL}/api/swap/multi-hop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amountIn, tokenIn, tokenOut })
  });
  return await res.json();
}

// Example usage
const deployment = await getDeployment();
console.log('Factory:', deployment.factory);
console.log('Tokens:', deployment.tokens);

const shards = await getShards();
console.log('Total shards:', shards.total);

const best = await findBestShard(
  '1000000',
  deployment.tokens.USDC.address,
  deployment.tokens.USDT.address
);
console.log('Best shard:', best.bestShard.name);
```

### React Example
```jsx
import { useState, useEffect } from 'react';

const API_URL = 'https://your-deployed-url.com';

function SAMMApp() {
  const [deployment, setDeployment] = useState(null);
  const [shards, setShards] = useState([]);

  useEffect(() => {
    async function loadData() {
      const deployRes = await fetch(`${API_URL}/api/deployment`);
      const deployData = await deployRes.json();
      setDeployment(deployData);

      const shardsRes = await fetch(`${API_URL}/api/shards`);
      const shardsData = await shardsRes.json();
      setShards(shardsData.shards);
    }
    loadData();
  }, []);

  return (
    <div>
      <h1>SAMM DEX</h1>
      <p>Chain: {deployment?.network}</p>
      <p>Factory: {deployment?.factory}</p>
      <p>Total Shards: {shards.length}</p>
    </div>
  );
}
```

---

## ✅ Features

### 1. Multi-Shard Architecture
- 6 shards across 2 pairs
- Different liquidity levels
- Decimal normalization (v2)

### 2. c-smaller-better Property
- Smaller shards provide better rates
- API automatically finds best shard
- Demonstrates SAMM core property

### 3. Multi-Hop Routing
- USDC → USDT → DAI routing
- Automatic path discovery
- Fee calculation across hops

### 4. CORS Enabled
- ✅ No CORS issues
- ✅ Works with any frontend
- ✅ All origins allowed

---

## 📈 Monitoring

### Railway
- Built-in metrics dashboard
- Real-time logs
- Resource usage graphs

### PM2
```bash
pm2 monit          # Real-time monitoring
pm2 logs samm-api  # View logs
pm2 status         # Check status
```

### Docker
```bash
docker logs -f samm-api     # Follow logs
docker stats samm-api       # Resource usage
```

---

## 🔧 Troubleshooting

### Port Already in Use
```bash
lsof -i :3000
kill -9 <PID>
```

### Dependencies Issues
```bash
cd services
rm -rf node_modules package-lock.json
npm install
```

### RPC Connection Issues
- Verify Monad RPC: https://testnet-rpc.monad.xyz
- Check network connectivity
- Verify firewall settings

---

## 📝 Summary

✅ **Tested locally** - API working perfectly  
✅ **Correct deployment data** - v2 with decimal normalization  
✅ **CORS enabled** - No frontend issues  
✅ **Multiple deployment options** - Choose what works for you  
✅ **Production-ready** - Ready to deploy now  

**Recommended:** Deploy to Railway.app for instant, free hosting with HTTPS!

---

## 🚀 Deploy Now!

```bash
# Test locally first
cd samm-evm/services
node production-server.js

# Then deploy to Railway.app:
# 1. Push to GitHub
# 2. Connect at railway.app
# 3. Auto-deploys in 2 minutes!
```

Your API will be live at: `https://your-app.up.railway.app`
