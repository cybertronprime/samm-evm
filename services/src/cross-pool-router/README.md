# SAMM Cross-Pool Router

A TypeScript service for enabling multi-hop swaps across SAMM pools while maintaining c-properties (c-non-splitting and c-smaller-better).

## Features

- **Multi-hop Routing**: Enable A→B→C swaps through intermediate tokens
- **Single Shard Selection**: Select exactly one (smallest) shard per pool to maintain c-properties
- **Atomic Execution**: All hops succeed or fail together
- **Path Optimization**: Find optimal routes with minimal fees and price impact
- **REST API**: HTTP endpoints for integration
- **TypeScript SDK**: Easy integration for frontend applications
- **Property-Based Testing**: Comprehensive test coverage with formal properties

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│ Path Discovery  │    │ Shard Selector   │    │ Atomic Execution    │
│ Service         │    │ Service          │    │ Service             │
│                 │    │                  │    │                     │
│ • Graph-based   │    │ • Smallest shard │    │ • Multi-hop swaps   │
│   routing       │    │   selection      │    │ • Rollback on fail  │
│ • Multi-hop     │    │ • c-threshold    │    │ • Slippage protect  │
│   paths         │    │   validation     │    │                     │
└─────────────────┘    └──────────────────┘    └─────────────────────┘
         │                       │                        │
         └───────────────────────┼────────────────────────┘
                                 │
                    ┌─────────────────────┐
                    │ Cross-Pool Router   │
                    │ API & SDK           │
                    │                     │
                    │ • REST endpoints    │
                    │ • TypeScript SDK    │
                    │ • Error handling    │
                    │ • Rate limiting     │
                    └─────────────────────┘
```

## Installation

```bash
npm install @samm/cross-pool-router
```

## Quick Start

### Using the Service Directly

```typescript
import { ethers } from 'ethers';
import { CrossPoolRouterService } from '@samm/cross-pool-router';

// Setup
const provider = new ethers.JsonRpcProvider('https://testnet.riselabs.xyz');
const config = {
  chainId: 11155931,
  rpcEndpoint: 'https://testnet.riselabs.xyz',
  maxHops: 3,
  maxPaths: 10,
  minLiquidityThreshold: ethers.parseEther('1000'),
  defaultSlippage: 1.0,
  enableCaching: true
};

const router = new CrossPoolRouterService(config, provider);

// Initialize with pool data
await router.initialize(pools);

// Discover paths
const result = await router.discoverPaths({
  tokenIn: { address: '0x...', symbol: 'USDC', decimals: 6, chainId: 11155931 },
  tokenOut: { address: '0x...', symbol: 'DAI', decimals: 18, chainId: 11155931 },
  amountOut: ethers.parseEther('100'),
  maxHops: 2,
  slippageTolerance: 1.0
});

console.log(`Found ${result.paths.length} paths`);
if (result.bestPath) {
  console.log(`Best path requires ${ethers.formatEther(result.bestPath.totalAmountIn)} input tokens`);
}
```

### Using the REST API

```typescript
// Start the API server
const apiConfig = {
  port: 3001,
  corsOrigins: ['http://localhost:3000'],
  rateLimitWindowMs: 15 * 60 * 1000,
  rateLimitMaxRequests: 100,
  enableLogging: true
};

await router.startAPI(apiConfig);
```

### Using the SDK

```typescript
import { CrossPoolRouterSDK } from '@samm/cross-pool-router';

const sdk = new CrossPoolRouterSDK({
  baseURL: 'http://localhost:3001',
  timeout: 30000,
  retries: 3
});

// Health check
const health = await sdk.healthCheck();
console.log('API Status:', health.status);

// Get quote
const quote = await sdk.getQuote({
  tokenIn: { address: '0x...', symbol: 'USDC', decimals: 6, chainId: 11155931 },
  tokenOut: { address: '0x...', symbol: 'DAI', decimals: 18, chainId: 11155931 },
  amountOut: '100000000000000000000', // 100 DAI
  maxHops: 2
});

console.log('Quote:', quote);

// Execute swap
const result = await sdk.executeSwap({
  path: quote.path,
  userAddress: '0x...',
  deadline: Math.floor(Date.now() / 1000) + 3600,
  maxSlippage: 1.0
});

console.log('Swap result:', result);
```

## API Endpoints

### Path Discovery
- `POST /api/v1/paths/discover` - Discover optimal paths
- `GET /api/v1/paths/token-pairs` - Get available token pairs

### Swap Execution
- `POST /api/v1/swaps/execute` - Execute multi-hop swap
- `POST /api/v1/swaps/quote` - Get swap quote (dry run)

### Pool Management
- `POST /api/v1/pools/update` - Update pool data
- `GET /api/v1/pools/stats` - Get pool statistics

### Router Management
- `GET /api/v1/router/stats` - Get router statistics
- `POST /api/v1/router/config` - Update configuration
- `GET /health` - Health check

## Configuration

```typescript
interface CrossPoolRouterConfig {
  chainId: number;                    // EVM chain ID
  rpcEndpoint: string;               // RPC endpoint URL
  maxHops: number;                   // Maximum hops allowed (1-5)
  maxPaths: number;                  // Maximum paths to return (1-100)
  minLiquidityThreshold: bigint;     // Minimum pool liquidity
  pathCacheTTL: number;              // Path cache TTL (ms)
  poolRefreshInterval: number;       // Pool refresh interval (ms)
  gasSettings: {
    gasPrice: string;
    gasLimit: number;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
  };
  defaultSlippage: number;           // Default slippage tolerance (%)
  enableCaching: boolean;            // Enable path caching
}
```

## SAMM Properties

The Cross-Pool Router maintains SAMM's theoretical guarantees:

### C-Non-Splitting Property
- Each individual pool swap uses exactly one shard
- No splitting of trades across multiple shards within a pool
- Maintains optimal fee structure per pool

### C-Smaller-Better Property  
- Always selects the smallest available shard for each pool
- Random selection among equally-sized smallest shards
- Ensures users get the best possible rates

### Atomic Execution
- All hops in a multi-hop swap succeed or fail together
- Automatic rollback on any failure
- Slippage protection across the entire path

## Error Handling

The service provides comprehensive error handling:

```typescript
enum CrossPoolRouterError {
  NO_PATH_FOUND = 'NO_PATH_FOUND',
  INSUFFICIENT_LIQUIDITY = 'INSUFFICIENT_LIQUIDITY',
  EXCEEDS_MAX_HOPS = 'EXCEEDS_MAX_HOPS',
  INVALID_TOKEN_PAIR = 'INVALID_TOKEN_PAIR',
  SLIPPAGE_TOO_HIGH = 'SLIPPAGE_TOO_HIGH',
  DEADLINE_EXCEEDED = 'DEADLINE_EXCEEDED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  POOL_NOT_ACTIVE = 'POOL_NOT_ACTIVE'
}
```

## Testing

The service includes comprehensive property-based tests:

```bash
npm test
```

Tests validate:
- **Property 6**: Multi-hop routing atomicity
- **Property 7**: Cross-pool routing path optimization
- C-threshold validation for each hop
- Smallest shard selection consistency
- Path optimization algorithms

## Examples

See the `examples/` directory for complete integration examples:

- `integration-example.ts` - Complete service usage example
- API server setup and configuration
- SDK usage patterns
- Error handling examples

## Performance

- **Path Discovery**: < 100ms for typical 2-3 hop paths
- **Atomic Execution**: Depends on network conditions
- **Caching**: Configurable TTL for improved performance
- **Rate Limiting**: Configurable per-endpoint limits

## Multi-Chain Support

The router is designed for single-chain operation but can be deployed on multiple chains:

- Each chain requires a separate router instance
- Complete isolation between chains
- Chain-specific configuration and pool data

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For questions and support:
- GitHub Issues: [samm-protocol/samm-evm](https://github.com/samm-protocol/samm-evm)
- Documentation: [docs.samm.xyz](https://docs.samm.xyz)