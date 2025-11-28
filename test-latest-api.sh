#!/bin/bash

# Test Latest SAMM API (v2-decimal-aware)

API_URL="${1:-http://localhost:3000}"

echo "🧪 Testing SAMM API (Latest Deployment)"
echo "========================================"
echo "API URL: $API_URL"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    
    echo -n "Testing $name... "
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s "$API_URL$endpoint")
    else
        response=$(curl -s -X POST "$API_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi
    
    if [ $? -eq 0 ] && [ ! -z "$response" ]; then
        echo -e "${GREEN}✓${NC}"
        echo "$response" | jq '.' 2>/dev/null || echo "$response"
    else
        echo -e "${RED}✗${NC}"
    fi
    echo ""
}

# Test 1: Health Check
test_endpoint "Health Check" "GET" "/health"

# Test 2: Root Endpoint
test_endpoint "Root Endpoint" "GET" "/"

# Test 3: Deployment Info
test_endpoint "Deployment Info" "GET" "/api/deployment"

# Test 4: All Shards
test_endpoint "All Shards" "GET" "/api/shards"

# Test 5: Best Shard (USDC/USDT)
echo "Testing Best Shard (USDC/USDT)..."
curl -s -X POST "$API_URL/api/swap/best-shard" \
  -H "Content-Type: application/json" \
  -d '{
    "amountOut": "1000000",
    "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
    "tokenOut": "0x39f0B52190CeA4B3569D5D501f0c637892F52379"
  }' | jq '.'
echo ""

# Test 6: Multi-Hop (USDC -> USDT -> DAI)
echo "Testing Multi-Hop (USDC → USDT → DAI)..."
curl -s -X POST "$API_URL/api/swap/multi-hop" \
  -H "Content-Type: application/json" \
  -d '{
    "amountIn": "1000000",
    "tokenIn": "0x9153bc242a5FD22b149B1cb252e3eE6314C37366",
    "tokenOut": "0xccA96CacCd9785f32C1ea02D688bc013D43D9f46"
  }' | jq '.'
echo ""

# Test 7: Specific Shard
echo "Testing Specific Shard..."
curl -s "$API_URL/api/shard/0x986e6AA143Ecf491FbB9FFbcFB1A61424af1BC1e" | jq '.'
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All tests complete!"
echo ""
echo "📋 Frontend Integration Example:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
cat << 'EOFJS'
// Frontend Integration Example
const API_URL = 'YOUR_API_URL';

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

// Find best shard for swap
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

// Example: Swap 1 USDC to USDT (find best shard)
const deployment = await getDeployment();
const best = await findBestShard(
  '1000000', // 1 USDT (6 decimals)
  deployment.tokens.USDC.address,
  deployment.tokens.USDT.address
);
console.log('Best shard:', best.bestShard.name);
console.log('Amount in:', best.bestShard.amountIn);

// Example: Multi-hop USDC -> DAI
const route = await multiHopSwap(
  '1000000', // 1 USDC (6 decimals)
  deployment.tokens.USDC.address,
  deployment.tokens.DAI.address
);
console.log('Route:', route.path); // ['USDC', 'USDT', 'DAI']
console.log('Final amount:', route.amountOut);
EOFJS
echo ""
