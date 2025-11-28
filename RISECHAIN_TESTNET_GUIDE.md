# SAMM RiseChain Testnet Deployment Guide

This guide covers deploying SAMM (Sharded Automated Market Maker) to RiseChain testnet.

## Quick Start

### 1. Setup Environment

Create `.env` file:
```bash
cp .env.example .env
```

Configure required variables:
```env
PRIVATE_KEY=your_private_key_without_0x_prefix
RISECHAIN_RPC_URL=https://testnet-rpc.risechain.net
```

### 2. Get Testnet Tokens

Visit RISE testnet faucet and request tokens for your deployer address.
You need at least **1.0 ETH** for deployment.

### 3. Validate Setup

```bash
npm run validate:setup:risechain
```

This checks:
- Environment variables
- Network connectivity  
- Deployer balance
- Gas estimation

### 4. Deploy SAMM

```bash
npm run deploy:risechain:testnet
```

## What Gets Deployed

The deployment script creates:

1. **SAMM Pool Factory** - Main factory contract for creating shards
2. **Test Tokens** - ERC20 tokens for testing (RTESTA, RTESTB)
3. **Test Shard** - Sample shard with SAMM parameters
4. **Initial Liquidity** - 10,000 tokens each for testing

## SAMM Parameters

All deployments use research paper parameters:

| Parameter | Value | Description |
|-----------|-------|-------------|
| β1 | -1.05 | Fee curve slope |
| rmin | 0.001 | Min fee rate (0.1%) |
| rmax | 0.012 | Max fee rate (1.2%) |
| c | 0.0104 | C-threshold |

## Verification

After deployment:

1. **Contract addresses** are displayed and saved to `deployments/`
2. **SAMM parameters** are automatically verified
3. **Test swap** is executed to confirm functionality
4. **Block explorer links** are provided (if available)

## Troubleshooting

### Insufficient Balance
```
Error: Insufficient balance. Need X.XX more ETH
```
**Solution**: Get more testnet tokens from RISE testnet faucet

### Connection Failed
```
Error: Connection failed: network timeout
```
**Solution**: Check RISECHAIN_RPC_URL in .env file

### Gas Estimation Failed
```
Warning: Gas estimation failed
```
**Solution**: Usually safe to ignore - deployment uses default gas settings

## Next Steps

After successful deployment:

1. **Verify contracts** on RiseChain testnet explorer
2. **Deploy backend services** (router, liquidity router)
3. **Test cross-pool routing**
4. **Deploy to Monad testnet**

## Network Details

- **Network**: RISE Testnet
- **Chain ID**: 11155931
- **Native Token**: ETH
- **RPC URL**: https://testnet-rpc.risechain.net
- **Explorer**: https://explorer.testnet.riselabs.xyz

## Support

For deployment issues:
1. Run validation script first
2. Check deployment logs in `deployments/` folder
3. Verify network connectivity and balance
4. Review error messages for specific guidance

## Example Output

```
🚀 Starting SAMM EVM Deployment to RiseChain Testnet
============================================================
📋 Deployment Details:
Network: RISE Testnet (Chain ID: 11155931)
Deployer: 0x1234...5678

💳 Validating deployer balance...
Current Balance: 2.5 ETH
Required Balance: 1.0 ETH
✅ Balance sufficient for deployment

🔧 Deploying Contracts...

1️⃣ Deploying SAMM Pool Factory...
✅ SAMM Factory deployed: 0xabcd...ef01

2️⃣ Deploying test tokens...
✅ Test Token A: 0x1111...2222
✅ Test Token B: 0x3333...4444

3️⃣ Creating test shard...
✅ Test Shard created: 0x5555...6666

4️⃣ Verifying SAMM parameters...
✅ All SAMM parameters verified successfully

5️⃣ Initializing test shard with liquidity...
✅ Shard initialized with 10000.0 tokens each

6️⃣ Testing SAMM swap functionality...
✅ Test swap executed successfully

🎉 RiseChain Testnet Deployment Complete!
```