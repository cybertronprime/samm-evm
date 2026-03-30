/**
 * Shared Transaction Queue
 *
 * Serializes all blockchain transactions through a single queue so that
 * the arbitrage bot and dynamic shard manager never collide on nonces.
 * Each transaction gets the correct nonce, waits for confirmation, then
 * releases the lock for the next one.
 */

const { ethers } = require('ethers');

class TxQueue {
  constructor(wallet, provider) {
    this.wallet = wallet;
    this.provider = provider;
    this._queue = [];
    this._processing = false;
    this._nonce = null;
    this._lastSync = 0;
    this.stats = { sent: 0, confirmed: 0, failed: 0, retried: 0 };
  }

  /** Force-sync nonce from the chain */
  async syncNonce() {
    this._nonce = await this.provider.getTransactionCount(this.wallet.address, 'pending');
    this._lastSync = Date.now();
    return this._nonce;
  }

  /**
   * Enqueue a transaction.
   * @param {Function} txFn  — async function(nonce) that returns a ContractTransactionResponse
   * @param {string}   label — human-readable description for logging
   * @param {number}   maxRetries — how many times to retry on nonce/transient errors
   * @returns {Promise<{success:boolean, receipt?:object, error?:string}>}
   */
  send(txFn, label = 'tx', maxRetries = 2) {
    return new Promise((resolve) => {
      this._queue.push({ txFn, label, maxRetries, resolve });
      this._drain();
    });
  }

  async _drain() {
    if (this._processing) return;
    this._processing = true;

    while (this._queue.length > 0) {
      const job = this._queue.shift();
      const result = await this._execute(job);
      job.resolve(result);
    }

    this._processing = false;
  }

  async _execute({ txFn, label, maxRetries }) {
    // Sync nonce if stale (>30s) or never synced
    if (this._nonce === null || Date.now() - this._lastSync > 30_000) {
      await this.syncNonce();
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const nonce = this._nonce;
        const tx = await txFn(nonce);
        this._nonce = nonce + 1;
        this.stats.sent++;

        const receipt = await tx.wait();
        this.stats.confirmed++;
        return { success: true, receipt, txHash: receipt.hash };
      } catch (err) {
        const msg = err.message || '';

        // Nonce errors → resync and retry
        if (msg.includes('nonce') || msg.includes('NONCE_EXPIRED') || msg.includes('replacement transaction')) {
          this.stats.retried++;
          await this.syncNonce();
          if (attempt < maxRetries) continue;
        }

        // Revert or other errors → don't retry
        this.stats.failed++;
        const short = msg.length > 120 ? msg.slice(0, 120) + '…' : msg;
        return { success: false, error: short };
      }
    }

    this.stats.failed++;
    return { success: false, error: 'max retries exceeded' };
  }

  getStats() {
    return { ...this.stats, pending: this._queue.length };
  }
}

module.exports = TxQueue;
