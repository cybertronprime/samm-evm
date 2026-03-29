# SAMM Partner Integrations

> Dynamically sharded AMM with multi-protocol DeFi integrations

## Project Overview

**SAMM (Stableswap AMM)** is a research-backed, dynamically sharded AMM DEX.
This project integrates SAMM with three leading DeFi ecosystems — Uniswap,
Chainlink, and Arc/Circle — for a unified cross-protocol experience.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    SAMM Partner Integrations                     │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Uniswap     │  │  Chainlink   │  │  Arc / Circle         │  │
│  │  Foundation  │  │  VRF + Feeds │  │  (Nanopayments)       │  │
│  │  Aggregator  │  │  + CRE       │  │                       │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│  ┌──────▼───────────────────────────────────────▼───────────┐  │
│  │                    SAMM Core (All Networks)               │  │
│  │                                                           │  │
│  │   SAMMPoolFactory ──── CrossPoolRouter                    │  │
│  │        │                      │                           │  │
│  │   Shard1  Shard2  Shard3   Shard4  (dynamic sharding)    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Off-chain Services:                                            │
│   uniswap-agent.js   arc-nano-agent.js   CRE workflow.ts       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Integration Breakdown

### 🦄 Uniswap Foundation — Best-Price Aggregation

**Chain:** Ethereum Sepolia

| Component | Path |
|-----------|------|
| Smart Contract | `contracts/integrations/UniswapSAMMAggregator.sol` |
| Off-chain Agent | `services/uniswap-agent.js` |
| Deploy Script | `scripts/deploy-uniswap-aggregator.js` |
| Tests | `test/integrations/UniswapSAMMAggregator.test.js` |

**What it does:**
- On-chain meta-aggregator that compares SAMM and Uniswap V3 quotes for every swap
- Routes to whichever source offers the lower `amountIn` for the requested `amountOut`
- Off-chain agent polls both protocols and executes arbitrage when spread > 0.5%
- Uses official Uniswap API (https://api.uniswap.org) with `UNISWAP_API_KEY`

**How to get API key:** https://hub.uniswap.org → Developer → API Keys

**How to deploy:**
```bash
export SAMM_ROUTER_ADDRESS=0x...
export UNISWAP_ROUTER_ADDRESS=0xE592427A0AEce92De3Edee1F18E0157C05861564
export UNISWAP_QUOTER_ADDRESS=0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3
npm run deploy:sepolia:uniswap
```

**How to run agent:**
```bash
export UNISWAP_API_KEY=your_key
export PRIVATE_KEY=your_key
export SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/...
npm run agent:uniswap
```

---

### ⬡ Chainlink — CRE Workflow + Price Feeds + VRF

**Chain:** Ethereum Sepolia

| Component | Path |
|-----------|------|
| Price Validator | `contracts/integrations/ChainlinkPriceValidator.sol` |
| VRF Sequencer | `contracts/integrations/VRFFairSequencer.sol` |
| CRE Workflow | `chainlink/workflows/shard-orchestrator/workflow.ts` |
| Deploy Script | `scripts/deploy-chainlink-integrations.js` |
| Tests | `test/integrations/ChainlinkPriceValidator.test.js` |
| Tests | `test/integrations/VRFFairSequencer.test.js` |

**What it does:**
- **ChainlinkPriceValidator:** Validates SAMM swap prices against Chainlink Price Feeds on Sepolia. Supports ETH/USD, BTC/USD, LINK/USD, USDC/USD feeds.
- **VRFFairSequencer:** Uses VRF v2.5 to randomly shuffle batched swap orders, preventing front-running. Assigns swaps to SAMM shards randomly.
- **CRE Workflow:** Time-based workflow that monitors SAMM TPS and auto-scales shards when load thresholds are crossed.

**Sepolia Feed Addresses:**
| Token | Feed |
|-------|------|
| ETH/USD | `0x694AA1769357215DE4FAC081bf1f309aDC325306` |
| BTC/USD | `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43` |
| LINK/USD | `0xc59E3633BAAC79493d908e63626716e204A45EdF` |
| USDC/USD | `0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E` |

**VRF v2.5 Config (Sepolia):**
- Coordinator: `0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B`
- Key Hash: `0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae`

**How to deploy:**
```bash
export CHAINLINK_VRF_SUBSCRIPTION_ID=your_sub_id
npm run deploy:sepolia:chainlink
# Then add VRFFairSequencer as consumer to your VRF subscription
```

**CRE Workflow deployment:** See [chainlink/workflows/shard-orchestrator/README.md](../chainlink/workflows/shard-orchestrator/README.md)

---

### ⭕ Arc/Circle — Autonomous Nanopayment Arbitrage

**Chain:** Arc Testnet

| Component | Path |
|-----------|------|
| Smart Contract | `contracts/integrations/NanopaymentArbitrageur.sol` |
| Off-chain Agent | `services/arc-nano-agent.js` |
| Deploy Script | `scripts/deploy-arc-nanopayments.js` |
| Tests | `test/integrations/NanopaymentArbitrageur.test.js` |

**What it does:**
- Executes nanopayment-sized arbitrage (as small as 0.01 USDC) between SAMM shards on Arc
- Autonomous agent (`arc-nano-agent.js`) continuously scans all shard pairs and executes profitable arbs
- Tracks per-agent stats: total arbs, successful arbs, total profit
- USDC-native (Arc chain uses USDC as gas)

**How to deploy:**
```bash
export ARC_RPC_URL=https://testnet-rpc.arc.network
export PRIVATE_KEY=your_key
npm run deploy:arc
```

**How to run agent:**
```bash
export ARC_RPC_URL=https://testnet-rpc.arc.network
export NANOPAYMENT_ARBITRAGEUR_ADDRESS=0x...
export SAMM_FACTORY_ADDRESS=0x...
npm run agent:arc
```

---

## Chain Deployment Map

| Contract | Sepolia | Arc Testnet |
|----------|---------|-------------|
| SAMMPoolFactory | ✅ | ✅ |
| CrossPoolRouter | ✅ | ✅ |
| UniswapSAMMAggregator | ✅ | ❌ |
| ChainlinkPriceValidator | ✅ | ❌ |
| VRFFairSequencer | ✅ | ❌ |
| NanopaymentArbitrageur | ❌ | ✅ |

---

## Demo Flows

### Uniswap Demo
1. Call `getQuotes(WETH, USDC, 1e18, 3000)` → see both SAMM and Uniswap quotes
2. Call `aggregatedSwap(...)` → automatically routes to best price
3. Watch `AggregatedSwap` event: `source` field shows "SAMM" or "Uniswap"

### Chainlink Demo
1. Call `validateSwapPrice(WETH_ADDR, USDC_ADDR, sammPrice)` → get oracle-verified deviation
2. Submit a swap batch to `VRFFairSequencer.submitBatch(swaps)` → VRF request created
3. After VRF callback, check `getBatchShuffledOrder(batchId)` → random ordering

### Arc Demo
1. `agent.registerAgent(wallet.address)` → authorize the bot
2. Start `npm run agent:arc` → bot continuously scans shards
3. Watch logs: "Executing nano-arb" events with profit in USDC micro-units

---

## Running Tests

```bash
# All integration tests
npm run test:integrations

# Specific test suites
npx hardhat test test/integrations/ChainlinkPriceValidator.test.js
npx hardhat test test/integrations/VRFFairSequencer.test.js
npx hardhat test test/integrations/UniswapSAMMAggregator.test.js
npx hardhat test test/integrations/NanopaymentArbitrageur.test.js
```

---

## Environment Variables Reference

See `.env.example` for the full list. Key integration settings:

```bash
# Uniswap
UNISWAP_API_KEY=          # From hub.uniswap.org
UNISWAP_ROUTER_ADDRESS=0xE592427A0AEce92De3Edee1F18E0157C05861564
UNISWAP_QUOTER_ADDRESS=0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3

# Chainlink
CHAINLINK_VRF_SUBSCRIPTION_ID=   # From vrf.chain.link

# Arc
ARC_RPC_URL=https://testnet-rpc.arc.network
NANOPAYMENT_ARBITRAGEUR_ADDRESS=  # After deploy:arc
SAMM_FACTORY_ADDRESS=             # After deploy:arc

# Agent
ARBITRAGE_THRESHOLD=0.005   # 0.5% minimum spread
AGENT_INTERVAL_MS=30000     # 30 second polling interval
```

---

## Partner Resources

| Partner | Link |
|---------|------|
| Uniswap Foundation | https://uniswap.org/developers |
| Uniswap API | https://api.uniswap.org |
| Chainlink VRF | https://vrf.chain.link |
| Chainlink Price Feeds | https://data.chain.link |
| Chainlink CRE | https://docs.chain.link/chainlink-automation |
| Arc Network | https://arc.network |
| Circle USDC | https://developers.circle.com |

---

## AI Tool Attribution

This project used AI assistance (GitHub Copilot) to:
- Generate boilerplate for integration contracts and test scaffolding
- Draft the CRE workflow TypeScript skeleton
- Accelerate documentation writing

All AI-generated code was reviewed, tested, and validated by the development team.
Core SAMM math and shard logic is original research-backed code.

---

## License

MIT — see [LICENSE](../LICENSE)
