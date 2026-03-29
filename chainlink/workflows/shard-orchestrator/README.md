# SAMM Shard Orchestrator — Chainlink CRE Workflow

This directory contains the Chainlink Compute & Run Engine (CRE) workflow that
automatically monitors SAMM shard load and scales shards up or down based on
TPS thresholds from the SAMM research paper.

## Shard Scaling Rules

| TPS Range  | Shard Count |
|------------|-------------|
| < 50       | 1           |
| 50–200     | 2           |
| 200–500    | 4           |
| > 500      | 8           |

## Prerequisites

- Node.js ≥ 18
- `@chainlink/cre-sdk` installed (run `npm install @chainlink/cre-sdk` when available)
- A funded CRE subscription and DON wallet
- SAMM API server running (see `api-server.js`)
- `SAMM_FACTORY_ADDRESS` env var set to your deployed SAMMPoolFactory address

## Setup

```bash
# Install dependencies (from repo root)
npm install

# Set required environment variables
export SAMM_API_URL=http://localhost:3000
export SAMM_FACTORY_ADDRESS=0xYourFactoryAddress
export CRE_SUBSCRIPTION_ID=your_cre_subscription_id
export PRIVATE_KEY=your_private_key
```

## Install CRE CLI

```bash
npm install -g @chainlink/cre-cli
# or
npx @chainlink/cre-cli --version
```

## Compile the Workflow

```bash
# From repo root
npx tsc chainlink/workflows/shard-orchestrator/workflow.ts --outDir dist/
# Or using ts-node directly:
npx ts-node chainlink/workflows/shard-orchestrator/workflow.ts
```

## Simulate Locally

```bash
# Run one cycle of the workflow locally (dry-run, no on-chain txs)
SAMM_API_URL=http://localhost:3000 \
SAMM_FACTORY_ADDRESS=0x0000000000000000000000000000000000000001 \
  npx ts-node chainlink/workflows/shard-orchestrator/workflow.ts
```

## Deploy to CRE Network

```bash
# Authenticate with the CRE CLI
npx cre auth login

# Upload and register the workflow
npx cre workflow deploy \
  --file chainlink/workflows/shard-orchestrator/workflow.ts \
  --subscription-id $CRE_SUBSCRIPTION_ID \
  --network sepolia

# Check deployment status
npx cre workflow status --id samm-shard-orchestrator
```

## Workflow Steps

1. **Trigger** — runs every 60 seconds (or on-demand via CRE dashboard)
2. **fetchTps** — HTTP GET to `SAMM_API_URL/health` for current TPS
3. **fetchPrices** — HTTP GET to `SAMM_API_URL/price/:tokenA/:tokenB` for shard prices
4. **computeScaling** — consensus step that determines target shard count
5. **executeScaling** — if scaling is needed, calls `SAMMPoolFactory.createShard()` on-chain
   via the DON's managed wallet

## Configuration

| Env Var               | Description                              | Default                   |
|-----------------------|------------------------------------------|---------------------------|
| `SAMM_API_URL`        | SAMM API server base URL                 | `http://localhost:3000`   |
| `SAMM_FACTORY_ADDRESS`| SAMMPoolFactory contract address         | (required for scaling)    |
| `CRE_SUBSCRIPTION_ID` | Your CRE subscription ID                 | (required for deployment) |

## Resources

- [Chainlink CRE Documentation](https://docs.chain.link/chainlink-automation)
- [SAMM Research Paper](https://arxiv.org/abs/2411.01232)
- [VRFFairSequencer](../../contracts/integrations/VRFFairSequencer.sol) — on-chain companion contract
