import { ChainConfig } from './types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Chain Configuration Manager
 * 
 * Manages configuration for multiple chains with complete isolation.
 * Each chain has its own configuration that cannot affect others.
 */
export class ChainConfigManager {
  private chainConfigs: Map<number, ChainConfig> = new Map();
  private configFilePath: string;

  constructor(configFilePath?: string) {
    this.configFilePath = configFilePath || path.join(__dirname, '../../config/chains.json');
    this.loadConfigurations();
  }

  /**
   * Add configuration for a new chain
   */
  addChainConfig(chainId: number, config: ChainConfig): void {
    if (this.chainConfigs.has(chainId)) {
      throw new Error(`Chain ${chainId} configuration already exists`);
    }

    // Validate configuration
    this.validateChainConfig(config);

    // Store configuration with complete isolation
    this.chainConfigs.set(chainId, { ...config });
    
    console.log(`Added configuration for chain ${chainId} (${config.name})`);
  }

  /**
   * Get configuration for a specific chain
   */
  getChainConfig(chainId: number): ChainConfig {
    const config = this.chainConfigs.get(chainId);
    if (!config) {
      throw new Error(`Chain ${chainId} configuration not found`);
    }

    // Return a copy to prevent external modification
    return { ...config };
  }

  /**
   * Update configuration for an existing chain
   */
  updateChainConfig(chainId: number, updates: Partial<ChainConfig>): void {
    const existingConfig = this.getChainConfig(chainId);
    const updatedConfig = { ...existingConfig, ...updates };

    // Validate updated configuration
    this.validateChainConfig(updatedConfig);

    // Update with complete isolation
    this.chainConfigs.set(chainId, updatedConfig);
    
    console.log(`Updated configuration for chain ${chainId}`);
  }

  /**
   * Remove configuration for a chain
   */
  removeChainConfig(chainId: number): void {
    if (!this.chainConfigs.has(chainId)) {
      throw new Error(`Chain ${chainId} configuration not found`);
    }

    this.chainConfigs.delete(chainId);
    console.log(`Removed configuration for chain ${chainId}`);
  }

  /**
   * Get all configured chain IDs
   */
  getConfiguredChains(): number[] {
    return Array.from(this.chainConfigs.keys());
  }

  /**
   * Check if a chain is configured
   */
  hasChainConfig(chainId: number): boolean {
    return this.chainConfigs.has(chainId);
  }

  /**
   * Get all chain configurations (returns copies)
   */
  getAllChainConfigs(): Map<number, ChainConfig> {
    const configs = new Map<number, ChainConfig>();
    
    for (const [chainId, config] of this.chainConfigs) {
      configs.set(chainId, { ...config });
    }
    
    return configs;
  }

  /**
   * Save configurations to file
   */
  saveConfigurations(): void {
    try {
      const configData: Record<string, any> = {};
      
      for (const [chainId, config] of this.chainConfigs) {
        // Use chain name as key for readability
        const key = config.name.toLowerCase().replace(/\s+/g, '_');
        configData[key] = {
          ...config,
          chainId // Ensure chainId is included
        };
      }

      const configDir = path.dirname(this.configFilePath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(this.configFilePath, JSON.stringify(configData, null, 2));
      console.log(`Saved chain configurations to ${this.configFilePath}`);
    } catch (error) {
      console.error('Failed to save chain configurations:', error);
      throw new Error(`Configuration save failed: ${error.message}`);
    }
  }

  /**
   * Load configurations from file
   */
  private loadConfigurations(): void {
    try {
      if (!fs.existsSync(this.configFilePath)) {
        console.log(`Configuration file not found: ${this.configFilePath}`);
        return;
      }

      const configData = JSON.parse(fs.readFileSync(this.configFilePath, 'utf8'));
      
      for (const [key, config] of Object.entries(configData)) {
        const chainConfig = config as ChainConfig;
        
        if (chainConfig.chainId) {
          this.validateChainConfig(chainConfig);
          this.chainConfigs.set(chainConfig.chainId, chainConfig);
          console.log(`Loaded configuration for chain ${chainConfig.chainId} (${chainConfig.name})`);
        } else {
          console.warn(`Skipping invalid configuration for ${key}: missing chainId`);
        }
      }
    } catch (error) {
      console.error('Failed to load chain configurations:', error);
      // Don't throw here - allow service to start with empty config
    }
  }

  /**
   * Validate chain configuration
   */
  private validateChainConfig(config: ChainConfig): void {
    const requiredFields = ['chainId', 'name', 'rpcEndpoint', 'nativeToken', 'contractAddresses'];
    
    for (const field of requiredFields) {
      if (!config[field as keyof ChainConfig]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate chainId
    if (typeof config.chainId !== 'number' || config.chainId <= 0) {
      throw new Error('Invalid chainId: must be a positive number');
    }

    // Validate RPC endpoint
    if (!config.rpcEndpoint.startsWith('http')) {
      throw new Error('Invalid rpcEndpoint: must be a valid HTTP/HTTPS URL');
    }

    // Validate native token
    if (!config.nativeToken.symbol || typeof config.nativeToken.decimals !== 'number') {
      throw new Error('Invalid nativeToken configuration');
    }

    // Validate contract addresses
    const requiredContracts = ['sammPoolFactory', 'router', 'liquidityRouter'];
    for (const contract of requiredContracts) {
      if (!config.contractAddresses[contract as keyof typeof config.contractAddresses]) {
        throw new Error(`Missing contract address: ${contract}`);
      }
    }

    // Validate SAMM parameters if provided
    if (config.sammParameters) {
      const { beta1, rmin, rmax, c } = config.sammParameters;
      if (typeof beta1 !== 'number' || typeof rmin !== 'number' || 
          typeof rmax !== 'number' || typeof c !== 'number') {
        throw new Error('Invalid SAMM parameters: all must be numbers');
      }
    }
  }

  /**
   * Get configuration for a chain by name
   */
  getChainConfigByName(name: string): ChainConfig | null {
    for (const config of this.chainConfigs.values()) {
      if (config.name.toLowerCase() === name.toLowerCase()) {
        return { ...config };
      }
    }
    return null;
  }

  /**
   * Reload configurations from file
   */
  reloadConfigurations(): void {
    this.chainConfigs.clear();
    this.loadConfigurations();
    console.log('Reloaded chain configurations');
  }
}