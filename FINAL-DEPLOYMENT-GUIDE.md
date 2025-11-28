# SAMM API - Final Deployment Guide
## Latest Version: v2-decimal-aware

---

## 🎯 Quick Start (30 seconds)

```bash
cd samm-evm
chmod +x DEPLOY-NOW.sh
./DEPLOY-NOW.sh
cd services
node production-server-latest.js
```

**Test it:**
```bash
curl http://localhost:3000/health
```

---

## 📊 Deployment Data (EXACT - DO NOT CHANGE)

### Network
- **Chain:** Monad Testnet
- **Chain ID:** 10143
- **RPC:** https://testnet-rpc.monad.xyz
- **Version:** v2-decimal-aware
- **Deployed:** 2025-11-28T19:21:49.284Z

### Factory
```
0x8ab2De0CD1C3bcAe3cB9a8028E28D60301dBf336
```

### Tokens
```javascript
USDC: {
  address: "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
  decimals: 6
}

USDT: {
  address: "0x39f0B52190CeA4B3569D5D501f0c637892F52379",
  decimals: 6
}

DAI: {
  address: "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46",
  decimals: 18
}
```

### Pools

#### USDC/USDT (10M Total Liquidity)
```javascript
Shard-1: {
  address: "0x986e6AA143Ecf491FbB9FFbcFB1A61424af1BC1e",
  liquidity: "5000000",
  c: 5000000
}

Shard-2: {
  address: "0xA68065D56C003D6982a6215Bd1C765726b2fCa13",
  liquidity: "3000000",
  c: 3000000
}

Shard-3: {
  address: "0x58136Bb18639C7C3f2C552Bb734dA6D65Ff7D653",
  liquidity: "2000000",
  c: 2000000
}
```

#### USDT/DAI (60K Total Liquidity)
```javascript
Shard-1: {
  address: "0x179e0308524c916a6F0452FF0ce999cEC88588e8",
  liquidity: "10000",
  c: 10000
}

Shard-2: {
  address: "0x40767849365ff64F9EB341eD2Cf3E40590578749",
  liquidity: "20000",
  c: 20000
}

Shard-3: {
  address: "0x302bB8B9Cf5722a2C69B19D98393041E007085Eb",
  liquidity: "30000",
  c: 30000
}
```

---

## ☁️ Cloud Deployment Options

### Option 1: Railway.app (FREE - RECOMMENDED) ⭐

**Why Railway?**
- ✅ Free tier: 500 hours/month
- ✅ Auto-deploy from GitHub
- ✅ HTTPS included
- ✅ Zero config
- ✅ 2-minute setup

**Steps:**
1. Push code to GitHub
2. Go to [railway.app](https://railway.app)
3. Click "New Project" → "Deploy from GitHub"
4. Select your repo
5. Railway auto-detects Node.js
6. Set start command: `cd services && node production-server-latest.js`
7. Deploy!

**Your URL:** `https://your-app.railway.app`

---

### Option 2: Render.com (FREE)

**Steps:**
1. Push to GitHub
2. Go to [render.com](https://render.com)
3. New Web Service → Connect GitHub
4. Configure:
   - **Build:** `cd services && npm install`
   - **Start:** `cd services && node production-server-latest.js`
   - **Plan:** Free
5. Deploy

**Your URL:** `https://samm-api.onrender.com`

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
  --port 3000 \
  --set-env-vars NODE_ENV=production

# Get URL
gcloud run services describe samm-api \
  --region us-central1 \
  --format 'value(status.url)'
```

**Cost:** Free tier: 2M requests/month

---

### Option 4: Docker (Universal)

```bash
cd samm-evm/services

# Build
docker build -f Dockerfile.latest -t samm-api .

# Run
docker run -d \
  -p 3000:3000 \
  --name samm-api \
  --restart unless-stopped \
  samm-api

# Check logs
docker logs -f samm-api

# Test
curl http://localhost:3000/health
```

**Deploy anywhere:**
- AWS ECS/Fargate
- Azure Container Instances
- DigitalOcean App Platform
- Fly.io
- Heroku

---

### Option 5: PM2 (VPS/Server)

```bash
cd samm-evm/services

# Install PM2
npm install -g pm2

# Install deps
npm install --production

# Create PM2 config
cat > ecosystem.latest.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'samm-api',
    script: './production-server-latest.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
EOF

# Start
pm2 start ecosystem.latest.config.js

# Save & auto-restart
pm2 save
pm2 startup

# Monitor
pm2 monit

# Logs
pm2 logs samm-api
```

---

## 🔌 API Endpoints

### Base URL
- **Local:** `http://localhost:3000`
- **Production:** `https://your-domain.com`

### Available Endpoints

#### 1. Health Check
```bash
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "chain": "Monad Testnet",
  "chainId": 10143,
  "version": "v2-decimal-aware",
  "totalShards": 6,
  "features": [
    "multi-shard",
    "multi-hop",
    "c-smaller-better",
    "decimal-normalization"
  ]
}
```

#### 2. Get Deployment Info
```bash
GET /api/deployment
```

Returns complete deployment data including all contracts, tokens, and pools.

#### 3. Get All Shards
```bash
GET /api/shards
```

Returns all 6 shards with on-chain data (reserves, SAMM params).

#### 4. Find Best Shard (c-smaller-better)
```bash
POST /api/swap/best-shard
Content-Type: application/json

{
  "amountOut": "1000000",
  "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
  "tokenOut": "0x39f0B52190CeA4B3569D5D501f0c637892F52379"
}
```

**Response:**
```json
{
  "bestShard": {
    "name": "USDC/USDT-3",
    "c": 2000000,
    "amountIn": "...",
    "tradeFee": "..."
  },
  "allShards": [...],
  "property": "c-smaller-better demonstrated"
}
```

#### 5. Multi-Hop Routing
```bash
POST /api/swap/multi-hop
Content-Type: application/json

{
  "amountIn": "1000000",
  "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
  "tokenOut": "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46"
}
```

**Response:**
```json
{
  "route": "multi-hop",
  "path": ["USDC", "USDT", "DAI"],
  "amountIn": "1000000",
  "amountOut": "...",
  "steps": [
    {
      "from": "USDC",
      "to": "USDT",
      "shard": "USDC/USDT-1",
      "amountOut": "..."
    },
    {
      "from": "USDT",
      "to": "DAI",
      "shard": "USDT/DAI-1",
      "amountOut": "..."
    }
  ]
}
```

#### 6. Get Specific Shard
```bash
GET /api/shard/0x986e6AA143Ecf491FbB9FFbcFB1A61424af1BC1e
```

---

## 🌐 Frontend Integration

### JavaScript/TypeScript

```javascript
const API_URL = 'https://your-api-url.com';

// Initialize
async function init() {
  const deployment = await fetch(`${API_URL}/api/deployment`)
    .then(r => r.json());
  
  console.log('Factory:', deployment.factory);
  console.log('Tokens:', deployment.tokens);
  return deployment;
}

// Get all shards
async function getShards() {
  const data = await fetch(`${API_URL}/api/shards`)
    .then(r => r.json());
  
  console.log('Total shards:', data.total);
  return data.shards;
}

// Find best shard for swap
async function findBestShard(amountOut, tokenIn, tokenOut) {
  const data = await fetch(`${API_URL}/api/swap/best-shard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amountOut, tokenIn, tokenOut })
  }).then(r => r.json());
  
  console.log('Best shard:', data.bestShard.name);
  console.log('c value:', data.bestShard.c);
  return data;
}

// Multi-hop swap
async function multiHopSwap(amountIn, tokenIn, tokenOut) {
  const data = await fetch(`${API_URL}/api/swap/multi-hop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amountIn, tokenIn, tokenOut })
  }).then(r => r.json());
  
  console.log('Route:', data.path);
  console.log('Steps:', data.steps.length);
  return data;
}

// Example usage
async function demo() {
  const deployment = await init();
  
  // Swap 1 USDC to USDT (find best shard)
  const best = await findBestShard(
    '1000000', // 1 USDT
    deployment.tokens.USDC.address,
    deployment.tokens.USDT.address
  );
  
  // Multi-hop: 1 USDC -> DAI
  const route = await multiHopSwap(
    '1000000', // 1 USDC
    deployment.tokens.USDC.address,
    deployment.tokens.DAI.address
  );
}
```

### React Hook

```jsx
import { useState, useEffect } from 'react';

const API_URL = 'https://your-api-url.com';

function useSAMM() {
  const [deployment, setDeployment] = useState(null);
  const [shards, setShards] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [deployData, shardsData] = await Promise.all([
          fetch(`${API_URL}/api/deployment`).then(r => r.json()),
          fetch(`${API_URL}/api/shards`).then(r => r.json())
        ]);
        
        setDeployment(deployData);
        setShards(shardsData.shards);
      } catch (error) {
        console.error('Error loading SAMM data:', error);
      } finally {
        setLoading(false);
      }
    }
    
    load();
  }, []);

  const findBestShard = async (amountOut, tokenIn, tokenOut) => {
    const res = await fetch(`${API_URL}/api/swap/best-shard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountOut, tokenIn, tokenOut })
    });
    return await res.json();
  };

  const multiHopSwap = async (amountIn, tokenIn, tokenOut) => {
    const res = await fetch(`${API_URL}/api/swap/multi-hop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountIn, tokenIn, tokenOut })
    });
    return await res.json();
  };

  return {
    deployment,
    shards,
    loading,
    findBestShard,
    multiHopSwap
  };
}

// Usage in component
function SAMMApp() {
  const { deployment, shards, loading, findBestShard } = useSAMM();

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h1>SAMM DEX</h1>
      <p>Chain: {deployment.network}</p>
      <p>Shards: {shards.length}</p>
      
      <button onClick={() => findBestShard(
        '1000000',
        deployment.tokens.USDC.address,
        deployment.tokens.USDT.address
      )}>
        Find Best Shard
      </button>
    </div>
  );
}
```

---

## ✅ CORS Configuration

**Already configured!** No CORS issues:

```javascript
cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
})
```

---

## 🧪 Testing

### Automated Test
```bash
cd samm-evm
chmod +x test-latest-api.sh
./test-latest-api.sh http://localhost:3000
```

### Manual Tests
```bash
# Health
curl http://localhost:3000/health | jq

# Deployment
curl http://localhost:3000/api/deployment | jq

# Shards
curl http://localhost:3000/api/shards | jq

# Best shard
curl -X POST http://localhost:3000/api/swap/best-shard \
  -H "Content-Type: application/json" \
  -d '{
    "amountOut": "1000000",
    "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
    "tokenOut": "0x39f0B52190CeA4B3569D5D501f0c637892F52379"
  }' | jq

# Multi-hop
curl -X POST http://localhost:3000/api/swap/multi-hop \
  -H "Content-Type: application/json" \
  -d '{
    "amountIn": "1000000",
    "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
    "tokenOut": "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46"
  }' | jq
```

---

## 🎯 Features

### 1. Multi-Shard Architecture
- 6 shards across 2 pairs
- High liquidity (10M USDC/USDT, 60K USDT/DAI)
- Different c values for demonstration

### 2. c-smaller-better Property
- Smaller c = better rates
- API automatically finds best shard
- All shards compared and sorted

### 3. Multi-Hop Routing
- USDC → USDT → DAI
- Automatic path discovery
- Fee calculation across hops

### 4. Decimal Normalization
- Handles 6-decimal tokens (USDC, USDT)
- Handles 18-decimal tokens (DAI)
- Automatic conversion

---

## 📈 Monitoring

### Railway
- Dashboard: Built-in metrics
- Logs: Real-time streaming
- Alerts: Email notifications

### PM2
```bash
pm2 monit          # Real-time dashboard
pm2 logs samm-api  # View logs
pm2 status         # Check status
pm2 restart samm-api  # Restart
```

### Docker
```bash
docker logs -f samm-api     # Follow logs
docker stats samm-api       # Resource usage
docker restart samm-api     # Restart
```

---

## 🔧 Troubleshooting

### Port in use
```bash
lsof -i :3000
kill -9 <PID>
```

### Dependencies
```bash
cd services
rm -rf node_modules package-lock.json
npm install
```

### RPC issues
- Verify: https://testnet-rpc.monad.xyz
- Check network connectivity
- Try alternative RPC if available

---

## 💡 Best Practices

1. **Testing:** Start local first
2. **Demo:** Use Railway.app (free, fast)
3. **Production:** GCP Cloud Run or AWS ECS
4. **VPS:** PM2 with nginx reverse proxy
5. **Monitoring:** Set up health check alerts
6. **Logs:** Enable structured logging
7. **Security:** Use environment variables
8. **HTTPS:** Always use HTTPS in production

---

## 📝 Summary

✅ Latest deployment (v2-decimal-aware)  
✅ CORS pre-configured  
✅ 6 shards with high liquidity  
✅ Multi-hop routing  
✅ Decimal normalization  
✅ c-smaller-better demonstrated  
✅ Production-ready  
✅ Multiple deployment options  
✅ Frontend integration examples  

**Recommended:** Deploy to Railway.app for instant, free hosting!

---

## 🆘 Need Help?

1. Check logs first
2. Verify deployment data matches exactly
3. Test RPC connectivity
4. Ensure all dependencies installed
5. Check firewall/security groups

**All contract addresses are EXACT - do not modify!**
