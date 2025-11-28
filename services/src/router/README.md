# SAMM Router Service

The Router Service implements single-pool trade routing with smallest-shard selection strategy according to the SAMM research paper. It provides optimal shard selection, c-threshold validation, and trade execution for EVM-compatible chains.

## Features

- **Shard Discovery**: Real-time monitoring of SAMM pools across EVM chains
- **Smallest-Shard Selection**: Implements the dominant strategy from SAMM research
- **C-Threshold Validation**: Ensures trades maintain SAMM theoretical guarantees
- **Trade Routing**: Optimal single-pool trade execution
- **REST API**: Complete HTTP API for integration
- **TypeScript SDK**: Easy-to-use client library
- **Caching**: Intelligent caching for improved performance
- **Monitoring**: Comprehensive metrics and health monitoring

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Router SDK    │    │   Router API     │    │ Router Service  │
│                 │    │                  │    │                 │
│ - TypeScript    │◄──►│ - REST Endpoints │◄──►│ - Shard Discovery│
│ - Easy Integration   │ - Rate Limiting  │    │ - Shard Selection│
│ - Error Handling│    │ - CORS Support   │    │ - Trade Routing │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                                                         ▼
                                               ┌─────────────────┐
                                               │ EVM Blockchain  │
                                               │                 │
                                               │ - SAMM Pools    │
                                               │ - Token Contracts│
                                               └─────────────────┘
```

## Quick Start

### 1. Basic Setup

```typescript
import { createRouterService, RouterSDK } from './router';
import { ethers } from 'ethers';

// Setup provider and signer
const provider = new ethers.JsonRpcProvider('https://rpc.example.com');
const signer = new ethers.Wallet('private_key', provider);

// Chain configuration
const chainConfig = {
  chainId: 1,
  rpcEndpoint: 'https://rpc.example.com',
  poolFactoryAddress: '0x...',
  refreshInterval: 30000,
  minLiquidityThreshold: ethers.parseEther('1000'),
  maxCacheAge: 60000,
  enableRealTimeMonitoring: true,
  batchSize: 10
};

// Create and start router service
const { router, api } = await createRouterService(
  chainConfig,
  provider,
  signer,
  { port: 3001 }
);

await router.start();
await api.start();
```

### 2. Using the SDK

```typescript
import { RouterSDK } from './router';

const sdk = new RouterSDK({
  baseURL: 'http://localhost:3001',
  timeout: 30000,
  retries: 3
});

// Find optimal shard for a trade
const result = await sdk.findOptimalShard({
  tokenPair: {
    tokenA: {
      address: '0x...',
      symbol: 'USDC',
      decimals: 6,
      chainId: 1
    },
    tokenB: {
      address: '0x...',
      symbol: 'ETH',
      decimals: 18,
      chainId: 1
    },
    chainId: 1
  },
  outputAmount: ethers.parseEther('1'), // Want 1 ETH
  chainId: 1,
  userAddress: '0x...'
});

if (result.success && result.data?.routing) {
  console.log('Optimal shard found:', result.data.routing);
  
  // Execute the trade
  const tradeResult = await sdk.executeTrade({
    routing: result.data.routing,
    maxAmountIn: ethers.parseUnits('2000', 6), // Max 2000 USDC
    userAddress: '0x...'
  });
  
  if (tradeResult.success) {
    console.log('Trade executed:', tradeResult.data?.transactionHash);
  }
}
```

## API Endpoints

### Shard Discovery

- `GET /api/v1/shards` - Get all shards overview
- `GET /api/v1/shards/:poolAddress` - Get specific shard info
- `POST /api/v1/shards/refresh` - Force refresh all shards
- `POST /api/v1/shards/available` - Get available shards for token pair

### Routing

- `POST /api/v1/routing/find-optimal` - Find optimal shard for trade
- `POST /api/v1/routing/quote` - Get trade quote (dry run)
- `POST /api/v1/routing/validate-threshold` - Validate c-threshold

### Trade Execution

- `POST /api/v1/trades/execute` - Execute routed trade

### Monitoring

- `GET /api/v1/stats` - Get router statistics
- `GET /api/v1/metrics` - Get shard monitoring metrics
- `POST /api/v1/stats/reset` - Reset statistics

## Configuration

### Router Service Config

```typescript
interface RouterServiceConfig {
  chainConfig: ShardDiscoveryConfig;
  defaultSlippage: number;
  maxGasPrice: string;
  gasLimit: number;
  enableCaching: boolean;
  cacheTTL: number;
  retryConfig: {
    maxRetries: number;
    retryDelay: number;
    backoffMultiplier: number;
  };
  monitoring: {
    enableMetrics: boolean;
    metricsInterval: number;
    alertThresholds: {
      errorRate: number;
      responseTime: number;
      failedShards: number;
    };
  };
}
```

### Shard Discovery Config

```typescript
interface ShardDiscoveryConfig {
  chainId: number;
  rpcEndpoint: string;
  poolFactoryAddress: string;
  refreshInterval: number;
  minLiquidityThreshold: bigint;
  maxCacheAge: number;
  enableRealTimeMonitoring: boolean;
  batchSize: number;
}
```

## SAMM Properties

The Router Service implements key SAMM properties:

### 1. Smallest-Shard Selection

- Always selects shards with minimum deposited amounts (RA values)
- Random selection among equally-sized smallest shards
- Implements the dominant strategy from SAMM research

### 2. C-Threshold Validation

- Validates trades against: `trade_amount ≤ c × shard_reserve_amount`
- Rejects trades that exceed c-threshold to maintain theoretical guarantees
- Default c-parameter: 0.0104 (from research paper)

### 3. C-Non-Splitting Property

- Ensures single shard trades cost less than split trades
- Never splits trades across multiple shards
- Maintains SAMM fee structure benefits

## Error Handling

The service provides comprehensive error handling:

```typescript
enum RouterServiceError {
  NO_SHARDS_AVAILABLE = 'NO_SHARDS_AVAILABLE',
  EXCEEDS_C_THRESHOLD = 'EXCEEDS_C_THRESHOLD',
  INSUFFICIENT_LIQUIDITY = 'INSUFFICIENT_LIQUIDITY',
  INVALID_TOKEN_PAIR = 'INVALID_TOKEN_PAIR',
  CHAIN_CONNECTION_ERROR = 'CHAIN_CONNECTION_ERROR',
  SHARD_DISCOVERY_FAILED = 'SHARD_DISCOVERY_FAILED',
  TRADE_EXECUTION_FAILED = 'TRADE_EXECUTION_FAILED',
  GAS_ESTIMATION_FAILED = 'GAS_ESTIMATION_FAILED',
  SLIPPAGE_TOO_HIGH = 'SLIPPAGE_TOO_HIGH',
  DEADLINE_EXCEEDED = 'DEADLINE_EXCEEDED'
}
```

## Monitoring and Metrics

### Router Statistics

- Total routing requests processed
- Success/failure rates
- Average routing time
- Total trades executed
- Total volume routed
- Cache hit rates

### Shard Metrics

- Total active shards
- Total liquidity across shards
- Average shard size
- Token pair count
- Health status
- Error counts

## Integration Examples

### Frontend Integration

```typescript
// React component example
import { RouterSDK } from '@samm/router-sdk';

const useRouterSDK = () => {
  const sdk = new RouterSDK({
    baseURL: process.env.REACT_APP_ROUTER_API_URL,
    timeout: 30000
  });
  
  const findOptimalTrade = async (tokenPair, amount, userAddress) => {
    try {
      const result = await sdk.findOptimalShard({
        tokenPair,
        outputAmount: amount,
        chainId: tokenPair.chainId,
        userAddress
      });
      
      return result;
    } catch (error) {
      console.error('Router error:', error);
      throw error;
    }
  };
  
  return { findOptimalTrade, sdk };
};
```

### Backend Integration

```typescript
// Express.js middleware example
import { RouterService } from '@samm/router-service';

const routerMiddleware = (router: RouterService) => {
  return async (req, res, next) => {
    try {
      // Add router service to request context
      req.routerService = router;
      next();
    } catch (error) {
      res.status(500).json({ error: 'Router service unavailable' });
    }
  };
};
```

## Testing

The Router Service includes comprehensive property-based tests:

```bash
# Run router service tests
npm test -- --grep "Router Service Property Tests"

# Run specific property tests
npm test -- --grep "Property 5: Smallest shard selection consistency"
npm test -- --grep "Property 10: C-threshold validation"
```

## Performance Considerations

- **Caching**: Enable caching for frequently accessed shard data
- **Batch Processing**: Configure appropriate batch sizes for shard discovery
- **Rate Limiting**: Implement rate limiting to prevent API abuse
- **Connection Pooling**: Use connection pooling for blockchain RPC calls
- **Monitoring**: Set up alerts for performance degradation

## Security

- **Input Validation**: All inputs are validated before processing
- **Rate Limiting**: API endpoints are rate-limited
- **CORS**: Configurable CORS policies
- **Error Sanitization**: Error messages don't leak sensitive information
- **Address Validation**: All addresses are validated using ethers.js

## Deployment

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3001
CMD ["npm", "start"]
```

### Environment Variables

```bash
# Required
CHAIN_ID=1
RPC_ENDPOINT=https://mainnet.infura.io/v3/your-key
POOL_FACTORY_ADDRESS=0x...

# Optional
PORT=3001
CACHE_TTL=30000
ENABLE_MONITORING=true
LOG_LEVEL=info
```

## Contributing

1. Follow TypeScript best practices
2. Add comprehensive tests for new features
3. Update documentation for API changes
4. Ensure SAMM properties are maintained
5. Add proper error handling

## License

MIT License - see LICENSE file for details.