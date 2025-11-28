#!/bin/bash

# Test Production API
# Run this after starting the server to verify everything works

API_URL="${1:-http://localhost:3000}"

echo "🧪 Testing SAMM API at $API_URL"
echo "=================================="
echo ""

# Test 1: Health Check
echo "1️⃣  Testing health endpoint..."
curl -s "$API_URL/health" | jq '.' || echo "❌ Health check failed"
echo ""

# Test 2: Root endpoint
echo "2️⃣  Testing root endpoint..."
curl -s "$API_URL/" | jq '.name, .version, .chain' || echo "❌ Root endpoint failed"
echo ""

# Test 3: Deployment info
echo "3️⃣  Testing deployment endpoint..."
curl -s "$API_URL/api/deployment" | jq '.network, .chainId, .stats' || echo "❌ Deployment endpoint failed"
echo ""

# Test 4: Get all shards
echo "4️⃣  Testing shards endpoint..."
curl -s "$API_URL/api/shards" | jq '.total, .shards[0].name' || echo "❌ Shards endpoint failed"
echo ""

# Test 5: Best shard
echo "5️⃣  Testing best shard endpoint..."
curl -s -X POST "$API_URL/api/swap/best-shard" \
  -H "Content-Type: application/json" \
  -d '{
    "amountOut": "1000000",
    "tokenIn": "0x67DcA5710a9dA091e00093dF04765d711759f435",
    "tokenOut": "0x1888FF2446f2542cbb399eD179F4d6d966268C1F"
  }' | jq '.bestShard.name, .property' || echo "❌ Best shard endpoint failed"
echo ""

# Test 6: Multi-hop
echo "6️⃣  Testing multi-hop endpoint..."
curl -s -X POST "$API_URL/api/swap/multi-hop" \
  -H "Content-Type: application/json" \
  -d '{
    "amountIn": "1000000",
    "tokenIn": "0x67DcA5710a9dA091e00093dF04765d711759f435",
    "tokenOut": "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e"
  }' | jq '.route, .path' || echo "❌ Multi-hop endpoint failed"
echo ""

# Test 7: Specific shard
echo "7️⃣  Testing specific shard endpoint..."
curl -s "$API_URL/api/shard/0x686ff8090b18C0DF4f828f02deAf122CeC40B1DE" | jq '.name, .pair' || echo "❌ Specific shard endpoint failed"
echo ""

echo "✅ All tests complete!"
echo ""
echo "Frontend Integration Example:"
echo "=============================="
echo ""
echo "const API_URL = '$API_URL';"
echo ""
echo "// Get deployment info"
echo "const deployment = await fetch(\`\${API_URL}/api/deployment\`).then(r => r.json());"
echo ""
echo "// Get all shards"
echo "const shards = await fetch(\`\${API_URL}/api/shards\`).then(r => r.json());"
echo ""
echo "// Find best shard"
echo "const best = await fetch(\`\${API_URL}/api/swap/best-shard\`, {"
echo "  method: 'POST',"
echo "  headers: { 'Content-Type': 'application/json' },"
echo "  body: JSON.stringify({"
echo "    amountOut: '1000000',"
echo "    tokenIn: '0x67DcA5710a9dA091e00093dF04765d711759f435',"
echo "    tokenOut: '0x1888FF2446f2542cbb399eD179F4d6d966268C1F'"
echo "  })"
echo "}).then(r => r.json());"
echo ""
