#!/bin/bash

# SAMM API - One Command Deployment
# Latest deployment with decimal normalization

set -e

echo "🚀 SAMM API - Quick Deploy"
echo "=========================="
echo ""

# Check if in correct directory
if [ ! -d "services" ]; then
    echo "❌ Error: Run this from samm-evm directory"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "services/node_modules" ]; then
    echo "📦 Installing dependencies..."
    cd services
    npm install --production
    cd ..
fi

# Create production env
cat > services/.env.production << 'EOF'
NODE_ENV=production
PORT=3000
CORS_ORIGIN=*
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
MONAD_CHAIN_ID=10143
LOG_LEVEL=info
EOF

echo "✅ Setup complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 LATEST DEPLOYMENT (v2-decimal-aware)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Factory: 0x8ab2De0CD1C3bcAe3cB9a8028E28D60301dBf336"
echo ""
echo "Tokens:"
echo "  USDC: 0x9153bc242a5FD22b149B1cb252e3eE6314C37366 (6 decimals)"
echo "  USDT: 0x39f0B52190CeA4B3569D5D501f0c637892F52379 (6 decimals)"
echo "  DAI:  0xccA96CacCd9785f32C1ea02D688bc013D43D9f46 (18 decimals)"
echo ""
echo "Pools:"
echo "  USDC/USDT: 3 shards (10M liquidity)"
echo "    - Shard-1: 0x986e6AA143Ecf491FbB9FFbcFB1A61424af1BC1e (5M)"
echo "    - Shard-2: 0xA68065D56C003D6982a6215Bd1C765726b2fCa13 (3M)"
echo "    - Shard-3: 0x58136Bb18639C7C3f2C552Bb734dA6D65Ff7D653 (2M)"
echo ""
echo "  USDT/DAI: 3 shards (60K liquidity)"
echo "    - Shard-1: 0x179e0308524c916a6F0452FF0ce999cEC88588e8 (10K)"
echo "    - Shard-2: 0x40767849365ff64F9EB341eD2Cf3E40590578749 (20K)"
echo "    - Shard-3: 0x302bB8B9Cf5722a2C69B19D98393041E007085Eb (30K)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎯 START SERVER:"
echo ""
echo "   cd services && node production-server-latest.js"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🧪 TEST ENDPOINTS:"
echo ""
echo "   curl http://localhost:3000/health"
echo "   curl http://localhost:3000/api/deployment"
echo "   curl http://localhost:3000/api/shards"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "☁️  DEPLOY TO CLOUD:"
echo ""
echo "   Railway.app (FREE):"
echo "     1. Push to GitHub"
echo "     2. Connect at railway.app"
echo "     3. Set start command: cd services && node production-server-latest.js"
echo ""
echo "   Render.com (FREE):"
echo "     1. Push to GitHub"
echo "     2. Connect at render.com"
echo "     3. Build: cd services && npm install"
echo "     4. Start: cd services && node production-server-latest.js"
echo ""
echo "   Docker:"
echo "     docker build -t samm-api services/"
echo "     docker run -p 3000:3000 samm-api"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
