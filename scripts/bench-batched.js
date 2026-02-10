/**
 * Batched JSON-RPC Benchmark
 * 
 * Uses JSON-RPC batching to submit multiple transactions in a single HTTP request
 * This bypasses RPC rate limits and achieves maximum TPS
 * 
 * RiseChain limit: 350 requests / 10 seconds
 * With batching: 350 batches × 100 txs/batch = 35,000 txs / 10 seconds = 3,500 TPS theoretical max
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const https = require("https");

function getLatestDeployment() {
  const deployDir = path.join(process.cwd(), "deployment-data");
  const files = fs.readdirSync(deployDir)
    .filter(f => f.startsWith("production-risechain-") && f.endsWith(".json"))
    .sort().reverse();
  return path.join(deployDir, files[0]);
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
}

async function main() {
  const rpcUrl = process.env.RISECHAIN_RPC_URL || "https://testnet.riselabs.xyz/http";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set");
  const signer = new ethers.Wallet(privateKey, provider);
  
  const cfg = JSON.parse(fs.readFileSync(getLatestDeployment(), "utf8"));
  
  const txCount = Number(process.env.TX_COUNT || "1000");
  const batchSize = Number(process.env.BATCH_SIZE || "100"); // Transactions per batch
  const swapAmount = process.env.SWAP_AMOUNT || "5";
  
  console.log(`\n=== Batched JSON-RPC Benchmark ===`);
  console.log(`Total Transactions: ${txCount}`);
  console.log(`Batch Size: ${batchSize} txs per RPC call`);
  console.log(`Total Batches: ${Math.ceil(txCount / batchSize)}`);
  console.log(`Signer: ${signer.address}`);
  console.log(`\nThis uses JSON-RPC batching to submit multiple txs in one HTTP request`);
  console.log(`RiseChain limit: 350 RPC calls / 10 seconds`);
  console.log(`Theoretical max: 350 × ${batchSize} = ${350 * batchSize} txs / 10 seconds = ${(350 * batchSize) / 10} TPS\n`);
  
  // Get all stablecoin pools
  const pools = [];
  for (const pair of ["USDC-USDT", "USDC-DAI", "USDT-DAI"]) {
    if (cfg.contracts.shards[pair]) {
      for (const shard of cfg.contracts.shards[pair]) {
        const [symbolA, symbolB] = pair.split("-");
        pools.push({
          address: shard.address,
          name: shard.name,
          tokenA: cfg.contracts.tokens[symbolA].address,
          tokenB: cfg.contracts.tokens[symbolB].address,
          decimalsA: cfg.contracts.tokens[symbolA].decimals,
        });
      }
    }
  }
  
  console.log(`Using ${pools.length} pools\n`);
  
  const amountOut = ethers.parseUnits(swapAmount, 6);
  const maxAmountIn = amountOut * 100n / 10n; // 10x slippage tolerance
  
  const poolABI = ["function swapSAMM(uint256,uint256,address,address,address) external returns (uint256)"];
  
  // Get starting nonce
  let nonce = await provider.getTransactionCount(signer.address, "pending");
  console.log(`Starting nonce: ${nonce}\n`);
  
  // Pre-sign all transactions
  console.log(`📝 Pre-signing ${txCount} transactions...`);
  const signedTxs = [];
  
  for (let i = 0; i < txCount; i++) {
    const pool = pools[i % pools.length];
    const poolContract = new ethers.Contract(pool.address, poolABI, signer);
    
    const tx = await poolContract.swapSAMM.populateTransaction(
      amountOut,
      maxAmountIn,
      pool.tokenA,
      pool.tokenB,
      signer.address
    );
    
    tx.nonce = nonce++;
    tx.gasLimit = 250000;
    tx.chainId = 11155931;
    
    const signedTx = await signer.signTransaction(tx);
    signedTxs.push(signedTx);
    
    if ((i + 1) % 100 === 0) {
      process.stdout.write(`\rSigned: ${i + 1}/${txCount}`);
    }
  }
  
  console.log(`\n✅ All transactions pre-signed\n`);
  
  // Create batches
  const batches = [];
  for (let i = 0; i < signedTxs.length; i += batchSize) {
    batches.push(signedTxs.slice(i, i + batchSize));
  }
  
  console.log(`📦 Created ${batches.length} batches\n`);
  console.log(`=== Starting Batched Submission ===\n`);
  
  const start = Date.now();
  const txHashes = [];
  const batchLatencies = [];
  let batchesSent = 0;
  let failed = 0;
  
  // Send batches with controlled concurrency
  const maxConcurrentBatches = 10; // Don't overwhelm the RPC
  const inFlight = new Set();
  
  async function sendBatch(batch, batchIdx) {
    const batchStart = Date.now();
    
    try {
      // Build JSON-RPC batch request
      const rpcBatch = batch.map((signedTx, idx) => ({
        jsonrpc: "2.0",
        method: "eth_sendRawTransaction",
        params: [signedTx],
        id: batchIdx * batchSize + idx
      }));
      
      // Send batch as single HTTP request
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rpcBatch)
      });
      
      const results = await response.json();
      const batchLatency = Date.now() - batchStart;
      batchLatencies.push(batchLatency);
      
      // Process results
      if (Array.isArray(results)) {
        for (const result of results) {
          if (result.result) {
            txHashes.push(result.result);
          } else if (result.error) {
            // Log first few errors
            if (txHashes.length + failed < 5) {
              console.error(`\nTx error:`, result.error.message || result.error);
            }
            failed++;
          }
        }
      } else if (results.error) {
        console.error(`\nBatch error:`, results.error.message || results.error);
        failed += batch.length;
      }
      
      batchesSent++;
      process.stdout.write(`\rBatches sent: ${batchesSent}/${batches.length}, Txs submitted: ${txHashes.length}, Failed: ${failed}/${txCount}`);
      
    } catch (error) {
      console.error(`\nBatch ${batchIdx} failed:`, error.message);
    }
  }
  
  // Send all batches with concurrency control
  for (let i = 0; i < batches.length; i++) {
    const p = sendBatch(batches[i], i).finally(() => inFlight.delete(p));
    inFlight.add(p);
    
    // Wait if we hit max concurrent batches
    if (inFlight.size >= maxConcurrentBatches) {
      await Promise.race(inFlight);
    }
  }
  
  // Wait for all batches to complete
  await Promise.all(inFlight);
  
  const submissionTime = (Date.now() - start) / 1000;
  
  console.log(`\n\n⏱️  Submission complete in ${submissionTime.toFixed(2)}s`);
  console.log(`📊 Submission TPS: ${(txHashes.length / submissionTime).toFixed(2)}\n`);
  
  // Now wait for confirmations
  console.log(`⏳ Waiting for confirmations (sampling 100 txs)...`);
  
  const sampleSize = Math.min(100, txHashes.length);
  const sampleHashes = [];
  for (let i = 0; i < sampleSize; i++) {
    const idx = Math.floor((i / sampleSize) * txHashes.length);
    sampleHashes.push(txHashes[idx]);
  }
  
  let confirmed = 0;
  let failedConfirmations = 0;
  const confirmLatencies = [];
  
  const confirmStart = Date.now();
  
  await Promise.all(sampleHashes.map(async (hash) => {
    const txStart = Date.now();
    try {
      const receipt = await provider.waitForTransaction(hash, 1, 30000);
      const latency = Date.now() - txStart;
      confirmLatencies.push(latency);
      
      if (receipt && receipt.status === 1) {
        confirmed++;
      } else {
        failedConfirmations++;
      }
    } catch (error) {
      failedConfirmations++;
    }
    
    process.stdout.write(`\rConfirmed: ${confirmed}, Failed: ${failedConfirmations}, Pending: ${sampleSize - confirmed - failedConfirmations}`);
  }));
  
  const confirmTime = (Date.now() - confirmStart) / 1000;
  const totalTime = (Date.now() - start) / 1000;
  
  console.log(`\n\n${"=".repeat(60)}`);
  console.log(`📊 BATCHED BENCHMARK RESULTS`);
  console.log(`${"=".repeat(60)}\n`);
  
  console.log(`Transactions:`);
  console.log(`  Total Submitted: ${txHashes.length}`);
  console.log(`  Total Failed: ${failed}`);
  console.log(`  Batch Size: ${batchSize} txs/batch`);
  console.log(`  Total Batches: ${batches.length}`);
  console.log(`  Sample Confirmed: ${confirmed}/${sampleSize}`);
  console.log(`  Sample Failed: ${failedConfirmations}/${sampleSize}`);
  console.log(`  Submission Success Rate: ${((txHashes.length / txCount) * 100).toFixed(2)}%`);
  console.log(`  Confirmation Success Rate: ${sampleSize > 0 ? ((confirmed / sampleSize) * 100).toFixed(2) : 0}%\n`);
  
  console.log(`Performance:`);
  console.log(`  Submission Time: ${submissionTime.toFixed(2)}s`);
  console.log(`  Confirmation Time: ${confirmTime.toFixed(2)}s (sample)`);
  console.log(`  Total Time: ${totalTime.toFixed(2)}s\n`);
  
  console.log(`*** SUBMISSION TPS: ${(txHashes.length / submissionTime).toFixed(2)} ***`);
  console.log(`*** CONFIRMED TPS: ${(confirmed * txHashes.length / sampleSize / totalTime).toFixed(2)} ***\n`);
  
  if (batchLatencies.length > 0) {
    console.log(`Batch Latency (ms):`);
    console.log(`  p50: ${percentile(batchLatencies, 50)}`);
    console.log(`  p95: ${percentile(batchLatencies, 95)}`);
    console.log(`  p99: ${percentile(batchLatencies, 99)}`);
    console.log(`  avg: ${Math.round(batchLatencies.reduce((a, b) => a + b, 0) / batchLatencies.length)}`);
    console.log(`  min: ${Math.min(...batchLatencies)}`);
    console.log(`  max: ${Math.max(...batchLatencies)}\n`);
  }
  
  if (confirmLatencies.length > 0) {
    console.log(`Confirmation Latency (ms):`);
    console.log(`  p50: ${percentile(confirmLatencies, 50)}`);
    console.log(`  p95: ${percentile(confirmLatencies, 95)}`);
    console.log(`  p99: ${percentile(confirmLatencies, 99)}`);
    console.log(`  avg: ${Math.round(confirmLatencies.reduce((a, b) => a + b, 0) / confirmLatencies.length)}\n`);
  }
  
  console.log(`Sample Transaction Hashes:`);
  const samples = [0, 10, 50, 100, 500].filter(i => i < txHashes.length);
  for (const idx of samples) {
    console.log(`  Tx ${idx}: ${txHashes[idx]}`);
  }
  console.log(`\nView on explorer: https://testnet.riselabs.xyz/tx/[hash]\n`);
  
  console.log(`${"=".repeat(60)}`);
  console.log(`🎯 KEY INSIGHTS`);
  console.log(`${"=".repeat(60)}\n`);
  console.log(`1. JSON-RPC BATCHING:`);
  console.log(`   - Sent ${batches.length} batches (${batchSize} txs each)`);
  console.log(`   - Used only ${batches.length} RPC calls instead of ${txHashes.length}`);
  console.log(`   - ${Math.round(txHashes.length / batches.length)}x reduction in RPC calls!\n`);
  
  console.log(`2. RPC LIMIT COMPLIANCE:`);
  console.log(`   - RiseChain limit: 350 RPC calls / 10 seconds`);
  console.log(`   - We used: ${batches.length} RPC calls in ${submissionTime.toFixed(2)}s`);
  console.log(`   - Rate: ${(batches.length / submissionTime * 10).toFixed(1)} RPC calls / 10 seconds`);
  console.log(`   - ${batches.length <= 350 ? '✅ Within limits!' : '⚠️  Exceeded limits'}\n`);
  
  console.log(`3. THEORETICAL MAXIMUM:`);
  console.log(`   - With 350 RPC calls / 10 seconds`);
  console.log(`   - And ${batchSize} txs per batch`);
  console.log(`   - Max throughput: ${350 * batchSize} txs / 10 seconds = ${(350 * batchSize) / 10} TPS\n`);
  
  console.log(`4. ACTUAL RESULTS:`);
  console.log(`   - Achieved submission rate: ${(txHashes.length / submissionTime).toFixed(2)} TPS`);
  console.log(`   - Confirmed TPS (estimated): ${(confirmed * txHashes.length / sampleSize / totalTime).toFixed(2)} TPS`);
  console.log(`   - Bottleneck: ${submissionTime < confirmTime ? 'Chain execution' : 'RPC submission'}\n`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
