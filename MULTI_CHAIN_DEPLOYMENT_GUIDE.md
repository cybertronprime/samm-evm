# SAMM Multi-Chain Deployment Guide

This guide covers deploying the SAMM (Sharded Automated Market Maker) system across multiple EVM-compatible chains: Ethereum Sepolia (testnet), Monad, and RiseChain.

## Overview

The multi-chain deployment infrastructure provides:
- **Chain-specific configurations** for gas settings, RPC endpoints, and SAMM parameters
- **Automated balance validation** before deployment
- **Gas cost estimation** for each network
- **Unified deployment orchestration** across multiple chains
- **Comprehensive validation** and reporting

## Supported Networks

| Network | Chain ID | Type | Native Token | Purpose |
|---------|----------|------|--------------|---------|
| Ethereum Sepolia | 11155111 | Testnet | ETH | Primary testing and validation |
| Monad Testnet | 41455 | Testnet | MON | Monad testing |
| RiseChain Testnet | 5678 | Testnet | RISE | RiseChain testing |

*Note: All deployments use testnets for safe validation before mainnet*

## Prerequisites

### 1. Environment Setup

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Configure the following variables:

```env
# Required: Private key for deployment wallet
PRIVATE_KEY=your_private_key_without_0x_prefix

# Network RPC URLs
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID
MONAD_RPC_URL=https://rpc.monad.xyz
RISECHAIN_RPC_URL=https://rpc.risechain.net

# Optional: Block explorer API keys for verification
ETHERSCAN_API_KEY=your_etherscan_api_key
MONAD_API_KEY=your_monad_explorer_api_key
RISECHAIN_API_KEY=your_risechain_explorer_api_key
```

### 2. Wallet Funding

Ensure your deployment wallet has sufficient native tokens:

| Network | Minimum Required | Recommended |
|---------|------------------|-------------|
| Sepolia | 0.1 ETH | 0.2 ETH |
| Monad Testnet | 0.5 MON | 1.0 MON |
| RiseChain Testnet | 1.0 RISE | 2.0 RISE |

### 3. Dependencies

Install required dependencies:

```bash
npm install
```

## Deployment Scripts

### 1. Validation and Estimation

Before deployment, validate your setup:

```bash
# Validate all networks
node scripts/validate-multi-chain-setup.js

# Validate specific network
node scripts/validate-multi-chain-setup.js sepolia

# Estimate gas costs for all networks
node scripts/estimate-gas.js

# Estimate gas for specific network
node scripts/estimate-gas.js monad
```

### 2. Single Network Deployment

Deploy to a specific network:

```bash
# Deploy to Sepolia testnet
npx hardhat run scripts/deploy-sepolia.js --network sepolia

# Deploy to Monad testnet
npx hardhat run scripts/deploy-monad.js --network monad

# Deploy to RiseChain testnet
npx hardhat run scripts/deploy-risechain.js --network risechain
```

### 3. Multi-Chain Deployment

Deploy to multiple networks using the orchestrator:

```bash
# Deploy to all networks
node scripts/deploy-multi-chain.js all

# Deploy to specific networks
node scripts/deploy-multi-chain.js sepolia
node scripts/deploy-multi-chain.js monad

# Deploy with options
node scripts/deploy-multi-chain.js all --continue-on-error --skip-preflight
```

#### Deployment Options

- `--skip-validation`: Skip balance validation
- `--skip-preflight`: Skip pre-flight checks
- `--continue-on-error`: Continue deployment even if some networks fail
- `--no-test-tokens`: Skip test token deployment

## Configuration Files

### Chain Configuration (`config/chains.json`)

Contains network-specific settings:

```json
{
  "sepolia": {
    "chainId": 11155111,
    "name": "Ethereum Sepolia Testnet",
    "gasSettings": {
      "gasPrice": "auto",
      "gasLimit": 8000000
    },
    "deploymentConfig": {
      "minBalance": "0.1",
      "confirmations": 2
    },
    "sammParameters": {
      "beta1": -1050000,
      "rmin": 1000,
      "rmax": 12000,
      "c": 10400
    }
  }
}
```

### Deployment Configuration (`config/deployment-config.js`)

Provides utilities for:
- Environment validation
- Gas cost estimation
- Balance checking
- Provider creation

## SAMM Parameters

All networks use identical SAMM parameters from the research paper:

| Parameter | Value | Description |
|-----------|-------|-------------|
| β1 | -1.05 | Fee curve slope parameter |
| rmin | 0.001 | Minimum fee rate (0.1%) |
| rmax | 0.012 | Maximum fee rate (1.2%) |
| c | 0.0104 | C-threshold parameter |

## Deployment Process

### 1. Pre-Deployment Validation

The deployment process includes automatic validation:

1. **Environment Check**: Validates required environment variables
2. **Network Connectivity**: Tests RPC connection and chain ID
3. **Balance Validation**: Ensures sufficient native tokens
4. **Gas Estimation**: Calculates deployment costs

### 2. Contract Deployment

For each network, the following contracts are deployed:

1. **SAMM Pool Factory**: Main factory contract for creating shards
2. **Test Tokens** (optional): ERC20 tokens for testing
3. **Test Shard**: Sample shard for parameter verification

### 3. Parameter Verification

After deployment, the system verifies:
- SAMM parameters match expected values
- Factory can create shards successfully
- Shards implement correct fee calculations

### 4. Deployment Reporting

Each deployment generates:
- **Individual reports**: Per-network deployment details
- **Multi-chain reports**: Comprehensive deployment summary
- **Gas usage tracking**: Actual vs estimated costs
- **Block explorer links**: For contract verification

## Monitoring and Validation

### Post-Deployment Checks

After deployment, verify:

1. **Contract Addresses**: Save and verify all deployed addresses
2. **Parameter Validation**: Confirm SAMM parameters are correct
3. **Test Transactions**: Execute sample swaps to verify functionality
4. **Block Explorer**: Verify contracts on respective explorers

### Deployment Artifacts

Deployment information is saved to:
- `deployments/`: Individual network deployment files
- `validation-reports/`: Setup validation reports
- `multi-chain-*.json`: Comprehensive deployment reports

## Troubleshooting

### Common Issues

1. **Insufficient Balance**
   ```
   Error: Insufficient balance. Need X.XX more ETH
   ```
   **Solution**: Add more native tokens to deployment wallet

2. **RPC Connection Failed**
   ```
   Error: Connection failed: network timeout
   ```
   **Solution**: Check RPC URL and network connectivity

3. **Chain ID Mismatch**
   ```
   Warning: Chain ID mismatch: got 1, expected 11155111
   ```
   **Solution**: Verify RPC URL points to correct network

4. **Gas Estimation Failed**
   ```
   Error: Gas estimation failed: execution reverted
   ```
   **Solution**: Check contract compilation and network status

### Recovery Procedures

If deployment fails:

1. **Check deployment reports** for partial success
2. **Verify which contracts deployed** successfully
3. **Resume deployment** from failed point if possible
4. **Use `--continue-on-error`** for multi-chain deployments

## Security Considerations

1. **Private Key Management**: Never commit private keys to version control
2. **RPC Endpoints**: Use trusted RPC providers
3. **Gas Limits**: Set appropriate limits to prevent stuck transactions
4. **Contract Verification**: Verify contracts on block explorers
5. **Parameter Validation**: Always verify SAMM parameters post-deployment

## Next Steps

After successful deployment:

1. **Deploy Backend Services**: Set up router and liquidity services
2. **Initialize Liquidity**: Add initial liquidity to test shards
3. **Integration Testing**: Test cross-pool routing and multi-hop swaps
4. **Monitoring Setup**: Configure monitoring and alerting
5. **Frontend Integration**: Connect frontend applications

## Support

For deployment issues:
1. Check deployment logs and reports
2. Validate network connectivity and balances
3. Review configuration files for accuracy
4. Test with single network before multi-chain deployment

## Recommended Testing Workflow

### Phase 1: Sepolia End-to-End Validation

Start with comprehensive Sepolia testing to ensure everything works:

```bash
# 1. Validate Sepolia setup
npm run validate:setup:sepolia

# 2. Estimate Sepolia costs
npm run estimate:gas:sepolia

# 3. Run comprehensive end-to-end test
npm run test:e2e:sepolia
```

The end-to-end test performs:
- ✅ Environment and connectivity validation
- ✅ Balance verification
- ✅ Contract deployment (Factory + Test Tokens)
- ✅ Shard creation and parameter verification
- ✅ Liquidity addition
- ✅ SAMM swap calculation testing
- ✅ Actual swap execution
- ✅ Pool state validation

### Phase 2: Multi-Testnet Deployment

Once Sepolia passes, deploy to all testnets:

```bash
# 1. Validate all testnet setups
npm run validate:setup

# 2. Estimate costs for all networks
npm run estimate:gas

# 3. Deploy to all testnets
npm run deploy:multi:testnets

# 4. Verify deployments
ls deployments/
```

### Phase 3: Individual Network Testing

Test each network individually if needed:

```bash
# Monad testnet
npm run validate:setup:monad
npm run deploy:monad

# RiseChain testnet  
npm run validate:setup:risechain
npm run deploy:risechain
```

## Example Complete Workflow

```bash
# Complete validation and deployment workflow
echo "🚀 Starting SAMM Multi-Chain Deployment"

# Step 1: Validate Sepolia thoroughly
echo "📋 Phase 1: Sepolia Validation"
npm run test:e2e:sepolia

# Step 2: Deploy to all testnets
echo "📋 Phase 2: Multi-Testnet Deployment"  
npm run deploy:multi:testnets

# Step 3: Verify all deployments
echo "📋 Phase 3: Verification"
ls -la deployments/
echo "✅ Multi-chain deployment complete!"
```

This completes the multi-chain deployment infrastructure for SAMM EVM contracts with comprehensive testnet validation.