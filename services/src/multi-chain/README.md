# SAMM Multi-Chain Backend Service

## Overview

The SAMM Multi-Chain Backend Service provides a complete multi-chain AMM backend with isolated chain-specific services, routing, and liquidity management. Each chain operates independently with no shared state.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    API Gateway                              │
├─────────────────────────────────────────────────────────────┤
│                Multi-Chain Backend                          │
├─────────────────┬─────────────────┬─────────────────────────┤
│   Chain 1       │   Chain 2       │   Chain N               │
│   Services      │   Services      │   Services              │
│                 │                 │                         │
│ ┌─────────────┐ │ ┌─────────────┐ │ ┌─────────────────────┐ │
│ │   Router    │ │ │   Router    │ │ │      Router         │ │
│ │   Service   │ │ │   Service   │ │ │      Service        │ │
│ └─────────────┘ │ └─────────────┘ │ └─────────────────────┘ │
│ ┌─────────────┐ │ ┌─────────────┐ │ ┌─────────────────────┐ │
│ │ Cross-Pool  │ │ │ Cross-Pool  │ │ │    Cross-Pool       │ │
│ │   Router    │ │ │   Router    │ │ │     Router          │ │
│ └─────────────┘ │ └─────────────┘ │ └─────────────────────┘ │
│ ┌─────────────┐ │ ┌─────────────┐ │ ┌─────────────────────┐ │
│ │ Liquidity   │ │ │ Liquidity   │ │ │    Liquidity        │ │
│ │   Router    │ │ │   Router    │ │ │     Router          │ │
│ └─────────────┘ │ └─────────────┘ │ └─────────────────────┘ │
└─────────────────┴─────────────────┴─────────────────────────┘
```

## Key Features

### 🔗 Multi-Chain Support
- Complete isolation between chains
- Independent service instances per chain
- No shared state or cross-chain dependencies

### 🎯 SAMM Properties
- Smallest shard routing (c-smaller-better)
- Single shard selection (c-non-splitting)
- Fillup strategy for liquidity provision

### 🛡️ Failure Isolation
- Circuit breaker pattern per chain
- Graceful degradation
- Chain-specific error handling

### 📊 Monitoring & Health
- Real-time health monitoring per chain
- Performance metrics collection
- Isolation integrity verification

## Components

### MultiChainBackend
Main orchestrator that manages multiple isolated chain services.

```typescript
const backend = new MultiChainBackend();
await backend.addChain(chainId, chainConfig);
const routerService = backend.getRouterService(chainId);
```

### APIGateway
HTTP API gateway with chain-specific routing.

```typescript
const gateway = new APIGateway(multiChainBackend);
const app = gateway.getApp();
```

### ChainSpecificRouter
Creates isolated API endpoints for each chain.

```typescript
// Endpoints per chain:
// /api/{chain-name}/router/*
// /api/{chain-name}/cross-pool/*
// /api/{chain-name}/liquidity/*
```

### HealthMonitor
Monitors chain health and service availability.

```typescript
const health = await backend.checkChainHealth(chainId);
console.log(health.isHealthy);
```

## API Endpoints

### Global Endpoints
- `GET /health` - Service health check
- `GET /api/chains` - List supported chains

### Chain-Specific Endpoints

#### Router Service
- `GET /api/{chain}/router/shards` - Get available shards
- `POST /api/{chain}/router/route` - Find optimal route
- `POST /api/{chain}/router/execute` - Execute trade
- `GET /api/{chain}/router/health` - Router health

#### Cross-Pool Router
- `GET /api/{chain}/cross-pool/paths` - Find cross-pool paths
- `POST /api/{chain}/cross-pool/execute` - Execute multi-hop swap
- `GET /api/{chain}/cross-pool/health` - Cross-pool health

#### Liquidity Router
- `GET /api/{chain}/liquidity/pools` - Get available pools
- `GET /api/{chain}/liquidity/recommendations` - Get liquidity recommendations
- `POST /api/{chain}/liquidity/analyze` - Analyze pool
- `GET /api/{chain}/liquidity/health` - Liquidity router health

#### Monitoring
- `GET /api/{chain}/metrics` - Chain metrics
- `GET /api/{chain}/isolation` - Isolation status

## Configuration

### Chain Configuration
```json
{
  "chainId": 11155931,
  "name": "RiseChain Testnet",
  "rpcEndpoint": "https://testnet.riselabs.xyz",
  "blockTime": 12000,
  "gasPrice": "20000000000",
  "contractAddresses": {
    "sammPoolFactory": "0x...",
    "router": "0x...",
    "liquidityRouter": "0x..."
  },
  "nativeToken": {
    "symbol": "ETH",
    "decimals": 18
  }
}
```

### Environment Variables
```bash
PORT=3000
NODE_ENV=production
DEBUG=false
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

## Usage

### Starting the Service
```bash
npm start
# or
node dist/multi-chain/main.js
```

### Adding a New Chain
```typescript
const chainConfig: ChainConfig = {
  chainId: 1,
  name: "Ethereum Mainnet",
  rpcEndpoint: "https://mainnet.infura.io/v3/...",
  // ... other config
};

await multiChainBackend.addChain(1, chainConfig);
```

### Making API Calls
```bash
# Get chain info
curl http://localhost:3000/api/risechain/info

# Get available shards
curl http://localhost:3000/api/risechain/router/shards

# Find optimal route
curl -X POST http://localhost:3000/api/risechain/router/route \
  -H "Content-Type: application/json" \
  -d '{"tokenIn":"0x...","tokenOut":"0x...","amountOut":"1000000"}'

# Get liquidity recommendations
curl "http://localhost:3000/api/risechain/liquidity/recommendations?tokenA=0x...&tokenB=0x..."
```

## Testing

### Run All Tests
```bash
npm test
```

### Run Integration Tests
```bash
node test-real-integration-comprehensive.js
```

### Run Backend Tests
```bash
node test-backend-integration.js
```

### Run Property Tests
```bash
npm test -- --grep "Property"
```

## Deployment

### Production Deployment
1. Build the TypeScript code: `npm run build`
2. Set environment variables
3. Start the service: `npm start`

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
EXPOSE 3000
CMD ["node", "dist/multi-chain/main.js"]
```

## Monitoring

### Health Checks
- Service health: `GET /health`
- Chain health: `GET /api/{chain}/metrics`
- Isolation status: `GET /api/{chain}/isolation`

### Metrics
- Response times per chain
- Request counts per endpoint
- Error rates per chain
- Circuit breaker states

### Logging
Structured logging with chain context:
```
2025-11-28T10:30:00.000Z INFO [MultiChainBackend][Chain:11155931] Added chain: RiseChain Testnet
```

## Security

### Rate Limiting
- Global rate limiting: 1000 requests per 15 minutes
- Chain-specific rate limiting: 100 requests per 15 minutes per chain
- IP-based rate limiting with chain isolation

### Authentication
- Optional API key authentication per chain
- Origin-based access control
- Request validation and sanitization

### Isolation
- Complete state isolation between chains
- No shared memory or resources
- Independent failure handling

## Performance

### Optimization
- Response caching per chain
- Connection pooling per RPC endpoint
- Batch operations where possible

### Scalability
- Horizontal scaling with load balancers
- Chain-specific scaling based on usage
- Independent service deployment per chain

## Troubleshooting

### Common Issues

#### Chain Connection Failed
```bash
# Check RPC endpoint
curl -X POST {rpcEndpoint} \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

#### Service Unhealthy
```bash
# Check service health
curl http://localhost:3000/api/{chain}/metrics
```

#### High Response Times
- Check RPC endpoint latency
- Verify contract deployment
- Monitor system resources

### Debug Mode
```bash
DEBUG=true NODE_ENV=development npm start
```

## Contributing

1. Follow TypeScript best practices
2. Maintain complete chain isolation
3. Add comprehensive tests for new features
4. Update documentation for API changes
5. Ensure backward compatibility

## License

MIT License - see LICENSE file for details.