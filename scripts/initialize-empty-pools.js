/**
 * Initialize Empty Pools - Utility module
 *
 * Provides CLI argument parsing, error handling wrappers,
 * retry logic, and terminal formatting utilities used by
 * pool initialization scripts.
 */

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

/**
 * Parse CLI arguments into a structured object.
 * Supported flags: --dry-run, --network <name>, --file <path>
 */
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    network: args.includes("--network")
      ? args[args.indexOf("--network") + 1] || "hardhat"
      : "hardhat",
    file: args.includes("--file")
      ? args[args.indexOf("--file") + 1] || null
      : null,
  };
}

/**
 * Wrap an async function with structured error logging.
 * @param {Function} fn  - The async function to wrap
 * @param {string} context - Human-readable label for the operation
 * @returns {Function} Wrapped function that catches & re-throws with context
 */
function withErrorHandling(fn, context) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      console.error(
        `${colors.red}[ERROR] ${context}: ${error.message}${colors.reset}`
      );
      throw error;
    }
  };
}

/**
 * Retry an async operation with exponential backoff.
 * @param {Function} fn         - The async function to retry
 * @param {number}   maxRetries - Maximum number of attempts
 * @param {number}   baseDelay  - Base delay in ms (doubled each retry)
 * @returns {Promise<*>} Result of `fn` on success
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(
          `${colors.yellow}  Attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...${colors.reset}`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Return a formatted timestamp string (YYYY-MM-DD HH:MM:SS).
 */
function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

module.exports = {
  parseArgs,
  withErrorHandling,
  retryWithBackoff,
  getTimestamp,
  colors,
};
