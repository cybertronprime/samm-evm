const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const GAS_LIMIT = 12_000_000;
const REPORT_DIR = path.join(__dirname, "..", "test-results");

const TOKEN_ABI = [
  "function approve(address,uint256) external returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function mint(address,uint256) external",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const ROUTER_ABI = [
  "function quoteSwap((address tokenIn, address tokenOut, uint256 amountOut)[] hops) view returns (tuple(uint256 expectedAmountIn, uint256[] hopAmountsIn, uint256[] hopFees, address[] selectedShards, uint256[] priceImpacts))",
  "function swapExactOutput((tuple(address tokenIn, address tokenOut, uint256 amountOut)[] hops,uint256 maxAmountIn,uint256 deadline,address recipient)) external returns (tuple((address pool,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,uint256 fee)[] hopResults,uint256 totalAmountIn,uint256 totalAmountOut,uint256 totalFees))",
  "function getSelectedShard(address,address,uint256) view returns (address)",
  "event HopExecuted(uint256 indexed hopIndex, address indexed pool, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee)",
  "event SwapExecuted(address indexed sender, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 hopCount)"
];

const POOL_ABI = [
  "function tokenA() view returns (address)",
  "function tokenB() view returns (address)",
  "function getReserves() view returns (uint256 reserveA, uint256 reserveB)",
  "function calculateSwapSAMM(uint256 amountOut,address tokenIn,address tokenOut) view returns (tuple(uint256 amountIn,uint256 amountOut,uint256 tradeFee,uint256 ownerFee))",
  "function swapSAMM(uint256 amountOut,uint256 maximalAmountIn,address tokenIn,address tokenOut,address recipient) external returns (uint256 amountIn)",
  "function collectedFeesA() view returns (uint256)",
  "function collectedFeesB() view returns (uint256)",
  "event SwapSAMM(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee)"
];

function findLatestDeployment() {
  if (process.env.DEPLOYMENT_FILE) return process.env.DEPLOYMENT_FILE;
  const dir = path.join(__dirname, "..", "deployment-data");
  const files = fs.readdirSync(dir)
    .filter((file) => file.startsWith("production-risechain-") && file.endsWith(".json"))
    .sort()
    .reverse();
  if (!files.length) throw new Error("No production-risechain deployment file found");
  return files[0];
}

function toNumber(value, decimals) {
  return Number(ethers.formatUnits(value, decimals));
}

function formatFixed(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function classifyShard(shard, sortedShards) {
  if (shard?.name) {
    const lower = shard.name.toLowerCase();
    if (lower.includes("small")) return "Small";
    if (lower.includes("medium")) return "Medium";
    if (lower.includes("large")) return "Large";
    if (lower.includes("micro")) return "Micro";
    if (lower.includes("xlarge")) return "XLarge";
  }
  if (!sortedShards) return "Unknown";
  const index = sortedShards.findIndex((entry) => entry.address.toLowerCase() === shard.address.toLowerCase());
  return ["Small", "Medium", "Large", "XLarge"][index] || `Shard-${index + 1}`;
}

function getPairKey(a, b, deployment) {
  const direct = `${a}-${b}`;
  const reverse = `${b}-${a}`;
  if (deployment.contracts.shards[direct]) return direct;
  if (deployment.contracts.shards[reverse]) return reverse;
  throw new Error(`Missing deployment pair for ${a}-${b}`);
}

async function ensureBalances(tokens, signer, deployment) {
  for (const [symbol, meta] of Object.entries(deployment.contracts.tokens)) {
    const token = tokens[symbol];
    const desiredAmount = symbol === "WETH" ? "500" : symbol === "WBTC" ? "50" : "5000000";
    const desired = ethers.parseUnits(desiredAmount, meta.decimals);
    const balance = await token.balanceOf(signer.address);
    if (balance < desired / 2n) {
      await (await token.mint(signer.address, desired, { gasLimit: 500000 })).wait();
    }
  }
}

async function approveEverywhere(tokens, deployment, routerAddress) {
  for (const [symbol, meta] of Object.entries(deployment.contracts.tokens)) {
    const token = tokens[symbol];
    await (await token.approve(routerAddress, ethers.MaxUint256, { gasLimit: 500000 })).wait();
    for (const shards of Object.values(deployment.contracts.shards)) {
      for (const shard of shards) {
        await (await token.approve(shard.address, ethers.MaxUint256, { gasLimit: 500000 })).wait();
      }
    }
  }
}

async function getPoolTokenOrder(pool, tokenInAddress) {
  const tokenA = await pool.tokenA();
  return tokenA.toLowerCase() === tokenInAddress.toLowerCase() ? "A" : "B";
}

async function getFeeBucket(pool, tokenInAddress) {
  const tokenA = await pool.tokenA();
  if (tokenA.toLowerCase() === tokenInAddress.toLowerCase()) {
    return { before: await pool.collectedFeesA(), key: "A" };
  }
  return { before: await pool.collectedFeesB(), key: "B" };
}

async function getReserveForOutput(pool, tokenOutAddress) {
  const [reserveA, reserveB] = await pool.getReserves();
  const tokenA = await pool.tokenA();
  return tokenA.toLowerCase() === tokenOutAddress.toLowerCase() ? reserveA : reserveB;
}

async function buildRouterTierCases(pairKey, pairShards, deployment, tokens, poolMap) {
  const [symbolA, symbolB] = pairKey.split("-");
  const sorted = [...pairShards].sort((a, b) => a.liquidityUSD - b.liquidityUSD);
  const directions = [
    { tokenIn: symbolA, tokenOut: symbolB },
    { tokenIn: symbolB, tokenOut: symbolA }
  ];
  const cases = [];

  for (const direction of directions) {
    const previousMaxOutputs = [];
    for (let index = 0; index < sorted.length; index++) {
      const shard = sorted[index];
      const pool = poolMap.get(shard.address);
      const outputReserve = await getReserveForOutput(pool, tokens[direction.tokenOut].target);
      const maxOutput = (outputReserve * 9600n) / 1_000_000n;
      previousMaxOutputs.push(maxOutput);

      let targetAmountOut;
      if (index === 0) {
        targetAmountOut = maxOutput / 5n;
      } else {
        const previousMax = previousMaxOutputs[index - 1];
        const currentComfort = maxOutput / 3n;
        const minimumNeeded = previousMax + (previousMax / 10n) + 1n;
        targetAmountOut = currentComfort > minimumNeeded ? currentComfort : minimumNeeded;
      }

      if (targetAmountOut > 0n && targetAmountOut < maxOutput) {
        cases.push({
          kind: "router-single-hop",
          pair: pairKey,
          tokenIn: direction.tokenIn,
          tokenOut: direction.tokenOut,
          targetTier: classifyShard(shard, sorted),
          amountOut: targetAmountOut,
          expectedShardAddress: shard.address,
          shardLiquidityUSD: shard.liquidityUSD
        });
      }
    }
  }

  return cases;
}

async function executeDirectShardCase(testCase, ctx) {
  const { tokens, deployment, signer, poolMap } = ctx;
  const tokenInMeta = deployment.contracts.tokens[testCase.tokenIn];
  const tokenOutMeta = deployment.contracts.tokens[testCase.tokenOut];
  const pool = poolMap.get(testCase.shardAddress);
  const quote = await pool.calculateSwapSAMM(testCase.amountOut, tokens[testCase.tokenIn].target, tokens[testCase.tokenOut].target);
  const maxAmountIn = (quote.amountIn * 105n) / 100n;

  const feeBucketBefore = await getFeeBucket(pool, tokens[testCase.tokenIn].target);
  const outBalanceBefore = await tokens[testCase.tokenOut].balanceOf(signer.address);
  const inBalanceBefore = await tokens[testCase.tokenIn].balanceOf(signer.address);

  const tx = await pool.swapSAMM(
    testCase.amountOut,
    maxAmountIn,
    tokens[testCase.tokenIn].target,
    tokens[testCase.tokenOut].target,
    signer.address,
    { gasLimit: GAS_LIMIT }
  );
  const receipt = await tx.wait();

  const parsedSwap = receipt.logs
    .map((log) => {
      try { return pool.interface.parseLog(log); } catch { return null; }
    })
    .find((log) => log?.name === "SwapSAMM");

  const outBalanceAfter = await tokens[testCase.tokenOut].balanceOf(signer.address);
  const inBalanceAfter = await tokens[testCase.tokenIn].balanceOf(signer.address);
  const feeAfter = feeBucketBefore.key === "A" ? await pool.collectedFeesA() : await pool.collectedFeesB();

  const actualAmountIn = parsedSwap ? parsedSwap.args.amountIn : inBalanceBefore - inBalanceAfter;
  const actualAmountOut = parsedSwap ? parsedSwap.args.amountOut : outBalanceAfter - outBalanceBefore;
  const actualTradeFee = parsedSwap ? parsedSwap.args.fee : quote.tradeFee;
  const actualTotalFee = feeAfter - feeBucketBefore.before;

  return {
    mode: "direct-shard",
    pair: testCase.pair,
    direction: `${testCase.tokenIn}->${testCase.tokenOut}`,
    shardAddress: testCase.shardAddress,
    shardTier: testCase.shardTier,
    liquidityUSD: testCase.shardLiquidityUSD,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    quotedAmountOut: formatFixed(toNumber(testCase.amountOut, tokenOutMeta.decimals), 8),
    quotedAmountIn: formatFixed(toNumber(quote.amountIn, tokenInMeta.decimals), 8),
    quotedTradeFee: formatFixed(toNumber(quote.tradeFee, tokenInMeta.decimals), 8),
    quotedOwnerFee: formatFixed(toNumber(quote.ownerFee, tokenInMeta.decimals), 8),
    quotedTotalFee: formatFixed(toNumber(quote.tradeFee + quote.ownerFee, tokenInMeta.decimals), 8),
    actualAmountIn: formatFixed(toNumber(actualAmountIn, tokenInMeta.decimals), 8),
    actualAmountOut: formatFixed(toNumber(actualAmountOut, tokenOutMeta.decimals), 8),
    actualTradeFee: formatFixed(toNumber(actualTradeFee, tokenInMeta.decimals), 8),
    actualTotalFee: formatFixed(toNumber(actualTotalFee, tokenInMeta.decimals), 8),
    effectiveRateOutPerIn: formatFixed(toNumber(actualAmountOut, tokenOutMeta.decimals) / toNumber(actualAmountIn, tokenInMeta.decimals), 10),
    totalFeePct: formatFixed((toNumber(actualTotalFee, tokenInMeta.decimals) / toNumber(actualAmountIn, tokenInMeta.decimals)) * 100, 6)
  };
}

async function executeRouterSingleHopCase(testCase, ctx) {
  const { tokens, deployment, signer, router, routerIface } = ctx;
  const tokenInMeta = deployment.contracts.tokens[testCase.tokenIn];
  const tokenOutMeta = deployment.contracts.tokens[testCase.tokenOut];
  const quote = await router.quoteSwap([
    {
      tokenIn: tokens[testCase.tokenIn].target,
      tokenOut: tokens[testCase.tokenOut].target,
      amountOut: testCase.amountOut
    }
  ]);

  const selectedShard = quote.selectedShards[0];
  const pairShards = deployment.contracts.shards[testCase.pair];
  const selectedShardMeta = pairShards.find((entry) => entry.address.toLowerCase() === selectedShard.toLowerCase());
  const selectedTier = classifyShard(selectedShardMeta || { address: selectedShard }, [...pairShards].sort((a, b) => a.liquidityUSD - b.liquidityUSD));

  const tx = await router.swapExactOutput({
    hops: [{ tokenIn: tokens[testCase.tokenIn].target, tokenOut: tokens[testCase.tokenOut].target, amountOut: testCase.amountOut }],
    maxAmountIn: (quote.expectedAmountIn * 110n) / 100n,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    recipient: signer.address
  }, { gasLimit: GAS_LIMIT });
  const receipt = await tx.wait();

  const hopEvent = receipt.logs
    .map((log) => {
      try { return routerIface.parseLog(log); } catch { return null; }
    })
    .find((log) => log?.name === "HopExecuted");

  return {
    mode: "router-single-hop",
    pair: testCase.pair,
    direction: `${testCase.tokenIn}->${testCase.tokenOut}`,
    expectedTier: testCase.targetTier,
    selectedTier,
    matchedExpectedTier: selectedShard.toLowerCase() === testCase.expectedShardAddress.toLowerCase(),
    shardAddress: selectedShard,
    liquidityUSD: selectedShardMeta?.liquidityUSD ?? null,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    quotedAmountOut: formatFixed(toNumber(testCase.amountOut, tokenOutMeta.decimals), 8),
    quotedAmountIn: formatFixed(toNumber(quote.expectedAmountIn, tokenInMeta.decimals), 8),
    quotedTotalFee: formatFixed(toNumber(quote.hopFees[0], tokenInMeta.decimals), 8),
    actualAmountIn: formatFixed(toNumber(hopEvent?.args.amountIn ?? quote.expectedAmountIn, tokenInMeta.decimals), 8),
    actualAmountOut: formatFixed(toNumber(hopEvent?.args.amountOut ?? testCase.amountOut, tokenOutMeta.decimals), 8),
    actualTradeFee: formatFixed(toNumber(hopEvent?.args.fee ?? 0n, tokenInMeta.decimals), 8),
    effectiveRateOutPerIn: formatFixed(toNumber(hopEvent?.args.amountOut ?? testCase.amountOut, tokenOutMeta.decimals) / toNumber(hopEvent?.args.amountIn ?? quote.expectedAmountIn, tokenInMeta.decimals), 10),
    totalFeePctQuoted: formatFixed((toNumber(quote.hopFees[0], tokenInMeta.decimals) / toNumber(quote.expectedAmountIn, tokenInMeta.decimals)) * 100, 6)
  };
}

async function executeRouterMultiHopCase(testCase, ctx) {
  const { tokens, deployment, signer, router, routerIface } = ctx;
  const firstTokenMeta = deployment.contracts.tokens[testCase.tokenIn];
  const finalTokenMeta = deployment.contracts.tokens[testCase.tokenOut];
  const hops = [
    { tokenIn: tokens[testCase.tokenIn].target, tokenOut: tokens[testCase.midToken].target, amountOut: testCase.midAmountOut },
    { tokenIn: tokens[testCase.midToken].target, tokenOut: tokens[testCase.tokenOut].target, amountOut: testCase.finalAmountOut }
  ];
  const quote = await router.quoteSwap(hops);
  const tx = await router.swapExactOutput({
    hops,
    maxAmountIn: (quote.expectedAmountIn * 110n) / 100n,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    recipient: signer.address
  }, { gasLimit: GAS_LIMIT });
  const receipt = await tx.wait();

  const hopEvents = receipt.logs
    .map((log) => {
      try { return routerIface.parseLog(log); } catch { return null; }
    })
    .filter((log) => log?.name === "HopExecuted");

  const selectedTiers = quote.selectedShards.map((address, index) => {
    const pairKey = getPairKey(
      index === 0 ? testCase.tokenIn : testCase.midToken,
      index === 0 ? testCase.midToken : testCase.tokenOut,
      deployment
    );
    const shards = deployment.contracts.shards[pairKey];
    const shardMeta = shards.find((entry) => entry.address.toLowerCase() === address.toLowerCase());
    return classifyShard(shardMeta || { address }, [...shards].sort((a, b) => a.liquidityUSD - b.liquidityUSD));
  });

  return {
    mode: "router-multi-hop",
    pair: `${testCase.tokenIn}->${testCase.midToken}->${testCase.tokenOut}`,
    direction: `${testCase.tokenIn}->${testCase.tokenOut}`,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    quotedFinalAmountOut: formatFixed(toNumber(testCase.finalAmountOut, finalTokenMeta.decimals), 8),
    quotedTotalAmountIn: formatFixed(toNumber(quote.expectedAmountIn, firstTokenMeta.decimals), 8),
    quotedHopFees: quote.hopFees.map((fee, index) => {
      const hopTokenIn = index === 0 ? testCase.tokenIn : testCase.midToken;
      return formatFixed(toNumber(fee, deployment.contracts.tokens[hopTokenIn].decimals), 8);
    }),
    selectedShards: quote.selectedShards,
    selectedTiers,
    hopResults: hopEvents.map((event, index) => {
      const hopTokenIn = index === 0 ? testCase.tokenIn : testCase.midToken;
      const hopTokenOut = index === 0 ? testCase.midToken : testCase.tokenOut;
      return {
        hopIndex: index,
        tokenIn: hopTokenIn,
        tokenOut: hopTokenOut,
        amountIn: formatFixed(toNumber(event.args.amountIn, deployment.contracts.tokens[hopTokenIn].decimals), 8),
        amountOut: formatFixed(toNumber(event.args.amountOut, deployment.contracts.tokens[hopTokenOut].decimals), 8),
        tradeFee: formatFixed(toNumber(event.args.fee, deployment.contracts.tokens[hopTokenIn].decimals), 8)
      };
    })
  };
}

async function main() {
  const deploymentFile = findLatestDeployment();
  const deploymentPath = path.join(__dirname, "..", "deployment-data", deploymentFile);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const [signer] = await ethers.getSigners();
  const provider = ethers.provider;

  console.log("🧪 RiseChain Swap Matrix Validation");
  console.log("=".repeat(72));
  console.log(`Deployment: ${deploymentFile}`);
  console.log(`Signer:     ${signer.address}`);

  const tokens = {};
  for (const [symbol, meta] of Object.entries(deployment.contracts.tokens)) {
    tokens[symbol] = new ethers.Contract(meta.address, TOKEN_ABI, signer);
  }

  const router = new ethers.Contract(deployment.contracts.router, ROUTER_ABI, signer);
  const routerIface = new ethers.Interface(ROUTER_ABI);

  const poolMap = new Map();
  for (const shards of Object.values(deployment.contracts.shards)) {
    for (const shard of shards) {
      poolMap.set(shard.address, new ethers.Contract(shard.address, POOL_ABI, signer));
    }
  }

  await ensureBalances(tokens, signer, deployment);
  await approveEverywhere(tokens, deployment, deployment.contracts.router);

  const directCases = [];
  for (const [pairKey, shards] of Object.entries(deployment.contracts.shards)) {
    const sorted = [...shards].sort((a, b) => a.liquidityUSD - b.liquidityUSD);
    const [symbolA, symbolB] = pairKey.split("-");
    for (const shard of sorted) {
      const pool = poolMap.get(shard.address);
      const directions = [
        { tokenIn: symbolA, tokenOut: symbolB },
        { tokenIn: symbolB, tokenOut: symbolA }
      ];
      for (const direction of directions) {
        const reserveOut = await getReserveForOutput(pool, deployment.contracts.tokens[direction.tokenOut].address);
        const comfortableAmountOut = (reserveOut * 9600n) / 5_000_000n;
        if (comfortableAmountOut > 0n) {
          directCases.push({
            kind: "direct-shard",
            pair: pairKey,
            tokenIn: direction.tokenIn,
            tokenOut: direction.tokenOut,
            amountOut: comfortableAmountOut,
            shardAddress: shard.address,
            shardTier: classifyShard(shard, sorted),
            shardLiquidityUSD: shard.liquidityUSD
          });
        }
      }
    }
  }

  const routerSingleHopCases = [];
  for (const [pairKey, shards] of Object.entries(deployment.contracts.shards)) {
    const cases = await buildRouterTierCases(pairKey, shards, deployment, tokens, poolMap);
    routerSingleHopCases.push(...cases);
  }

  const routerMultiHopCases = [];
  const pairKeys = Object.keys(deployment.contracts.shards);
  // Build multi-hop cases for all A→mid→B paths where both legs exist
  const tokenSymbols = Object.keys(deployment.contracts.tokens);
  for (const midToken of tokenSymbols) {
    for (const tokenIn of tokenSymbols) {
      if (tokenIn === midToken) continue;
      for (const tokenOut of tokenSymbols) {
        if (tokenOut === midToken || tokenOut === tokenIn) continue;
        // Check both legs exist as pool pairs
        let leg1Exists = false, leg2Exists = false;
        try { getPairKey(tokenIn, midToken, deployment); leg1Exists = true; } catch {}
        try { getPairKey(midToken, tokenOut, deployment); leg2Exists = true; } catch {}
        if (!leg1Exists || !leg2Exists) continue;

        // Compute safe amounts (well under c-threshold)
        const midMeta = deployment.contracts.tokens[midToken];
        const outMeta = deployment.contracts.tokens[tokenOut];
        const isMidStable = ["USDC","USDT","DAI"].includes(midToken);
        const isOutStable = ["USDC","USDT","DAI"].includes(tokenOut);
        const isOutWBTC = tokenOut === "WBTC";
        const isOutWETH = tokenOut === "WETH";
        const midAmountOut = ethers.parseUnits(isMidStable ? "3000" : midToken === "WBTC" ? "0.01" : "1", midMeta.decimals);
        const finalAmountOut = ethers.parseUnits(isOutStable ? "2500" : isOutWBTC ? "0.005" : isOutWETH ? "0.5" : "1", outMeta.decimals);

        routerMultiHopCases.push({
          kind: "router-multi-hop",
          tokenIn,
          midToken,
          tokenOut,
          midAmountOut,
          finalAmountOut
        });
      }
    }
  }

  const results = [];
  const failures = [];

  const ctx = { tokens, deployment, signer, provider, router, routerIface, poolMap };

  for (const testCase of directCases) {
    try {
      console.log(`→ Direct ${testCase.pair} ${testCase.tokenIn}->${testCase.tokenOut} on ${testCase.shardTier}`);
      results.push(await executeDirectShardCase(testCase, ctx));
    } catch (error) {
      failures.push({ case: testCase, error: error.message });
      console.log(`   ❌ ${error.message.slice(0, 120)}`);
    }
  }

  for (const testCase of routerSingleHopCases) {
    try {
      console.log(`→ Router ${testCase.pair} ${testCase.tokenIn}->${testCase.tokenOut} expect ${testCase.targetTier}`);
      results.push(await executeRouterSingleHopCase(testCase, ctx));
    } catch (error) {
      failures.push({ case: testCase, error: error.message });
      console.log(`   ❌ ${error.message.slice(0, 120)}`);
    }
  }

  for (const testCase of routerMultiHopCases) {
    try {
      console.log(`→ Multi-hop ${testCase.tokenIn}->${testCase.midToken}->${testCase.tokenOut}`);
      results.push(await executeRouterMultiHopCase(testCase, ctx));
    } catch (error) {
      failures.push({ case: testCase, error: error.message });
      console.log(`   ❌ ${error.message.slice(0, 120)}`);
    }
  }

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      deploymentFile,
      network: deployment.network,
      chainId: deployment.chainId,
      signer: signer.address
    },
    summary: {
      totalCases: results.length + failures.length,
      passed: results.length,
      failed: failures.length,
      routerTierMatches: results.filter((entry) => entry.mode === "router-single-hop" && entry.matchedExpectedTier).length,
      routerTierChecks: results.filter((entry) => entry.mode === "router-single-hop").length
    },
    results,
    failures
  };

  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `risechain-swap-matrix-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log("\n" + "=".repeat(72));
  console.log("✅ Swap matrix complete");
  console.log(`Passed: ${report.summary.passed}`);
  console.log(`Failed: ${report.summary.failed}`);
  console.log(`Router tier matches: ${report.summary.routerTierMatches}/${report.summary.routerTierChecks}`);
  console.log(`Report: ${reportPath}`);

  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("❌ Swap matrix failed", error);
  process.exit(1);
});
