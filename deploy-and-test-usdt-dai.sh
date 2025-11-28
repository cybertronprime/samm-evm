#!/bin/bash

# Deploy and Test USDT/DAI Pools
# This script runs the complete deployment and testing process

set -e  # Exit on error

echo "🚀 USDT/DAI Pool Deployment and Testing"
echo "========================================"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found"
    echo "Please create .env file with PRIVATE_KEY"
    exit 1
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Step 1: Deploy
echo "📋 Step 1: Deploying USDT/DAI Pools"
echo "------------------------------------"
node scripts/deploy-usdt-dai-pools-clean.js
if [ $? -ne 0 ]; then
    echo "❌ Deployment failed"
    exit 1
fi
echo ""
echo "✅ Deployment completed"
echo ""

# Wait a bit for blockchain to settle
echo "⏳ Waiting 5 seconds for blockchain to settle..."
sleep 5
echo ""

# Step 2: Verify
echo "📋 Step 2: Verifying Deployment"
echo "--------------------------------"
node scripts/verify-usdt-dai-deployment.js
if [ $? -ne 0 ]; then
    echo "❌ Verification failed"
    exit 1
fi
echo ""
echo "✅ Verification completed"
echo ""

# Wait a bit before testing
echo "⏳ Waiting 5 seconds before testing..."
sleep 5
echo ""

# Step 3: Test
echo "📋 Step 3: Testing Swaps"
echo "------------------------"
node scripts/test-usdt-dai-swaps.js
if [ $? -ne 0 ]; then
    echo "❌ Testing failed"
    exit 1
fi
echo ""
echo "✅ Testing completed"
echo ""

# Summary
echo "========================================"
echo "🎉 All Steps Completed Successfully!"
echo "========================================"
echo ""
echo "📄 Check deployment-data/ for deployment details"
echo "📖 See USDT-DAI-DEPLOYMENT-COMPLETE.md for full documentation"
echo ""
