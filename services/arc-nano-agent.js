#!/usr/bin/env node
/**
 * arc-nano-agent.js
 * Autonomous nanopayment arbitrage agent for Arc testnet (SAMM x Arc/Circle).
 *
 * - Connects to Arc testnet
 * - Monitors all SAMM shard pairs for price discrepancies
 * - Executes nanopayment arbitrage when spread > threshold
 *
 * Env vars:
 *   PRIVATE_KEY                      — Wallet private key (no 0x prefix)
 *   ARC_RPC_URL                      — Arc testnet RPC endpoint
 *   NANOPAYMENT_ARBITRAGEUR_ADDRESS  — NanopaymentArbitrageur contract address
 *   SAMM_FACTORY_ADDRESS             — SAMMPoolFactory address on Arc
 *   ARBITRAGE_THRESHOLD              — Minimum spread (default: 0.001 = 0.1%)
 *   AGENT_INTERVAL_MS                — Poll interval in ms (default: 10000)
 *   NANO_AMOUNT                      — Trade size in USDC units (default: 10000 = 0.01 USDC)
 */

"use strict";

require("dotenv").config();
const { ethers } = require("ethers");

// ============ Config ============

const {
  PRIVATE_KEY,
  ARC_RPC_URL = "https://testnet-rpc.arc.network",
  NANOPAYMENT_ARBITRAGEUR_ADDRESS,
  SAMM_FACTORY_ADDRESS,
  ARBITRAGE_THRESHOLD = "0.001",
  AGENT_INTERVAL_MS = "10000",
  NANO_AMOUNT = "10000",
} = process.env;

const THRESHOLD = parseFloat(ARBITRAGE_THRESHOLD);
const INTERVAL_MS = parseInt(AGENT_INTERVAL_MS, 10);
const NANO = BigInt(NANO_AMOUNT);

// ============ ABIs ============

const FACTORY_ABI = [
  "function getAllShards() view returns (address[])",
  "function getShardInfo(address shard) view returns (tuple(address tokenA, address tokenB, uint256 shardIndex, tuple(int256 beta1, uint256 rmin, uint256 rmax, uint256 c) sammParams, tuple(uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator) feeParams, bool isActive, address creator, uint256 createdAt) info)",
];

const POOL_ABI = [
  "function calculateSwapSAMM(uint256 amountOut, address tokenIn, address tokenOut) view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))",
  "function tokenA() view returns (address)",
  "function tokenB() view returns (address)",
];

const ARBITRAGEUR_ABI = [
  "function executeNanoArbitrage(address pool1, address pool2, address tokenA, address tokenB, uint256 nanoAmount) returns (uint256 profit)",
  "function quoteNanoArbitrage(address pool1, address pool2, address tokenA, address tokenB, uint256 nanoAmount) view returns (int256 estimatedProfit)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

// ============ Logging ============

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ============ Core Agent Logic ============

async function scanAndArbitrage(factory, arbitrageur, wallet) {
  const allShards = await factory.getAllShards();
  if (allShards.length < 2) {
    log("⚠️  Less than 2 shards available, nothing to arbitrage");
    return;
  }

  // Group shards by token pair
  const pairMap = new Map();
  for (const shardAddr of allShards) {
    try {
      const info = await factory.getShardInfo(shardAddr);
      if (!info.isActive) continue;

      const key = [info.tokenA, info.tokenB].sort().join("-");
      if (!pairMap.has(key)) pairMap.set(key, []);
      pairMap.get(key).push({ addr: shardAddr, tokenA: info.tokenA, tokenB: info.tokenB });
    } catch {
      // Skip unreadable shards
    }
  }

  for (const [pairKey, shards] of pairMap) {
    if (shards.length < 2) continue;

    const { tokenA, tokenB } = shards[0];
    log(`🔍 Scanning pair ${tokenA.slice(0, 8)}…/${tokenB.slice(0, 8)}… (${shards.length} shards)`);

    // Find best buy/sell pair
    let bestBuyPool = null;
    let bestSellPool = null;
    let bestProfit = 0n;

    for (let i = 0; i < shards.length; i++) {
      for (let j = 0; j < shards.length; j++) {
        if (i === j) continue;
        try {
          const estimated = await arbitrageur.quoteNanoArbitrage(
            shards[i].addr,
            shards[j].addr,
            tokenA,
            tokenB,
            NANO
          );
          if (estimated > bestProfit) {
            bestProfit = estimated;
            bestBuyPool = shards[i].addr;
            bestSellPool = shards[j].addr;
          }
        } catch {
          // No arb or quote failed
        }
      }
    }

    if (bestProfit <= 0n || !bestBuyPool || !bestSellPool) {
      log(`  📊 No profitable arb found for this pair`);
      continue;
    }

    const spreadPct = (Number(bestProfit) / Number(NANO)) * 100;
    log(`  📊 Best spread: ${spreadPct.toFixed(4)}% (profit: ${bestProfit} units)`);

    if (spreadPct / 100 < THRESHOLD) {
      log(`  ⏭️  Below threshold (${(THRESHOLD * 100).toFixed(2)}%)`);
      continue;
    }

    log(`  🚨 Executing nano-arb: pool1=${bestBuyPool.slice(0, 10)}… pool2=${bestSellPool.slice(0, 10)}…`);
    await executeArb(arbitrageur, wallet, bestBuyPool, bestSellPool, tokenA, tokenB, bestProfit);
  }
}

async function executeArb(arbitrageur, wallet, pool1, pool2, tokenA, tokenB, estimatedProfit) {
  try {
    const gasEstimate = await arbitrageur.executeNanoArbitrage.estimateGas(
      pool1, pool2, tokenA, tokenB, NANO
    );

    const tx = await arbitrageur.executeNanoArbitrage(
      pool1, pool2, tokenA, tokenB, NANO,
      { gasLimit: gasEstimate * 12n / 10n } // 20% buffer
    );
    const receipt = await tx.wait();

    // Parse profit from NanoArbitrage event
    const event = receipt.logs
      .map((l) => { try { return arbitrageur.interface.parseLog(l); } catch { return null; } })
      .find((e) => e?.name === "NanoArbitrage");

    const actualProfit = event?.args?.profit ?? 0n;
    const gasUsed = receipt.gasUsed;
    log(`  ✅ Arb executed! profit=${actualProfit} | gasUsed=${gasUsed} | tx=${tx.hash}`);
    log(`  📈 Est: ${estimatedProfit} | Actual: ${actualProfit}`);
  } catch (err) {
    log(`  ❌ Arb execution failed: ${err.message}`);
  }
}

// ============ Main Loop ============

async function main() {
  log("🚀 Arc Nano-Arbitrage Agent starting…");

  if (!PRIVATE_KEY) { log("❌ PRIVATE_KEY not set"); process.exit(1); }
  if (!NANOPAYMENT_ARBITRAGEUR_ADDRESS) { log("❌ NANOPAYMENT_ARBITRAGEUR_ADDRESS not set"); process.exit(1); }
  if (!SAMM_FACTORY_ADDRESS) { log("❌ SAMM_FACTORY_ADDRESS not set"); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(ARC_RPC_URL);
  const wallet = new ethers.Wallet(`0x${PRIVATE_KEY.replace(/^0x/, "")}`, provider);

  const factory = new ethers.Contract(SAMM_FACTORY_ADDRESS, FACTORY_ABI, provider);
  const arbitrageur = new ethers.Contract(NANOPAYMENT_ARBITRAGEUR_ADDRESS, ARBITRAGEUR_ABI, wallet);

  log(`📋 Wallet  : ${wallet.address}`);
  log(`🏭 Factory : ${SAMM_FACTORY_ADDRESS}`);
  log(`🤖 Agent   : ${NANOPAYMENT_ARBITRAGEUR_ADDRESS}`);
  log(`⚙️  Threshold: ${(THRESHOLD * 100).toFixed(2)}% | Interval: ${INTERVAL_MS}ms | Nano: ${NANO}`);

  const runLoop = async () => {
    try {
      await scanAndArbitrage(factory, arbitrageur, wallet);
    } catch (err) {
      log(`❌ Loop error: ${err.message}`);
    }
    setTimeout(runLoop, INTERVAL_MS);
  };

  await runLoop();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
