# SAMM API - Production Deployment Guide

## 🚀 Quick Deploy (Choose One)

### Option 1: Local Test (30 seconds)
```bash
cd samm-evm
chmod +x PRODUCTION-DEPLOY.sh
./PRODUCTION-DEPLOY.sh
cd services
node production-server.js
```

Test it: `curl http://localhost:3000/health`

---

### Option 2: Railway.app (FREE - 2 minutes) ⭐ RECOMMENDED

**Why Railway?**
- ✅ Free tier available
- ✅ Auto-deploys from GitHub
- ✅ HTTPS URL provided
- ✅ Zero configuration
- ✅ Built-in monitoring

**Steps:**
1. Push your code to GitHub
2. Go to [railway.app](https://railway.app)
3. Click "New Project" → "Deploy from GitHub"
4. Select your repository
5. Railway auto-detects Node.js and deploys
6. Get your public URL: `https://your-app.railway.app`

**Environment Variables (Auto-detected):**
- Railway reads `.env.production` automatically
- No manual configuration needed!

---

### Option 3: Render.com (FREE - 3 minutes)

**Steps:**
1. Push code to GitHub
2. Go to [render.com](https://render.com)
3. Click "New" → "Web Service"
4. Connect your GitHub repo
5. Configure:
   - **Name:** samm-api
   - **Environment:** Node
   - **Build Command:** `cd services && npm install`
   - **Start Command:** `cd services && node production-server.js`
   - **Plan:** Free
6. Click "Create Web Service"
7. Get your URL: `https://samm-api.onrender.com`

---

### Option 4: Google Cloud Run (Serverless - 5 minutes)

```bash
cd samm-evm/services

# Build and deploy
gcloud run deploy samm-api \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 3000

# Get your URL
gcloud run services describe samm-api --region us-central1 --format 'value(status.url)'
```

**Cost:** Free tier includes 2 million requests/month

---

### Option 5: Docker (Any Platform)

```bash
cd samm-evm/services

# Build image
docker build -t samm-api .

# Run container
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

**Deploy to any cloud:**
- AWS ECS
- Azure Container Instances
- DigitalOcean App Platform
- Fly.io

---

### Option 6: PM2 (VPS/Server)

```bash
cd samm-evm/services

# Install PM2 globally
npm install -g pm2

# Install dependencies
npm install --production

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 config
pm2 save

# Setup auto-restart on reboot
pm2 startup

# Monitor
pm2 monit

# View logs
pm2 logs samm-api
```

---

## 📊 Deployment Data (Monad Testnet)

### Network
- **Chain:** Monad Testnet
- **Chain ID:** 10143
- **RPC:** https://testnet-rpc.monad.xyz

### Contracts
- **Factory:** `0x70fe868ac814CC197631B60eEEaEaa1553418D03`

### Tokens
- **USDC:** `0x67DcA5710a9dA091e00093dF04765d711759f435` (6 decimals)
- **USDT:** `0x1888FF2446f2542cbb399eD179F4d6d966268C1F` (6 decimals)
- **DAI:** `0x60CB213FCd1616FbBD44319Eb11A35d5671E692e` (18 decimals)

### Pools (6 Shards Total)

**USDC/USDT Shards:**
1. Shard-1 (100 liquidity): `0x686ff8090b18C0DF4f828f02deAf122CeC40B1DE`
2. Shard-2 (500 liquidity): `0x0481CD694F9C4EfC925C694f49835547404c0460`
3. Shard-3 (1000 liquidity): `0x49ac6067BB0b6d5b793e9F3af3CD78b3a108AA5a`

**USDT/DAI Shards:**
1. Shard-1 (100 liquidity): `0x20c893A2706a71695894b15A4C385a3710C213eb`
2. Shard-2 (500 liquidity): `0xe369Fe406ecB270b0F73C641260791C5A2edEB81`
3. Shard-3 (1000 liquidity): `0x4d3c19832713A7993d69870cB421586CBC36dceA`

---

## 🔌 API Endpoints

### Base URL
- Local: `http://localhost:3000`
- Production: `https://your-domain.com`

### Endpoints

#### Health Check
```bash
GET /health
```
Response:
```json
{
  "status": "healthy",
  "chain": "Monad Testnet",
  "chainId": 10143,
  "totalShards": 6
}
```

#### Get Deployment Info
```bash
GET /api/deployment
```

#### Get All Shards
```bash
GET /api/shards
```

#### Find Best Shard (c-smaller-better)
```bash
POST /api/swap/best-shard
Content-Type: application/json

{
  "amountOut": "1000000",
  "tokenIn": "0x67DcA5710a9dA091e00093dF04765d711759f435",
  "tokenOut": "0x1888FF2446f2542cbb399eD179F4d6d966268C1F"
}
```

#### Multi-Hop Routing (USDC → USDT → DAI)
```bash
POST /api/swap/multi-hop
Content-Type: application/json

{
  "amountIn": "1000000",
  "tokenIn": "0x67DcA5710a9dA091e00093dF04765d711759f435",
  "tokenOut": "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e"
}
```

#### Get Specific Shard
```bash
GET /api/shard/0x686ff8090b18C0DF4f828f02deAf122CeC40B1DE
```

---

## 🌐 Frontend Integration

### JavaScript/TypeScript Example

```javascript
const API_URL = 'https://your-api-url.com';

// Get deployment info
async function getDeployment() {
  const response = await fetch(`${API_URL}/api/deployment`);
  const data = await response.json();
  console.log('Deployment:', data);
  return data;
}

// Get all shards
async function getShards() {
  const response = await fetch(`${API_URL}/api/shards`);
  const data = await response.json();
  console.log('Shards:', data.shards);
  return data;
}

// Find best shard for swap
async function findBestShard(amountOut, tokenIn, tokenOut) {
  const response = await fetch(`${API_URL}/api/swap/best-shard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amountOut, tokenIn, tokenOut })
  });
  const data = await response.json();
  console.log('Best shard:', data.bestShard);
  return data;
}

// Multi-hop routing
async function multiHopSwap(amountIn, tokenIn, tokenOut) {
  const response = await fetch(`${API_URL}/api/swap/multi-hop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amountIn, tokenIn, tokenOut })
  });
  const data = await response.json();
  console.log('Multi-hop route:', data.path);
  return data;
}

// Example usage
async function demo() {
  // Get deployment
  const deployment = await getDeployment();
  
  // Get all shards
  const shards = await getShards();
  
  // Find best shard for USDC → USDT swap
  const best = await findBestShard(
    '1000000', // 1 USDT
    deployment.tokens.USDC.address,
    deployment.tokens.USDT.address
  );
  
  // Multi-hop: USDC → USDT → DAI
  const route = await multiHopSwap(
    '1000000', // 1 USDC
    deployment.tokens.USDC.address,
    deployment.tokens.DAI.address
  );
}
```

### React Example

```jsx
import { useState, useEffect } from 'react';

const API_URL = 'https://your-api-url.com';

function SAMMApp() {
  const [deployment, setDeployment] = useState(null);
  const [shards, setShards] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        // Load deployment info
        const deployRes = await fetch(`${API_URL}/api/deployment`);
        const deployData = await deployRes.json();
        setDeployment(deployData);

        // Load shards
        const shardsRes = await fetch(`${API_URL}/api/shards`);
        const shardsData = await shardsRes.json();
        setShards(shardsData.shards);
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  async function handleSwap(amountOut, tokenIn, tokenOut) {
    try {
      const response = await fetch(`${API_URL}/api/swap/best-shard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountOut, tokenIn, tokenOut })
      });
      const data = await response.json();
      console.log('Best shard:', data.bestShard);
      return data;
    } catch (error) {
      console.error('Swap error:', error);
    }
  }

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h1>SAMM DEX</h1>
      <p>Chain: {deployment?.network}</p>
      <p>Total Shards: {shards.length}</p>
      
      <div>
        {shards.map(shard => (
          <div key={shard.address}>
            <h3>{shard.name}</h3>
            <p>Liquidity: {shard.liquidity}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## ✅ CORS Configuration

**Already configured!** The API allows requests from any origin:

```javascript
cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
})
```

No CORS issues with your frontend! 🎉

---

## 🧪 Testing

### Test Script
```bash
cd samm-evm
chmod +x test-production-api.sh
./test-production-api.sh http://localhost:3000
```

### Manual Tests
```bash
# Health check
curl http://localhost:3000/health

# Get deployment
curl http://localhost:3000/api/deployment | jq

# Get shards
curl http://localhost:3000/api/shards | jq

# Best shard
curl -X POST http://localhost:3000/api/swap/best-shard \
  -H "Content-Type: application/json" \
  -d '{
    "amountOut": "1000000",
    "tokenIn": "0x67DcA5710a9dA091e00093dF04765d711759f435",
    "tokenOut": "0x1888FF2446f2542cbb399eD179F4d6d966268C1F"
  }' | jq
```

---

## 🎯 Features Demonstrated

### 1. Multi-Shard Architecture
- 6 shards across 2 pairs
- Different liquidity levels (100, 500, 1000)

### 2. c-smaller-better Property
- Smaller shards provide better rates
- API automatically finds best shard

### 3. Multi-Hop Routing
- USDC → USDT → DAI routing
- Automatic path discovery
- Fee calculation across hops

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
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Dependencies Issues
```bash
cd services
rm -rf node_modules package-lock.json
npm install
```

### RPC Connection Issues
- Check Monad RPC: https://testnet-rpc.monad.xyz
- Verify network connectivity
- Check firewall settings

---

## 💡 Recommendations

1. **For Testing:** Use local deployment
2. **For Demo:** Use Railway.app (free, fast, easy)
3. **For Production:** Use GCP Cloud Run or AWS ECS
4. **For VPS:** Use PM2 with nginx reverse proxy

---

## 🆘 Support

If you encounter issues:
1. Check the logs
2. Verify deployment data matches Monad testnet
3. Test RPC connectivity
4. Ensure CORS is enabled

---

## 📝 Summary

✅ Zero-friction deployment  
✅ CORS pre-configured  
✅ Exact Monad deployment data  
✅ Multiple deployment options  
✅ Production-ready  
✅ Frontend integration examples  

**Recommended:** Deploy to Railway.app for instant, free hosting with HTTPS!
