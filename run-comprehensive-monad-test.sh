#!/bin/bash

echo "🚀 Starting Comprehensive Monad SAMM Testing"
echo "============================================="

# Navigate to samm-evm directory
cd "$(dirname "$0")"

# Backup current .env and use Monad configuration
echo "📝 Configuring for Monad testnet (oldest deployment)..."
if [ -f .env ]; then
    cp .env .env.backup
fi
cp .env.monad .env

echo "✅ Environment configured for Monad testnet"
echo "📊 Using deployment: monad-multi-shard-1764330063991.json"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start the multi-shard backend in background
echo "🔧 Starting multi-shard backend..."
node services/src/multi-shard-backend.js &
BACKEND_PID=$!

# Wait for backend to start
echo "⏳ Waiting for backend to initialize..."
sleep 10

# Check if backend is running
if curl -s http://localhost:3000/health > /dev/null; then
    echo "✅ Backend is running on port 3000"
else
    echo "❌ Backend failed to start"
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi

# Run comprehensive tests
echo ""
echo "🧪 Running comprehensive tests..."
echo "================================="

# Test 1: API Tests
echo "📡 Testing all APIs..."
node test-comprehensive-monad-execution.js

# Test 2: Add liquidity to all pools
echo ""
echo "💧 Adding liquidity to all Monad pools..."
node scripts/add-massive-liquidity-monad.js

# Test 3: Test multi-hop swaps specifically
echo ""
echo "🔀 Testing multi-hop swaps..."
curl -X POST http://localhost:3000/api/swap/cross-pool \
  -H "Content-Type: application/json" \
  -d '{
    "amountIn": "1000000",
    "tokenIn": "0x1888FF2446f2542cbb399eD179F4d6d966268C1F",
    "tokenOut": "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e"
  }' | jq '.'

# Test 4: Verify C-smaller-better property
echo ""
echo "📊 Testing C-smaller-better property..."
curl -X POST http://localhost:3000/api/swap/best-shard \
  -H "Content-Type: application/json" \
  -d '{
    "amountOut": "100000",
    "tokenIn": "0x67DcA5710a9dA091e00093dF04765d711759f435",
    "tokenOut": "0x1888FF2446f2542cbb399eD179F4d6d966268C1F"
  }' | jq '.'

# Test 5: Get all shards info
echo ""
echo "📋 Getting all shards information..."
curl -s http://localhost:3000/api/shards | jq '.'

# Test 6: Health check
echo ""
echo "🏥 Final health check..."
curl -s http://localhost:3000/health | jq '.'

echo ""
echo "🎉 All tests completed!"
echo "======================="

# Cleanup
echo "🧹 Cleaning up..."
kill $BACKEND_PID 2>/dev/null

# Restore original .env if it existed
if [ -f .env.backup ]; then
    mv .env.backup .env
    echo "✅ Original environment restored"
fi

echo "✅ Comprehensive Monad testing complete!"
echo ""
echo "📊 Check the generated report files for detailed results:"
echo "   - comprehensive-monad-test-report-*.json"
echo ""
echo "🔍 Key things tested:"
echo "   ✓ All API endpoints"
echo "   ✓ Liquidity additions to all 5 shards"
echo "   ✓ Direct swaps on all shards"
echo "   ✓ Multi-hop swaps (USDT->DAI via USDC)"
echo "   ✓ C-smaller-better property demonstration"
echo "   ✓ Cross-pool routing"