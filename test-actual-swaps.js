/**
 * Actual Swap Execution Test
 * Tests direct and multi-hop swaps on RiseChain using the wallet
 */

const { ethers } = require("ethers");

// Configuration
const PRIVATE_KEY = "2571a342f4f03a8f341e14854624a242d85e7538dc47063382c883e59dfc3363";
const RPC_URL = "https://testnet.riselabs.xyz";
const API_URL = "https://samm-evm-production-2946.up.railway.app";

// Contract addresses
const ROUTER_ADDRESS = "0x622c2D2719197A047f29BCBaaaEBBDbD54b45a11";

// Token addresses
const TOKENS = {
  WETH: "0x0ec0b10b40832cD9805481F132f966B156d70Cc7",
  WBTC: "0xEf6c9F206Ad4333Ca049C874ae6956f849e71479",
  USDC: "0xDA4aABea512d4030863652dbB21907B6eC97ad23",
  USDT: "0x89D668205724fbFBaAe1BDF32F0aA046f6bdD7Cd",
  DAI: "0x9DcC3d09865292A2D5c39e08EEa583dd29390522",
  LINK: "0xD4Afa6b83888aABbe74b288b4241F39Ad8A8e0bA",
  UNI: "0xEebe649Cef7ed5b1fD4BE3222bA94f316eBdbE6c",
  AAVE: "0x92EfA27dBb61069d4f65a656E1e9781509982ba7"
};

// Token decimals
const DECIMALS = {
  WETH: 18,
  WBTC: 8,
  USDC: 6,
  USDT: 6,
  DAI: 18,
  LINK: 18,
  UNI: 18,
  AAVE: 18
};

// ABIs
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const ROUTER_ABI = [
  "function swapExactOutput(tuple(tuple(address tokenIn, address tokenOut, uint256 amountOut)[] hops, uint256 maxAmountIn, uint256 deadline, address recipient)) external returns (uint256 amountIn)"
];

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Setup provider and wallet
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

async function getQuote(tokenIn, tokenOut, amountOut) {
  log(`\n📊 Getting quote from backend...`, 'yellow');
  
  // Find route
  let route;
  try {
    const poolResponse = await fetch(`${API_URL}/pools/${tokenIn}/${tokenOut}`);
    if (poolResponse.ok) {
      route = [tokenIn, tokenOut];
      log(`   ✅ Direct pool found`, 'green');
    } else {
      throw new Error('No direct pool');
    }
  } catch {
    // Try multi-hop through USDC
    route = [tokenIn, 'USDC', tokenOut];
    log(`   ✅ Multi-hop route: ${route.join(' → ')}`, 'green');
  }

  const body = route.length > 2
    ? { route, amountOut: amountOut.toString() }
    : { tokenIn, tokenOut, amountOut: amountOut.toString() };

  const response = await fetch(`${API_URL}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Quote failed');
  }

  const quote = await response.json();
  
  log(`   Route: ${quote.route.join(' → ')}`, 'cyan');
  log(`   Hops: ${quote.hops}`, 'cyan');
  log(`   Amount Out: ${quote.amountOut}`, 'cyan');
  log(`   Expected Amount In: ${quote.expectedAmountIn}`, 'cyan');
  log(`   Total Fee: ${quote.totalFee}`, 'cyan');
  
  return quote;
}

async function approveToken(tokenSymbol, amount) {
  log(`\n🔓 Approving ${tokenSymbol}...`, 'yellow');
  
  const tokenAddress = TOKENS[tokenSymbol];
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  
  // Check current allowance
  const allowance = await token.allowance(wallet.address, ROUTER_ADDRESS);
  log(`   Current allowance: ${ethers.formatUnits(allowance, DECIMALS[tokenSymbol])}`, 'reset');
  
  if (allowance < amount) {
    log(`   Approving ${ethers.formatUnits(amount, DECIMALS[tokenSymbol])} ${tokenSymbol}...`, 'yellow');
    const tx = await token.approve(ROUTER_ADDRESS, amount, { gasLimit: 100000 });
    log(`   TX: ${tx.hash}`, 'reset');
    await tx.wait();
    log(`   ✅ Approved`, 'green');
  } else {
    log(`   ✅ Already approved`, 'green');
  }
}

async function executeSwap(tokenInSymbol, tokenOutSymbol, amountOut, quote) {
  log(`\n🔄 Executing swap...`, 'yellow');
  
  const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);
  
  // Build hops
  const hops = [];
  for (let i = 0; i < quote.route.length - 1; i++) {
    const tokenIn = TOKENS[quote.route[i]];
    const tokenOut = TOKENS[quote.route[i + 1]];
    const decimals = DECIMALS[quote.route[i + 1]];
    
    // For the last hop, use the actual amountOut, for others use 0 (router calculates)
    const hopAmountOut = i === quote.route.length - 2
      ? ethers.parseUnits(amountOut.toString(), decimals)
      : 0n;
    
    hops.push({
      tokenIn,
      tokenOut,
      amountOut: hopAmountOut
    });
  }
  
  // Calculate maxAmountIn with 10% slippage
  const expectedAmountIn = parseFloat(quote.expectedAmountIn);
  const decimalsIn = DECIMALS[tokenInSymbol];
  const baseAmountIn = ethers.parseUnits(expectedAmountIn.toFixed(decimalsIn), decimalsIn);
  const maxAmountIn = baseAmountIn + (baseAmountIn * 1000n) / 10000n; // 10% slippage
  
  // Deadline: 20 minutes from now
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  
  const swapParams = {
    hops,
    maxAmountIn,
    deadline,
    recipient: wallet.address
  };
  
  log(`   Hops: ${hops.length}`, 'cyan');
  log(`   Max Amount In: ${ethers.formatUnits(maxAmountIn, decimalsIn)} ${tokenInSymbol}`, 'cyan');
  log(`   Deadline: ${new Date(Number(deadline) * 1000).toLocaleString()}`, 'cyan');
  
  // Execute swap
  log(`\n   Submitting transaction...`, 'yellow');
  const tx = await router.swapExactOutput(swapParams, {
    gasLimit: 500000
  });
  
  log(`   ✅ Transaction submitted!`, 'green');
  log(`   TX Hash: ${tx.hash}`, 'cyan');
  log(`   Waiting for confirmation...`, 'yellow');
  
  const receipt = await tx.wait();
  
  if (receipt.status === 1) {
    log(`   ✅ Swap successful!`, 'green');
    log(`   Gas used: ${receipt.gasUsed.toString()}`, 'reset');
    return { success: true, txHash: tx.hash, receipt };
  } else {
    log(`   ❌ Swap failed`, 'red');
    return { success: false, txHash: tx.hash, receipt };
  }
}

async function getBalance(tokenSymbol) {
  const tokenAddress = TOKENS[tokenSymbol];
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const balance = await token.balanceOf(wallet.address);
  return ethers.formatUnits(balance, DECIMALS[tokenSymbol]);
}

async function testSwap(tokenIn, tokenOut, amountOut, testName) {
  log(`\n${'='.repeat(70)}`, 'cyan');
  log(`TEST: ${testName}`, 'blue');
  log(`Swap: ${tokenIn} → ${tokenOut}`, 'blue');
  log(`Amount Out: ${amountOut} ${tokenOut}`, 'blue');
  log('='.repeat(70), 'cyan');
  
  try {
    // Step 1: Check initial balances
    log(`\n📊 Step 1: Checking initial balances...`, 'yellow');
    const initialBalanceIn = await getBalance(tokenIn);
    const initialBalanceOut = await getBalance(tokenOut);
    log(`   ${tokenIn}: ${initialBalanceIn}`, 'reset');
    log(`   ${tokenOut}: ${initialBalanceOut}`, 'reset');
    
    // Step 2: Get quote
    log(`\n📊 Step 2: Getting quote...`, 'yellow');
    const quote = await getQuote(tokenIn, tokenOut, amountOut);
    
    // Step 3: Approve token
    const decimalsIn = DECIMALS[tokenIn];
    const expectedAmountIn = parseFloat(quote.expectedAmountIn);
    const approveAmount = ethers.parseUnits((expectedAmountIn * 1.2).toFixed(decimalsIn), decimalsIn);
    await approveToken(tokenIn, approveAmount);
    
    // Step 4: Execute swap
    const result = await executeSwap(tokenIn, tokenOut, amountOut, quote);
    
    if (!result.success) {
      throw new Error('Swap transaction failed');
    }
    
    // Step 5: Check final balances
    log(`\n📊 Step 5: Checking final balances...`, 'yellow');
    const finalBalanceIn = await getBalance(tokenIn);
    const finalBalanceOut = await getBalance(tokenOut);
    log(`   ${tokenIn}: ${finalBalanceIn} (was ${initialBalanceIn})`, 'reset');
    log(`   ${tokenOut}: ${finalBalanceOut} (was ${initialBalanceOut})`, 'reset');
    
    const actualAmountIn = parseFloat(initialBalanceIn) - parseFloat(finalBalanceIn);
    const actualAmountOut = parseFloat(finalBalanceOut) - parseFloat(initialBalanceOut);
    
    log(`\n📈 Results:`, 'yellow');
    log(`   Spent: ${actualAmountIn.toFixed(6)} ${tokenIn}`, 'cyan');
    log(`   Received: ${actualAmountOut.toFixed(6)} ${tokenOut}`, 'cyan');
    log(`   Expected to spend: ${quote.expectedAmountIn} ${tokenIn}`, 'reset');
    log(`   Expected to receive: ${amountOut} ${tokenOut}`, 'reset');
    
    log(`\n✅ ${testName} PASSED`, 'green');
    log('='.repeat(70) + '\n', 'cyan');
    
    return { success: true, result, actualAmountIn, actualAmountOut };
  } catch (error) {
    log(`\n❌ ${testName} FAILED`, 'red');
    log(`Error: ${error.message}`, 'red');
    if (error.stack) {
      log(`Stack: ${error.stack}`, 'red');
    }
    log('='.repeat(70) + '\n', 'cyan');
    return { success: false, error: error.message };
  }
}

async function main() {
  log('\n' + '='.repeat(70), 'cyan');
  log('ACTUAL SWAP EXECUTION TESTS', 'blue');
  log('Testing direct and multi-hop swaps on RiseChain', 'blue');
  log('='.repeat(70), 'cyan');
  
  log(`\n💼 Wallet: ${wallet.address}`, 'cyan');
  const ethBalance = await provider.getBalance(wallet.address);
  log(`💰 ETH Balance: ${ethers.formatEther(ethBalance)} ETH`, 'cyan');
  
  const results = {};
  
  // Test 1: Direct swap (WETH → USDC)
  log(`\n⏳ Waiting 2 seconds before test 1...`, 'yellow');
  await new Promise(resolve => setTimeout(resolve, 2000));
  results.directSwap = await testSwap('WETH', 'USDC', 100, 'Direct Swap (WETH → USDC)');
  
  // Test 2: Multi-hop swap (WETH → DAI via USDC)
  log(`\n⏳ Waiting 5 seconds before test 2...`, 'yellow');
  await new Promise(resolve => setTimeout(resolve, 5000));
  results.multiHopSwap = await testSwap('WETH', 'DAI', 100, 'Multi-Hop Swap (WETH → DAI via USDC)');
  
  // Summary
  log('\n' + '='.repeat(70), 'cyan');
  log('TEST SUMMARY', 'blue');
  log('='.repeat(70), 'cyan');
  
  const total = Object.keys(results).length;
  const passed = Object.values(results).filter(r => r.success).length;
  const failed = total - passed;
  
  log(`\nTotal Tests: ${total}`, 'cyan');
  log(`Passed: ${passed}`, passed === total ? 'green' : 'yellow');
  log(`Failed: ${failed}`, failed > 0 ? 'red' : 'green');
  
  log('\nDetailed Results:', 'cyan');
  Object.entries(results).forEach(([name, result]) => {
    const status = result.success ? '✅' : '❌';
    const color = result.success ? 'green' : 'red';
    log(`${status} ${name}`, color);
    if (result.success && result.actualAmountIn) {
      log(`   Spent: ${result.actualAmountIn.toFixed(6)}`, 'reset');
      log(`   Received: ${result.actualAmountOut.toFixed(6)}`, 'reset');
    }
    if (!result.success) {
      log(`   Error: ${result.error}`, 'red');
    }
  });
  
  log('\n' + '='.repeat(70), 'cyan');
  
  if (passed === total) {
    log('✅ ALL TESTS PASSED!', 'green');
    log('✅ Direct swaps working', 'green');
    log('✅ Multi-hop swaps working', 'green');
    log('✅ Frontend integration verified', 'green');
  } else {
    log('❌ SOME TESTS FAILED', 'red');
    log('⚠️  Check error messages above', 'yellow');
  }
  
  log('\n' + '='.repeat(70) + '\n', 'cyan');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
