#!/usr/bin/env node
/**
 * uniswap-agent.js
 * Off-chain Uniswap arbitrage agent for SAMM x Uniswap Foundation integration.
 *
 * - Polls SAMM pool prices via the local API server
 * - Fetches Uniswap quotes via the Uniswap API
 * - Executes on-chain arbitrage when spread > threshold
 *
 * Env vars:
 *   UNISWAP_API_KEY           — Uniswap API key
 *   PRIVATE_KEY               — Wallet private key (no 0x prefix)
 *   SEPOLIA_RPC_URL           — Sepolia JSON-RPC endpoint
 *   SAMM_ROUTER_ADDRESS       — CrossPoolRouter contract address
 *   UNISWAP_ROUTER_ADDRESS    — Uniswap V3 SwapRouter address (Sepolia)
 *   SAMM_API_URL              — SAMM API server base URL (default: http://localhost:3000)
 *   ARBITRAGE_THRESHOLD       — Minimum price discrepancy (default: 0.005 = 0.5%)
 *   AGENT_INTERVAL_MS         — Poll interval in ms (default: 30000)
 */

"use strict";

require("dotenv").config();
const { ethers } = require("ethers");
const axios = require("axios");

// ============ Config ============

const {
  UNISWAP_API_KEY,
  PRIVATE_KEY,
  SEPOLIA_RPC_URL,
  SAMM_ROUTER_ADDRESS,
  UNISWAP_ROUTER_ADDRESS,
  SAMM_API_URL = "http://localhost:3000",
  ARBITRAGE_THRESHOLD = "0.005",
  AGENT_INTERVAL_MS = "30000",
} = process.env;

const THRESHOLD = parseFloat(ARBITRAGE_THRESHOLD);
const INTERVAL_MS = parseInt(AGENT_INTERVAL_MS, 10);

// Minimal ABI for CrossPoolRouter quoteSwap
const SAMM_ROUTER_ABI = [
  "function quoteSwap((address tokenIn, address tokenOut, uint256 amountOut)[] hops) view returns ((uint256 expectedAmountIn, uint256[] hopAmountsIn, uint256[] hopFees, address[] selectedShards, uint256[] priceImpacts) result)",
];

// Minimal ABI for UniswapSAMMAggregator (if deployed)
const AGGREGATOR_ABI = [
  "function aggregatedSwap(address tokenIn, address tokenOut, uint256 amountOut, uint256 maxAmountIn, uint256 deadline, uint24 feeTier) returns (uint256 amountIn)",
];

// ============ Logging ============

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ============ Price Fetching ============

async function getSAMMPrice(tokenA, tokenB) {
  try {
    const res = await axios.get(`${SAMM_API_URL}/price/${tokenA}/${tokenB}`, {
      timeout: 5000,
    });
    return res.data?.price ?? null;
  } catch (err) {
    log(`⚠️  SAMM price fetch failed for ${tokenA}/${tokenB}: ${err.message}`);
    return null;
  }
}

async function getUniswapQuote(tokenIn, tokenOut, amountIn) {
  if (!UNISWAP_API_KEY) {
    log("⚠️  UNISWAP_API_KEY not set, skipping Uniswap quote");
    return null;
  }
  try {
    const res = await axios.get("https://api.uniswap.org/v1/quote", {
      params: {
        tokenInAddress: tokenIn,
        tokenOutAddress: tokenOut,
        tokenInChainId: 11155111, // Sepolia
        tokenOutChainId: 11155111,
        amount: amountIn.toString(),
        type: "exactIn",
      },
      headers: {
        "x-api-key": UNISWAP_API_KEY,
      },
      timeout: 8000,
    });
    const quoteData = res.data;
    return quoteData?.quote ?? quoteData?.quoteDecimals ?? null;
  } catch (err) {
    log(`⚠️  Uniswap API quote failed: ${err.message}`);
    return null;
  }
}

// ============ Arbitrage Execution ============

async function checkAndArbitrage(provider, wallet, pairs) {
  for (const { tokenA, tokenB, label } of pairs) {
    log(`🔍 Checking ${label} (${tokenA.slice(0, 8)}…/${tokenB.slice(0, 8)}…)`);

    const sammPrice = await getSAMMPrice(tokenA, tokenB);
    if (sammPrice === null) continue;

    // Use 1 unit of tokenA (in wei) as reference
    const ONE_UNIT = ethers.parseEther("1");
    const uniPrice = await getUniswapQuote(tokenA, tokenB, ONE_UNIT.toString());

    if (uniPrice === null) continue;

    const sammPriceNum = parseFloat(sammPrice);
    const uniPriceNum = parseFloat(uniPrice);

    if (sammPriceNum === 0 || uniPriceNum === 0) continue;

    const spread = Math.abs(sammPriceNum - uniPriceNum) / Math.min(sammPriceNum, uniPriceNum);
    log(`  📊 SAMM: ${sammPriceNum.toFixed(6)} | Uniswap: ${uniPriceNum.toFixed(6)} | Spread: ${(spread * 100).toFixed(3)}%`);

    if (spread > THRESHOLD) {
      log(`  🚨 Spread (${(spread * 100).toFixed(3)}%) exceeds threshold (${(THRESHOLD * 100).toFixed(1)}%) — executing arbitrage`);
      await executeArbitrage(wallet, tokenA, tokenB, sammPriceNum, uniPriceNum, ONE_UNIT);
    }
  }
}

async function executeArbitrage(wallet, tokenA, tokenB, sammPrice, uniPrice, amount) {
  if (!SAMM_ROUTER_ADDRESS || !UNISWAP_ROUTER_ADDRESS) {
    log("  ⚠️  Router addresses not configured, skipping execution");
    return;
  }

  try {
    const cheaper = sammPrice < uniPrice ? "SAMM" : "Uniswap";
    log(`  ✅ Buying on ${cheaper}, selling on ${cheaper === "SAMM" ? "Uniswap" : "SAMM"}`);

    // In a real implementation, we would:
    // 1. Approve the aggregator contract
    // 2. Call aggregatedSwap() with appropriate params
    // This is a stub — the actual execution depends on aggregator deployment
    log(`  💡 [Stub] Would execute arbitrage: ${tokenA} → ${tokenB} via ${cheaper}`);
    log(`  💡 [Stub] Amount: ${ethers.formatEther(amount)} tokens`);
  } catch (err) {
    log(`  ❌ Arbitrage execution failed: ${err.message}`);
  }
}

// ============ Main Loop ============

async function main() {
  log("🚀 Uniswap-SAMM Arbitrage Agent starting…");

  if (!PRIVATE_KEY) {
    log("❌ PRIVATE_KEY not set");
    process.exit(1);
  }
  if (!SEPOLIA_RPC_URL) {
    log("❌ SEPOLIA_RPC_URL not set");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
  const wallet = new ethers.Wallet(`0x${PRIVATE_KEY.replace(/^0x/, "")}`, provider);
  log(`📋 Wallet: ${wallet.address}`);
  log(`⚙️  Threshold: ${(THRESHOLD * 100).toFixed(2)}% | Interval: ${INTERVAL_MS}ms`);

  // Example token pairs — replace with actual Sepolia addresses
  const PAIRS = [
    {
      label: "WETH/USDC",
      tokenA: process.env.WETH_ADDRESS || "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
      tokenB: process.env.USDC_ADDRESS || "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    },
  ];

  const runLoop = async () => {
    try {
      await checkAndArbitrage(provider, wallet, PAIRS);
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
