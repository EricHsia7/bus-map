const { Worker } = require('node:worker_threads');
const os = require('node:os');

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

class WorkerPool {
  /**
   * @param {string|URL} script  Path to the worker script.
   * @param {number} size  Number of persistent threads.
   */
  constructor(script, size = os.availableParallelism()) {
    this.script = script;
    this.size = size;
    this.idle = []; // workers ready for a job
    this.queue = []; // { payload, resolve, reject } waiting for a slot
    this.jobs = new Map(); // worker -> current job
    this.closing = false;

    for (let i = 0; i < size; i++) this.spawn();
  }

  spawn() {
    const worker = new Worker(this.script);

    worker.on('message', (msg) => {
      const job = this.jobs.get(worker);
      this.jobs.delete(worker);
      if (msg.error) job.reject(Object.assign(new Error(msg.error.message), msg.error));
      else job.resolve(msg.result);
      this.srelease(worker);
    });

    // A crash (OOM, uncaught throw) kills the thread — fail the job, replace the thread
    // so the pool keeps its constant size.
    worker.on('error', (err) => {
      const job = this.jobs.get(worker);
      this.jobs.delete(worker);
      if (job) job.reject(err);
      this.sretire(worker);
    });

    worker.on('exit', (code) => {
      if (!this.closing && code !== 0) this.sretire(worker);
    });

    this.idle.push(worker);
    this.spump();
  }

  sretire(worker) {
    this.idle = this.idle.filter((w) => w !== worker);
    worker.terminate();
    if (!this.closing) this.spawn(); // maintain constant concurrency
  }

  srelease(worker) {
    this.idle.push(worker);
    this.spump();
  }

  /** Hand queued work to any free thread — this is the "start another session" step. */
  spump() {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop();
      const job = this.queue.shift();
      this.jobs.set(worker, job);
      worker.postMessage(job.payload);
    }
  }

  /** Submit one unit of work. Resolves with the worker's result. */
  exec(payload) {
    if (this.closing) return Promise.reject(new Error('pool is closing'));
    return new Promise((resolve, reject) => {
      this.queue.push({ payload, resolve, reject });
      this.spump();
    });
  }

  /** Convenience: map over items with bounded parallelism. */
  map(items) {
    return Promise.all(Array.from(items, (item) => this.exec(item)));
  }

  async destroy() {
    this.closing = true;
    await Promise.all(this.idle.map((w) => w.terminate()));
    this.idle = [];
  }

  stats() {
    return { size: this.size, busy: this.jobs.size, queued: this.queue.length };
  }
}

module.exports = {
  AsyncPool,
  WorkerPool
};
