require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Ethereum provider setup
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://localhost:8545');

// Contract ABIs (simplified - load full ABI from artifacts in production)
const SAMM_POOL_ABI = [
  "function getReserves() view returns (uint256 reserveA, uint256 reserveB)",
  "function calculateSwapSAMM(uint256 amountOut, address tokenIn, address tokenOut) view returns (tuple(uint256 amountIn, uint256 amountOut, uint256 tradeFee, uint256 ownerFee))",
  "function getPoolState() view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalSupply, uint256 tradeFeeNumerator, uint256 tradeFeeDenominator, uint256 ownerFeeNumerator, uint256 ownerFeeDenominator))",
  "function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) pure returns (uint256 amountB)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

// Initialize contracts
let sammPool, tokenA, tokenB;

async function initializeContracts() {
  try {
    const poolAddress = process.env.SAMM_POOL_ADDRESS;
    const tokenAAddress = process.env.TOKEN_A_ADDRESS;
    const tokenBAddress = process.env.TOKEN_B_ADDRESS;

    if (!poolAddress || !tokenAAddress || !tokenBAddress) {
      console.warn('Warning: Contract addresses not configured. Please set them in .env file.');
      return;
    }

    sammPool = new ethers.Contract(poolAddress, SAMM_POOL_ABI, provider);
    tokenA = new ethers.Contract(tokenAAddress, ERC20_ABI, provider);
    tokenB = new ethers.Contract(tokenBAddress, ERC20_ABI, provider);

    console.log('Contracts initialized successfully');
  } catch (error) {
    console.error('Error initializing contracts:', error);
  }
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get pool information
app.get('/api/pool/info', async (req, res) => {
  try {
    if (!sammPool) {
      return res.status(503).json({ error: 'Pool not initialized' });
    }

    const [poolState, tokenAInfo, tokenBInfo] = await Promise.all([
      sammPool.getPoolState(),
      Promise.all([tokenA.name(), tokenA.symbol(), tokenA.decimals()]),
      Promise.all([tokenB.name(), tokenB.symbol(), tokenB.decimals()]),
    ]);

    res.json({
      pool: {
        address: process.env.SAMM_POOL_ADDRESS,
        reserveA: poolState.reserveA.toString(),
        reserveB: poolState.reserveB.toString(),
        totalSupply: poolState.totalSupply.toString(),
        fees: {
          tradeFeeNumerator: poolState.tradeFeeNumerator.toString(),
          tradeFeeDenominator: poolState.tradeFeeDenominator.toString(),
          ownerFeeNumerator: poolState.ownerFeeNumerator.toString(),
          ownerFeeDenominator: poolState.ownerFeeDenominator.toString(),
        },
      },
      tokenA: {
        address: poolState.tokenA,
        name: tokenAInfo[0],
        symbol: tokenAInfo[1],
        decimals: tokenAInfo[2],
      },
      tokenB: {
        address: poolState.tokenB,
        name: tokenBInfo[0],
        symbol: tokenBInfo[1],
        decimals: tokenBInfo[2],
      },
    });
  } catch (error) {
    console.error('Error fetching pool info:', error);
    res.status(500).json({ error: 'Failed to fetch pool information' });
  }
});

// Get current reserves
app.get('/api/pool/reserves', async (req, res) => {
  try {
    if (!sammPool) {
      return res.status(503).json({ error: 'Pool not initialized' });
    }

    const [reserveA, reserveB] = await sammPool.getReserves();

    res.json({
      reserveA: reserveA.toString(),
      reserveB: reserveB.toString(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching reserves:', error);
    res.status(500).json({ error: 'Failed to fetch reserves' });
  }
});

// Calculate SAMM swap quote
app.post('/api/swap/quote', async (req, res) => {
  try {
    if (!sammPool) {
      return res.status(503).json({ error: 'Pool not initialized' });
    }

    const { amountOut, tokenIn, tokenOut } = req.body;

    if (!amountOut || !tokenIn || !tokenOut) {
      return res.status(400).json({ error: 'Missing required parameters: amountOut, tokenIn, tokenOut' });
    }

    // Validate token addresses
    const poolState = await sammPool.getPoolState();
    const validTokens = [poolState.tokenA.toLowerCase(), poolState.tokenB.toLowerCase()];

    if (!validTokens.includes(tokenIn.toLowerCase()) || !validTokens.includes(tokenOut.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid token addresses' });
    }

    if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
      return res.status(400).json({ error: 'Tokens must be different' });
    }

    // Calculate swap
    const result = await sammPool.calculateSwapSAMM(amountOut, tokenIn, tokenOut);

    res.json({
      amountIn: result.amountIn.toString(),
      amountOut: result.amountOut.toString(),
      tradeFee: result.tradeFee.toString(),
      ownerFee: result.ownerFee.toString(),
      priceImpact: calculatePriceImpact(
        result.amountIn,
        result.amountOut,
        tokenIn.toLowerCase() === poolState.tokenA.toLowerCase() ? poolState.reserveA : poolState.reserveB,
        tokenIn.toLowerCase() === poolState.tokenA.toLowerCase() ? poolState.reserveB : poolState.reserveA
      ),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error calculating swap quote:', error);
    res.status(500).json({ error: 'Failed to calculate swap quote' });
  }
});

// Get price (simple quote)
app.get('/api/price', async (req, res) => {
  try {
    if (!sammPool) {
      return res.status(503).json({ error: 'Pool not initialized' });
    }

    const { amountA } = req.query;

    if (!amountA) {
      return res.status(400).json({ error: 'Missing required parameter: amountA' });
    }

    const [reserveA, reserveB] = await sammPool.getReserves();
    const amountB = await sammPool.quote(amountA, reserveA, reserveB);

    res.json({
      amountA: amountA.toString(),
      amountB: amountB.toString(),
      price: (Number(amountB) / Number(amountA)).toString(),
      reserveA: reserveA.toString(),
      reserveB: reserveB.toString(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error calculating price:', error);
    res.status(500).json({ error: 'Failed to calculate price' });
  }
});

// Get user balances
app.get('/api/user/:address/balances', async (req, res) => {
  try {
    if (!sammPool || !tokenA || !tokenB) {
      return res.status(503).json({ error: 'Contracts not initialized' });
    }

    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    const [balanceA, balanceB, lpBalance] = await Promise.all([
      tokenA.balanceOf(address),
      tokenB.balanceOf(address),
      sammPool.balanceOf(address),
    ]);

    res.json({
      user: address,
      tokenA: balanceA.toString(),
      tokenB: balanceB.toString(),
      lpTokens: lpBalance.toString(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching user balances:', error);
    res.status(500).json({ error: 'Failed to fetch user balances' });
  }
});

// Calculate TVL (Total Value Locked)
app.get('/api/pool/tvl', async (req, res) => {
  try {
    if (!sammPool) {
      return res.status(503).json({ error: 'Pool not initialized' });
    }

    const [reserveA, reserveB] = await sammPool.getReserves();

    // Note: In production, you'd want to fetch token prices from an oracle
    // For now, we just return the raw reserves
    res.json({
      reserveA: reserveA.toString(),
      reserveB: reserveB.toString(),
      // In production, add USD values here
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error calculating TVL:', error);
    res.status(500).json({ error: 'Failed to calculate TVL' });
  }
});

// Helper functions

function calculatePriceImpact(amountIn, amountOut, reserveIn, reserveOut) {
  try {
    // Calculate spot price before trade
    const spotPriceBefore = Number(reserveOut) / Number(reserveIn);

    // Calculate effective price
    const effectivePrice = Number(amountOut) / Number(amountIn);

    // Price impact = (spotPrice - effectivePrice) / spotPrice * 100
    const priceImpact = ((spotPriceBefore - effectivePrice) / spotPriceBefore) * 100;

    return priceImpact.toFixed(4);
  } catch (error) {
    return '0';
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
async function start() {
  await initializeContracts();

  app.listen(PORT, () => {
    console.log(`SAMM Service running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`RPC URL: ${process.env.RPC_URL || 'http://localhost:8545'}`);
  });
}

start().catch(console.error);

module.exports = app;
