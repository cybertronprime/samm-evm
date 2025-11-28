# SAMM EVM Sepolia Testnet Deployment Guide

This guide provides step-by-step instructions for deploying and testing the enhanced SAMM EVM implementation on Sepolia testnet.

## 🚀 Quick Start

### Prerequisites

1. **Node.js** (v16 or higher)
2. **Sepolia ETH** (at least 0.1 ETH for deployment)
3. **RPC Provider** (Infura, Alchemy, or similar)
4. **Private Key** of account with Sepolia ETH

### Setup

1. **Clone and Install Dependencies**
   ```bash
   cd samm-evm
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Set Environment Variables**
   ```bash
   # Required
   SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID
   PRIVATE_KEY=your_private_key_without_0x_prefix
   
   # Optional
   ETHERSCAN_API_KEY=your_etherscan_api_key
   ```

### Deployment

1. **Compile Contracts**
   ```bash
   npm run compile
   ```

2. **Deploy to Sepolia**
   ```bash
   npm run deploy:sepolia
   ```

3. **Test Deployment**
   ```bash
   npm run test:sepolia
   ```

## 📋 Detailed Deployment Process

### Step 1: Pre-Deployment Validation

The deployment script will automatically:
- ✅ Check deployer balance (minimum 0.1 ETH required)
- ✅ Verify network connection
- ✅ Validate contract compilation

### Step 2: Contract Deployment

The script deploys in this order:
1. **Mock Tokens** (Test Token A & B)
2. **SAMM Pool Factory**
3. **Test Shard** (using factory)

### Step 3: Initialization

After deployment:
1. **Mint Test Tokens** (1M tokens each)
2. **Approve Tokens** for shard
3. **Initialize Shard** with liquidity (10K tokens each)

### Step 4: Validation

The deployment includes automatic validation:
- ✅ SAMM parameters verification
- ✅ Test swap execution
- ✅ Reserve state verification

## 🧪 Comprehensive Testing

### Test Coverage

The test script validates:

1. **SAMM Parameters**
   - β1 = -1.05 × 10⁶
   - rmin = 0.001 × 10⁶  
   - rmax = 0.012 × 10⁶
   - c = 0.0104 × 10⁶

2. **Pool State**
   - Reserve balances
   - Total supply
   - Liquidity presence

3. **Fee Calculation**
   - Small trades (1 token)
   - Medium trades (10 tokens)
   - Large trades (50 tokens)

4. **C-Threshold Validation**
   - Accepts trades ≤ c-threshold
   - Rejects trades > c-threshold

5. **Multi-Shard Support**
   - Creates multiple shards
   - Tracks shard count

6. **Swap Execution**
   - Real token transfers
   - Exact output amounts
   - Fee collection

7. **Parameter Management**
   - Owner-only updates
   - Validation constraints

8. **Gas Analysis**
   - Shard creation cost
   - Swap execution cost
   - View function cost

### Expected Results

✅ **All tests should pass with these characteristics:**

- **SAMM Fee Formula**: Correctly implements research paper formula
- **C-Threshold**: Enforces OA/RA ≤ 0.0104 constraint
- **Multi-Shard**: Supports multiple shards per token pair
- **Gas Efficiency**: Reasonable gas costs for all operations

## 📊 Sample Output

### Successful Deployment
```
🚀 Starting SAMM EVM Deployment to Sepolia Testnet
============================================================
📋 Deployment Details:
Network: sepolia (Chain ID: 11155111)
Deployer: 0x1234...5678
Balance: 0.5 ETH

🔧 Deploying Contracts...

1️⃣ Deploying Mock Tokens...
✅ Token A deployed: 0xabc...def
✅ Token B deployed: 0x123...456

2️⃣ Deploying SAMM Pool Factory...
✅ SAMM Factory deployed: 0x789...abc

3️⃣ Creating Test Shard...
✅ Test Shard created: 0xdef...123

4️⃣ Minting Test Tokens...
✅ Minted 1000000.0 tokens each

5️⃣ Approving Tokens...
✅ Tokens approved for shard

6️⃣ Initializing Shard with Liquidity...
✅ Shard initialized with 10000.0 tokens each

7️⃣ Verifying SAMM Parameters...
✅ SAMM Parameters:
   β1: -1050000 (-1.05 * 1e6)
   rmin: 1000 (0.001 * 1e6)
   rmax: 12000 (0.012 * 1e6)
   c: 10400 (0.0104 * 1e6)

8️⃣ Testing SAMM Swap...
📊 Swap Calculation (10.0 Token B):
   Amount In: 10.109500000000000000 Token A
   Trade Fee: 0.109500000000000000 Token A
   Owner Fee: 0.500000000000000000 Token A
✅ Test swap executed successfully

📈 Pool Reserves After Swap:
   Token A: 10010.109500000000000000
   Token B: 9990.0

🎉 Deployment Complete!
```

### Successful Testing
```
🧪 Testing SAMM EVM Deployment on Sepolia
============================================================

🔍 Running Comprehensive Tests...

1️⃣ Testing SAMM Parameters...
   β1: -1050000 (expected: -1050000) ✅
   rmin: 1000 (expected: 1000) ✅
   rmax: 12000 (expected: 12000) ✅
   c: 10400 (expected: 10400) ✅

2️⃣ Testing Pool State...
   Reserve A: 10010.1095
   Reserve B: 9990.0
   Total Supply: 9999.0
   ✅ Pool has liquidity

3️⃣ Testing SAMM Fee Calculation...
   1.0 tokens: fee=0.01095 (109bp) ✅
   10.0 tokens: fee=0.1095 (109bp) ✅
   50.0 tokens: fee=0.5475 (109bp) ✅

4️⃣ Testing C-Threshold Validation...
   C-threshold amount: 104.104104104104104104
   ✅ C-threshold validation working - rejected trade exceeding threshold

5️⃣ Testing Multi-Shard Creation...
   Shards before: 1
   Shards after: 2
   ✅ Multi-shard creation working

6️⃣ Testing Swap Execution...
   Requested: 5.0
   Received: 5.0
   ✅ Swap execution successful

7️⃣ Testing Parameter Updates...
   ✅ Parameter update successful

8️⃣ Analyzing Gas Usage...
   Create Shard: ~2,847,234 gas
   SAMM Swap: ~127,456 gas
   Calculate Swap: ~45,123 gas

🎉 Testing Complete!
```

## 🔗 Verification

### Etherscan Verification

After deployment, verify contracts on Etherscan:

1. **Factory Contract**: Check deployment and initialization
2. **Test Shard**: Verify SAMM parameters and liquidity
3. **Token Contracts**: Confirm mint and transfer operations

### Manual Verification

You can manually verify the deployment by:

1. **Check Contract Addresses**: All contracts deployed successfully
2. **Verify SAMM Parameters**: Match research paper specifications
3. **Test Swaps**: Execute small test swaps
4. **Check Events**: Verify proper event emission

## 🚨 Troubleshooting

### Common Issues

1. **Insufficient Balance**
   ```
   Error: Insufficient ETH balance. Need at least 0.1 ETH for deployment.
   ```
   **Solution**: Add more Sepolia ETH to your account

2. **RPC Connection Failed**
   ```
   Error: could not detect network
   ```
   **Solution**: Check SEPOLIA_RPC_URL in .env file

3. **Private Key Issues**
   ```
   Error: invalid private key
   ```
   **Solution**: Ensure private key is correct (without 0x prefix)

4. **Gas Estimation Failed**
   ```
   Error: cannot estimate gas
   ```
   **Solution**: Check contract compilation and network connection

### Getting Sepolia ETH

1. **Sepolia Faucet**: https://sepoliafaucet.com/
2. **Alchemy Faucet**: https://sepoliafaucet.com/
3. **Infura Faucet**: https://www.infura.io/faucet/sepolia

## 📁 Output Files

The deployment creates several files:

```
samm-evm/
├── deployments/
│   └── sepolia-{timestamp}.json     # Deployment info
├── test-reports/
│   └── sepolia-test-{timestamp}.json # Test results
└── artifacts/                       # Compiled contracts
```

## 🎯 Success Criteria

✅ **Deployment is successful when:**

1. All contracts deploy without errors
2. SAMM parameters match research paper
3. Test swaps execute correctly
4. C-threshold validation works
5. Multi-shard creation functions
6. Gas costs are reasonable
7. All tests pass

## 🔄 Next Steps

After successful Sepolia deployment:

1. **Deploy to Monad/RiseChain**: Use similar scripts for production chains
2. **Integrate with Router**: Connect to cross-pool routing services
3. **Frontend Integration**: Build UI for SAMM interactions
4. **Monitoring Setup**: Implement real-time monitoring
5. **Security Audit**: Conduct professional security review

---

**Ready to deploy? Run `npm run deploy:sepolia` to get started!** 🚀