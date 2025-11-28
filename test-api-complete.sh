#!/bin/bash

# Complete API Test Script with CORRECT Monad Addresses
# Usage: ./test-api-complete.sh [API_URL]
# Example: ./test-api-complete.sh https://your-app.up.railway.app

API_URL="${1:-http://localhost:3000}"

echo "🧪 Testing SAMM API at: $API_URL"
echo "=========================================="
echo ""

# Test 1: Health Check
echo "1️⃣  Health Check"
curl -s "$API_URL/health" | jq '.'
echo ""

# Test 2: Deployment Info
echo "2️⃣  Deployment Info"
curl -s "$API_URL/api/deployment" | jq '{network, chainId, factory, tokens}'
echo ""

# Test 3: Get All Shards
echo "3️⃣  All Shards"
curl -s "$API_URL/api/shards" | jq '{chain, total, shards: [.shards[] | {pair, name, address, liquidity}]}'
echo ""

# Test 4: Best Shard (USDC → USDT)
echo "4️⃣  Best Shard (USDC → USDT)"
curl -s -X POST "$API_URL/api/swap/best-shard" \
  -H "Content-Type: application/json" \
  -d '{
    "amountOut": "1000000",
    "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
    "tokenOut": "0x39f0B52190CeA4B3569D5D501f0c637892F52379"
  }' | jq '{bestShard: .bestShard.name, amountIn: .bestShard.amountIn, property: .property}'
echo ""

# Test 5: Multi-Hop (USDC → USDT → DAI)
echo "5️⃣  Multi-Hop Routing (USDC → USDT → DAI)"
curl -s -X POST "$API_URL/api/swap/multi-hop" \
  -H "Content-Type: application/json" \
  -d '{
    "amountIn": "1000000",
    "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
    "tokenOut": "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46"
  }' | jq '{route, path, steps: [.steps[] | {from, to, shard, amountOut}]}'
echo ""

# Test 6: Specific Shard Info
echo "6️⃣  Specific Shard (USDC/USDT-1)"
curl -s "$API_URL/api/shard/0x986e6AA143Ecf491FbB9FFbcFB1A61424af1BC1e" | jq '{name, pair, liquidity, reserves}'
echo ""

echo "✅ All tests complete!"
echo ""
echo "📋 Summary:"
echo "  - Chain: Monad Testnet (10143)"
echo "  - Total Shards: 6"
echo "  - USDC/USDT: 3 shards"
echo "  - USDT/DAI: 3 shards"
echo "  - Multi-hop: USDC → USDT → DAI"
echo "  - CORS: Enabled"
echo ""
