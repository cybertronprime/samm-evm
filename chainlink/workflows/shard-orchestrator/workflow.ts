// chainlink/workflows/shard-orchestrator/workflow.ts
/**
 * SAMM Shard Orchestrator — Chainlink CRE Workflow
 *
 * Automatically monitors SAMM shard TPS and scales shards up/down based on
 * the thresholds from the SAMM research paper:
 *   < 50 TPS  → 1 shard
 *   50–200    → 2 shards
 *   200–500   → 4 shards
 *   > 500     → 8 shards
 *
 * Steps:
 *   1. Trigger: time-based (every 60 seconds) or on-demand
 *   2. Fetch TPS from SAMM API /health
 *   3. Fetch shard prices from SAMM API /price/:tokenA/:tokenB
 *   4. Compute desired shard count
 *   5. If scaling needed, emit an on-chain transaction to SAMMPoolFactory
 */

// @ts-ignore — CRE SDK types depend on the installed @chainlink/cre-sdk package
// import { workflow, trigger, action, consensus } from "@chainlink/cre-sdk";

// ---- Types ----

interface SAMMHealthResponse {
  status: string;
  tps: number;
  activePools: number;
  timestamp: string;
}

interface ShardPriceResponse {
  tokenA: string;
  tokenB: string;
  price: number;
  shards: number;
}

interface ScalingDecision {
  currentShards: number;
  targetShards: number;
  shouldScale: boolean;
  reason: string;
}

// ---- Constants ----

const SAMM_API_BASE = process.env["SAMM_API_URL"] ?? "http://localhost:3000";
const FACTORY_ADDRESS = process.env["SAMM_FACTORY_ADDRESS"] ?? "";

const TPS_THRESHOLDS = [
  { maxTps: 50, shards: 1 },
  { maxTps: 200, shards: 2 },
  { maxTps: 500, shards: 4 },
  { maxTps: Infinity, shards: 8 },
] as const;

// ---- Helpers ----

function computeTargetShards(tps: number): number {
  for (const { maxTps, shards } of TPS_THRESHOLDS) {
    if (tps < maxTps) return shards;
  }
  return 8;
}

function buildScalingDecision(
  currentShards: number,
  tps: number
): ScalingDecision {
  const target = computeTargetShards(tps);
  return {
    currentShards,
    targetShards: target,
    shouldScale: target !== currentShards,
    reason:
      target > currentShards
        ? `TPS ${tps} exceeds threshold for ${currentShards} shards → scale up to ${target}`
        : target < currentShards
        ? `TPS ${tps} below threshold for ${currentShards} shards → scale down to ${target}`
        : `TPS ${tps} within range for ${currentShards} shards — no action`,
  };
}

// ---- Workflow Definition ----

/**
 * Exported workflow definition compatible with @chainlink/cre-sdk patterns.
 * Each step is an async function; CRE orchestrates execution and consensus.
 */
export const shardOrchestratorWorkflow = {
  id: "samm-shard-orchestrator",
  description: "Monitors SAMM TPS and scales shards automatically",
  version: "1.0.0",

  // Step 1 — Trigger: run every 60 seconds
  trigger: {
    type: "time",
    intervalSeconds: 60,
  },

  // Step 2 — Fetch TPS data from SAMM API
  fetchTps: async (): Promise<SAMMHealthResponse> => {
    const url = `${SAMM_API_BASE}/health`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SAMM /health returned ${res.status}`);
    const data = (await res.json()) as SAMMHealthResponse;
    console.log(`[shard-orchestrator] TPS=${data.tps} activePools=${data.activePools}`);
    return data;
  },

  // Step 3 — Fetch shard prices
  fetchPrices: async (
    tokenA: string,
    tokenB: string
  ): Promise<ShardPriceResponse> => {
    const url = `${SAMM_API_BASE}/price/${tokenA}/${tokenB}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SAMM /price returned ${res.status}`);
    return (await res.json()) as ShardPriceResponse;
  },

  // Step 4 — Consensus: compute scaling decision
  computeScaling: (
    health: SAMMHealthResponse,
    prices: ShardPriceResponse
  ): ScalingDecision => {
    const decision = buildScalingDecision(prices.shards, health.tps);
    console.log(`[shard-orchestrator] ${decision.reason}`);
    return decision;
  },

  // Step 5 — On-chain execution (if scaling needed)
  executeScaling: async (
    decision: ScalingDecision,
    tokenA: string,
    tokenB: string,
    provider: unknown // ethers.Provider | viem.PublicClient
  ): Promise<string | null> => {
    if (!decision.shouldScale) {
      console.log("[shard-orchestrator] No scaling required.");
      return null;
    }

    if (!FACTORY_ADDRESS) {
      console.warn("[shard-orchestrator] SAMM_FACTORY_ADDRESS not set — skipping on-chain call");
      return null;
    }

    console.log(
      `[shard-orchestrator] Scaling ${tokenA}/${tokenB}: ` +
        `${decision.currentShards} → ${decision.targetShards} shards`
    );

    // NOTE: Actual on-chain execution via ethers.js or viem would be done here.
    // The CRE SDK handles signing and broadcasting via the configured DON wallet.
    // Example (pseudocode):
    //   const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
    //   if (decision.targetShards > decision.currentShards) {
    //     const tx = await factory.createShard(tokenA, tokenB, SAMM_PARAMS, FEE_PARAMS);
    //     return tx.hash;
    //   }

    return "0x_placeholder_tx_hash";
  },
};

export default shardOrchestratorWorkflow;
