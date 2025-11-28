# SAMM Liquidity Router Service

The Liquidity Router Service implements SAMM's fillup strategy for optimal liquidity provision across multiple EVM chains. It identifies the best pools for liquidity providers and guides them to maintain balanced shard distribution.

## Features

- **Pool Analysis**: Analyzes all available SAMM pools for token pairs on specific chains
- **Fillup Strategy**: Implements SAMM's fillup strategy by directing liquidity to smallest shards
- **Expected Returns**: Calculates expected returns based on pool size and fee generation
- **Multi-Chain Support**: Operates independently across multiple EVM chains
- **REST API**: Provides HTTP endpoints for easy integration

## Architecture

```
LiquidityRouterService
├── PoolAnalysisService     # Pool discovery and metrics collection
├── FillupStrategyEngine    # Fillup strategy implementation
└── LiquidityRouterAPI      # REST API endpoints
```

## Core Components

### PoolAnalysisService
- Discovers all pools for token pairs on specific chains
- Collects performance metrics (volume, fees, utilization)
- Calculates expected returns and risk scores
- Maintains cache for performance optimization

### FillupStrategyEngine
- Implements SAMM's fillup strategy
- Identifies smallest shards for liquidity addition
- Generates optimal liquidity distribution recommendations
- Provides reasoning for recommendations

### LiquidityRouterAPI
- REST API with chain-specific endpoints
- Comprehensive error handling and validation
- Request/response logging and monitoring
- Health checks and service statistics

## API Endpoints

### Service Information
- `GET /health` - Health check
- `GET /api/liquidity-router/info` - Service information

### Chain-Specific Endpoints
- `GET /api/liquidity-router/{chainId}/pools` - Get available pools
- `POST /api/liquidity-router/{chainId}/recommend` - Get liquidity recommendation
- `POST /api/liquidity-router/{chainId}/fillup-strategy` - Get fillup strategy
- `POST /api/liquidity-router/{chainId}/expected-returns` - Calculate expected returns
- `POST /api/liquidity-router/{chainId}/optimal-distribution` - Get optimal distribution
- `POST /api/liquidity-router/{chainId}/add-liquidity` - Execute liquidity addition

## Usage

### Basic Setup

```typescript
import { LiquidityRouterService, createDefaultConfig } from './liquidity-router';

const config = createDefaultConfig();
const service = new LiquidityRouterService(config);

// Get recommendation for liquidity provision
const recommendation = await service.findBestPoolForLiquidity(
  tokenPair,
  liquidityAmount,
  chainId
);
```

### Starting the API Server

```typescript
import { startLiquidityRouterService } from './liquidity-router';

const api = await startLiquidityRouterService(config, 3002);
console.log('Liquidity Router API running on port 3002');
```

### Example API Requests

#### Get Liquidity Recommendation
```bash
curl -X POST http://localhost:3002/api/liquidity-router/11155111/recommend \
  -H "Content-Type: application/json" \
  -d '{
    "tokenPair": {
      "tokenA": {"address": "0x...", "symbol": "USDC", "decimals": 6},
      "tokenB": {"address": "0x...", "symbol": "ETH", "decimals": 18}
    },
    "liquidityAmount": {
      "tokenA": "1000000000",
      "tokenB": "500000000000000000"
    }
  }'
```

#### Get Fillup Strategy
```bash
curl -X POST http://localhost:3002/api/liquidity-router/11155111/fillup-strategy \
  -H "Content-Type: application/json" \
  -d '{
    "tokenPair": {
      "tokenA": {"address": "0x...", "symbol": "USDC", "decimals": 6},
      "tokenB": {"address": "0x...", "symbol": "ETH", "decimals": 18}
    }
  }'
```

## Configuration

```typescript
interface LiquidityRouterConfig {
  chains: ChainConfig[];
  analysisInterval: number;
  metricsRetentionPeriod: number;
  minLiquidityThreshold: bigint;
  maxRiskScore: number;
}

interface ChainConfig {
  chainId: number;
  name: string;
  rpcEndpoint: string;
  contractAddresses: {
    sammPoolFactory: string;
    router: string;
  };
}
```

## SAMM Fillup Strategy

The service implements SAMM's core fillup strategy:

1. **Identify Smallest Shards**: Find pools with minimum deposited amounts (RA values)
2. **Direct Liquidity**: Recommend liquidity addition to smallest shards
3. **Maintain Balance**: Keep shard sizes balanced for optimal trading efficiency
4. **Calculate Returns**: Provide expected APR based on pool size and fee generation

## Chain Isolation

Each chain operates completely independently:
- Separate RPC connections and state
- Independent pool analysis and recommendations
- No cross-chain coordination or communication
- Isolated failure handling

## Error Handling

The service includes comprehensive error handling:
- Input validation for all parameters
- Chain support validation
- Retry mechanisms for network operations
- Graceful degradation on failures
- Detailed error messages and logging

## Monitoring

Built-in monitoring capabilities:
- Health checks for all supported chains
- Service statistics and metrics
- Cache management and cleanup
- Request/response logging

## Requirements Compliance

This implementation satisfies the following requirements:

- **3.1**: Identifies single best SAMM pool for token pairs on specific chains
- **3.2**: Implements fillup strategy by recommending smallest shards
- **3.3**: Calculates expected returns based on pool size and fee generation
- **3.4**: Guides liquidity providers to maintain balanced shard sizes
- **3.5**: Operates independently for each supported chain