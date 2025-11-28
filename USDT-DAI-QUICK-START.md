# USDT/DAI Pools - Quick Start

## One-Command Deployment

```bash
cd samm-evm
./deploy-and-test-usdt-dai.sh
```

This will:
1. ✅ Deploy 3 USDT/DAI shards
2. ✅ Verify all shards are working
3. ✅ Test swaps on each shard

## Manual Steps

### Deploy Only
```bash
node scripts/deploy-usdt-dai-pools-clean.js
```

### Verify Only
```bash
node scripts/verify-usdt-dai-deployment.js
```

### Test Only
```bash
node scripts/test-usdt-dai-swaps.js
```

## What Gets Created

```
USDT/DAI Pool System
├── Shard 1: 100 USDT + 100 DAI
├── Shard 2: 500 USDT + 500 DAI
└── Shard 3: 1000 USDT + 1000 DAI
```

## Key Addresses (Monad Testnet)

- **Factory:** `0x70fe868ac814CC197631B60eEEaEaa1553418D03`
- **USDT:** `0x1888FF2446f2542cbb399eD179F4d6d966268C1F`
- **DAI:** `0x60CB213FCd1616FbBD44319Eb11A35d5671E692e`

## Requirements

- ✅ Node.js installed
- ✅ `.env` file with `PRIVATE_KEY`
- ✅ 0.1+ MON for gas
- ✅ 1600+ USDT tokens
- ✅ 1600+ DAI tokens

## Expected Duration

- Deployment: ~2-3 minutes
- Verification: ~30 seconds
- Testing: ~1 minute
- **Total: ~4-5 minutes**

## Output Files

- `deployment-data/usdt-dai-pools-{timestamp}.json` - Deployment details
- Console logs with all addresses and transaction hashes

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Insufficient balance | Get MON from faucet |
| Insufficient tokens | Mint more USDT/DAI |
| Transaction reverts | Check gas limits and approvals |
| Shard not found | Verify factory address |

## Next Steps

After successful deployment:

1. Update router configuration with new shard addresses
2. Test multi-hop swaps (USDC -> USDT -> DAI)
3. Monitor shard liquidity and performance
4. Integrate with frontend/API

## Documentation

See `USDT-DAI-DEPLOYMENT-COMPLETE.md` for full documentation.
