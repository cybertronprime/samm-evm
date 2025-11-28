/**
 * Logging Service for Multi-Chain Backend
 * 
 * Provides structured logging with chain-specific context
 */
export class LoggingService {
  private context: string;
  private chainId?: number;

  constructor(context: string, chainId?: number) {
    this.context = context;
    this.chainId = chainId;
  }

  /**
   * Log info message
   */
  info(message: string, data?: any): void {
    const logEntry = this.formatLogEntry('INFO', message, data);
    console.log(logEntry);
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: any): void {
    const logEntry = this.formatLogEntry('WARN', message, data);
    console.warn(logEntry);
  }

  /**
   * Log error message
   */
  error(message: string, error?: any): void {
    const logEntry = this.formatLogEntry('ERROR', message, error);
    console.error(logEntry);
  }

  /**
   * Log debug message
   */
  debug(message: string, data?: any): void {
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
      const logEntry = this.formatLogEntry('DEBUG', message, data);
      console.debug(logEntry);
    }
  }

  /**
   * Create chain-specific logger
   */
  forChain(chainId: number): LoggingService {
    return new LoggingService(this.context, chainId);
  }

  /**
   * Format log entry with context
   */
  private formatLogEntry(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const chainContext = this.chainId ? `[Chain:${this.chainId}]` : '';
    const contextInfo = `[${this.context}]${chainContext}`;
    
    let logMessage = `${timestamp} ${level} ${contextInfo} ${message}`;
    
    if (data) {
      if (data instanceof Error) {
        logMessage += ` | Error: ${data.message}`;
        if (data.stack && process.env.NODE_ENV === 'development') {
          logMessage += `\nStack: ${data.stack}`;
        }
      } else {
        logMessage += ` | Data: ${JSON.stringify(data)}`;
      }
    }
    
    return logMessage;
  }
}