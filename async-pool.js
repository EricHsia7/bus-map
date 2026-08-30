class AsyncPool {
  /**
   * @param {number} concurrency  Number of workers running at all times.
   * @param {(item: any, index: number) => Promise<any>} worker  The async fn to parallelize.
   */
  constructor(concurrency, worker) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError('concurrency must be a positive integer');
    }
    this.concurrency = concurrency;
    this.worker = worker;
  }

  /**
   * Runs `worker` over every item, never exceeding `concurrency` in flight.
   * Results are returned in input order (like Promise.all).
   */
  async run(items) {
    const list = Array.from(items);
    const results = new Array(list.length);
    let next = 0; // shared cursor: the "start another session" mechanism

    const session = async () => {
      while (next < list.length) {
        const i = next++; // claim a slot atomically (single-threaded JS)
        results[i] = await this.worker(list[i], i);
      }
    };

    // Spawn exactly `concurrency` long-lived sessions.
    const sessions = Array.from({ length: Math.min(this.concurrency, list.length) }, session);
    await Promise.all(sessions);
    return results;
  }

  /** Like run(), but never rejects: returns {status, value|reason} per item. */
  async runSettled(items) {
    const list = Array.from(items);
    const results = new Array(list.length);
    let next = 0;

    const session = async () => {
      while (next < list.length) {
        const i = next++;
        try {
          results[i] = { status: 'fulfilled', value: await this.worker(list[i], i) };
        } catch (reason) {
          results[i] = { status: 'rejected', reason };
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(this.concurrency, list.length) }, session));
    return results;
  }
}

module.exports = {
  AsyncPool
};
