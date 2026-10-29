const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');

// worker
if (process.argv.includes('--worker')) {
  process.env.RENDER_QUIET = process.env.RENDER_QUIET ?? '1';
  const { renderChunk } = require('./render.js');
  if (typeof renderChunk !== 'function') {
    console.error('render.js must export renderChunk: module.exports = { renderChunk };');
    process.exit(2);
  }
  process.on('message', async (job) => {
    const started = Date.now();
    try {
      const rendered = await renderChunk(job.x, job.y, job.z);
      process.send({ id: job.id, ok: true, rendered, ms: Date.now() - started, rss: process.memoryUsage.rss() });
    } catch (err) {
      process.send({ id: job.id, ok: false, error: (err && err.stack) || String(err), ms: Date.now() - started });
    }
  });
  process.send({ ready: true });
  return;
}

// parent
const config = require('./config.json');
const { areaToTiles } = require('./coordinate.js');
const { chunkFileName } = require('./chunk-format.js');

const argv = process.argv;
const option = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const MB = 1024 * 1024;
const isCI = !!process.env.CI;

const renderConfig = config.render || {};
// Expected peak RSS of one worker. Measure it once (the summary prints the
// observed peak) and put it in config.render.workerMemoryMB.
const workerMemoryMB = Number(option('--worker-memory') ?? renderConfig.workerMemoryMB ?? 2048);
// Memory kept free for the OS, the runner agent and the parent.
const reserveMB = Number(renderConfig.reserveMemoryMB ?? 1536);
const cpuWorkers = Math.max(1, os.availableParallelism() - 1); // one core left for the runner agent
const memoryWorkers = Math.max(1, Math.floor((os.totalmem() / MB - reserveMB) / workerMemoryMB));
const workerCount = Math.max(1, Number(option('--workers') ?? renderConfig.workers ?? Math.min(cpuWorkers, memoryWorkers)));
// No heap cap by default: a cap close to a chunk's working set makes V8 run
// back-to-back major GCs, which can make a worker many times slower than
// plain `node render.js`. Set config.render.maxOldSpaceSize only if needed.
const execArgv = renderConfig.maxOldSpaceSize ? [`--max-old-space-size=${renderConfig.maxOldSpaceSize}`] : [];
// Lower CPU priority only where something else must stay responsive (CI agent).
const nice = renderConfig.nice ?? (isCI ? 10 : 0);
// Native thread pools (libuv: fs, zlib, sharp; libvips) default to "all cores"
// *per process*. N workers x all cores oversubscribes the CPU, so split the
// cores between workers. Explicit env vars win.
const threadsPerWorker = (workers) => String(Math.max(1, Math.floor(os.availableParallelism() / workers)));

// Memory that can be handed to a new worker without swapping.
//   Linux: MemAvailable (includes reclaimable page cache).
//   macOS: free + inactive + speculative + purgeable pages from vm_stat.
//          os.freemem() on macOS counts only truly free pages — usually a few
//          hundred MB even on an idle machine — and would hold workers back.
//   Other: unknown -> Infinity (no gating).
const { execFileSync } = require('node:child_process');
let memoryCache = { at: 0, value: Infinity };
function availableMemory() {
  const now = Date.now();
  if (now - memoryCache.at < 1000) return memoryCache.value;
  let value = Infinity;
  try {
    if (process.platform === 'linux') {
      const m = /^MemAvailable:\s+(\d+) kB/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
      if (m) value = Number(m[1]) * 1024;
    } else if (process.platform === 'darwin') {
      const out = execFileSync('vm_stat', { encoding: 'utf8' });
      const page = Number((/page size of (\d+) bytes/.exec(out) || [])[1] || 4096);
      const pages = (name) => Number((new RegExp(`^Pages ${name}:\\s+(\\d+)`, 'm').exec(out) || [])[1] || 0);
      value = (pages('free') + pages('inactive') + pages('speculative') + pages('purgeable')) * page;
    }
  } catch {}
  memoryCache = { at: now, value };
  return value;
}
const maxAttempts = renderConfig.retries != null ? renderConfig.retries + 1 : 2;
const timeLimitMs = option('--time-limit') ? Number(option('--time-limit')) * 60000 : Infinity;
const logEveryMs = Number(renderConfig.logEverySeconds ?? (isCI ? 30 : 0)) * 1000;
const fresh = argv.includes('--fresh');
const markerDir = renderConfig.markerDir ?? path.join(config.tiles.dir, '..', '.done');

// Completion marker: written after a chunk renders; stores the chunk file's
// size + mtime, so a re-chunked (changed) chunk is rendered again.
const markerOf = (job) => path.join(markerDir, `${job.z}_${job.x}_${job.y}`);
// The stamp also covers the renderer: editing render.js (or any local module),
// config.json, style.json or mml.json invalidates every marker, so output from
// an older/broken renderer is never mistaken for "done".
const IGNORED = new Set(['package.json', 'package-lock.json', path.basename(renderConfig.report ?? 'tile-report.json')]);
const rendererHash = (() => {
  const hash = require('node:crypto').createHash('sha1');
  for (const name of fs.readdirSync(__dirname).sort()) {
    if (!/\.(js|json|proto)$/.test(name) || IGNORED.has(name)) continue;
    hash.update(name).update(fs.readFileSync(path.join(__dirname, name)));
  }
  return hash.digest('hex').slice(0, 12);
})();
const stampOf = (job) => `${job.size}:${job.mtimeMs}:${rendererHash}`;
const isDone = (job) => {
  try {
    return fs.readFileSync(markerOf(job), 'utf8') === stampOf(job);
  } catch {
    return false;
  }
};

function buildQueue() {
  const baseZ = config.chunks.baseZ;
  const { west, south, east, north } = config.bbox;
  const only = option('--chunks') ? new Set(option('--chunks').split(',')) : null;
  let jobs = [];
  const missing = [];
  for (const [x, y] of areaToTiles(west, south, east, north, baseZ)) {
    if (only && !only.has(`${baseZ}_${x}_${y}`)) continue;
    const file = path.join(config.chunks.dir, chunkFileName(baseZ, x, y));
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      missing.push(file);
      continue;
    }
    jobs.push({ x, y, z: baseZ, size: stat.size, mtimeMs: Math.round(stat.mtimeMs), attempts: 0 });
  }
  // --order size (default): largest chunk first, so no worker is left alone
  //   with a dense chunk at the end. Chunks therefore run out of x/y order.
  // --order position: by x, then y (easier to follow, slightly worse balance).
  const order = option('--order') ?? renderConfig.order ?? 'size';
  const byPosition = (a, b) => a.x - b.x || a.y - b.y;
  jobs.sort(order === 'position' ? byPosition : (a, b) => b.size - a.size || byPosition(a, b));
  const shard = option('--shard');
  if (shard) {
    const [i, n] = shard.split('/').map(Number);
    if (!(n >= 1 && i >= 0 && i < n)) throw new Error(`--shard expects i/n with 0 <= i < n, got ${shard}`);
    jobs = jobs.filter((_, k) => k % n === i); // round-robin over size order = balanced shards
  }
  const total = jobs.length;
  const skipped = [];
  if (!fresh) {
    jobs = jobs.filter((job) => {
      if (!isDone(job)) return true;
      skipped.push(`${job.z}_${job.x}_${job.y}`);
      return false;
    });
  }
  jobs.forEach((job, id) => (job.id = id));
  return { jobs, missing, skipped, total };
}

const formatTime = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m` : s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};

// Every worker require()s render.js. If render.js calls main() at the bottom
// without the `require.main === module` guard, each worker would run the full
// sequential render of every chunk — N identical copies. Refuse to start.
function checkRenderModule() {
  const source = fs.readFileSync(path.join(__dirname, 'render.js'), 'utf8');
  if (/^\s*(?:await\s+)?main\(\)\s*;?\s*$/m.test(source)) {
    console.error('render.js calls main() unconditionally, so every worker would render all chunks.\n' + 'Replace the bare `main();` at the end of render.js with:\n\n' + '  module.exports = { renderChunk };\n' + '  if (require.main === module) main();\n');
    process.exit(2);
  }
}

// Per-run report: what happened to every chunk (tile-report.json).
const reportPath = renderConfig.report ?? 'tile-report.json';
const report = { startedAt: new Date().toISOString(), renderer: rendererHash, skipped: [], missing: [], rendered: {}, empty: [], failed: {} };
const writeReport = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

function main() {
  checkRenderModule();
  const { jobs, missing, skipped } = buildQueue();
  const list = (items) => (items.length > 40 ? `${items.slice(0, 40).join(', ')}, … (+${items.length - 40})` : items.join(', '));
  if (missing.length) console.warn(`SKIPPED ${missing.length} chunk(s): no chunk file — run \`node chunk.js\`: ${list(missing.map((f) => path.basename(f)))}`);
  if (skipped.length) console.log(`SKIPPED ${skipped.length} chunk(s): already rendered by this renderer version (${markerDir}; --fresh to redo): ${list(skipped)}`);
  report.skipped = skipped;
  report.missing = missing.map((f) => path.basename(f));
  if (jobs.length === 0) {
    console.log('nothing to render');
    writeReport();
    return;
  }
  fs.mkdirSync(markerDir, { recursive: true });

  const total = jobs.length;
  const totalBytes = jobs.reduce((s, j) => s + j.size, 0);
  const queue = jobs.slice();
  const failed = [];
  const idle = []; // workers waiting for memory or work
  let done = 0;
  let doneBytes = 0;
  let alive = 0;
  let stopping = null; // reason string once we stop handing out work
  let peakRss = 0;
  let lastLog = 0;
  const started = Date.now();
  const n = Math.min(workerCount, total);
  const limitedBy = workerCount < cpuWorkers && !option('--workers') && renderConfig.workers == null ? ' (limited by memory: lower config.render.workerMemoryMB if workers use less)' : '';
  console.log(`rendering ${total} chunks with ${n} workers${limitedBy}, ${threadsPerWorker(n)} native threads each, heap cap ${execArgv[0] || 'none'}, nice ${nice}`);
  console.log(`machine ${os.availableParallelism()} cpus, ${Math.round(os.totalmem() / MB)} MB ram, ~${workerMemoryMB} MB assumed per worker`);

  const stop = (reason) => {
    if (stopping) return;
    stopping = reason;
    console.log(`${reason} — finishing running chunks, no new ones`);
    queue.length = 0;
    for (const release of idle.splice(0)) release();
  };

  const finish = () => {
    clearInterval(timer);
    report.finishedAt = new Date().toISOString();
    writeReport();
    if (report.empty.length) console.log(`${report.empty.length} chunk(s) rendered but produced no files (nothing visible at the configured zooms): ${report.empty.join(', ')}`);
    console.log(`report: ${reportPath}`);
    console.log(`finished ${done - failed.length}/${total} chunks in ${formatTime(Date.now() - started)}, peak worker rss ${Math.round(peakRss / MB)} MB`);
    if (failed.length) {
      const list = failed.map((j) => `${j.z}_${j.x}_${j.y}`).join(',');
      console.error(`${failed.length} failed: ${list}`);
      process.exitCode = 1;
    }
    if (stopping && done < total) {
      console.log(`incomplete (${stopping}): ${total - done} chunks left — re-run to resume`);
      if (!process.exitCode) process.exitCode = 75; // EX_TEMPFAIL: partial, resumable
    }
  };

  // Hand out the next chunk only when the machine has room for another one.
  const enoughMemory = () => availableMemory() / MB > reserveMB + workerMemoryMB * 0.5;
  const timer = setInterval(() => {
    if (Date.now() - started > timeLimitMs) stop('time limit reached');
    if (idle.length && (enoughMemory() || alive - idle.length === 0)) idle.shift()();
  }, 1000);

  const settle = (job, ok, ms, error, rendered) => {
    done++;
    doneBytes += job.size;
    const key = `${job.z}_${job.x}_${job.y}`;
    if (ok && rendered === false) {
      // render.js found no chunk file: not done, never mark it
      ok = false;
      error = 'chunk file disappeared before rendering';
    }
    if (ok) {
      fs.writeFileSync(markerOf(job), stampOf(job));
      const files = rendered && typeof rendered === 'object' ? (rendered.raster || 0) + (rendered.vector || 0) + (rendered.labels || 0) : null;
      report.rendered[key] = { ms, ...(typeof rendered === 'object' ? rendered : {}) };
      if (files === 0) report.empty.push(key);
    } else {
      report.failed[key] = String(error).split('\n')[0];
    }
    if (!ok) {
      failed.push(job);
      console.error(`[${job.z}_${job.x}_${job.y}] failed:\n${error}`);
    }
    const now = Date.now();
    if (!ok || now - lastLog >= logEveryMs || done === total) {
      lastLog = now;
      const elapsed = now - started;
      const eta = doneBytes > 0 ? (elapsed / doneBytes) * (totalBytes - doneBytes) : 0;
      console.log(`tiler ${done}/${total}  last ${job.z}_${job.x}_${job.y} ${ok ? 'ok' : 'FAILED'}${ok && rendered && typeof rendered === 'object' ? ` (${rendered.raster || 0} raster, ${rendered.vector || 0} vector, ${rendered.labels || 0} label files)` : ''} in ${formatTime(ms)}  elapsed ${formatTime(elapsed)}  eta ${formatTime(eta)}  avail ${Number.isFinite(availableMemory()) ? Math.round(availableMemory() / MB) + ' MB' : 'n/a'}`);
    }
  };

  const spawn = () => {
    const threads = threadsPerWorker(n);
    const env = { ...process.env, UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE ?? String(Math.max(2, threads)), VIPS_CONCURRENCY: process.env.VIPS_CONCURRENCY ?? threads };
    const child = fork(__filename, ['--worker'], { execArgv, env, stdio: 'inherit' });
    if (nice) {
      try {
        os.setPriority(child.pid, nice); // below the CI runner agent, so its heartbeat keeps up
      } catch {}
    }
    alive++;
    let current = null;

    const next = () => {
      if (stopping || !queue.length) {
        current = null;
        return child.disconnect(); // worker exits once idle
      }
      if (!enoughMemory() && alive - idle.length > 1) {
        // others are still running: wait for memory instead of risking the OOM killer
        return idle.push(next);
      }
      current = queue.shift();
      current.attempts++;
      child.send(current);
    };

    child.on('message', (msg) => {
      if (msg.ready) return next();
      if (msg.rss > peakRss) peakRss = msg.rss;
      settle(current, msg.ok, msg.ms, msg.error, msg.rendered);
      current = null;
      next();
    });

    child.on('exit', (code, signal) => {
      alive--;
      const idleIndex = idle.indexOf(next);
      if (idleIndex >= 0) idle.splice(idleIndex, 1);
      if (current) {
        // crashed mid-chunk (usually out of memory): retry on a fresh worker
        const job = current;
        current = null;
        if (!stopping && job.attempts < maxAttempts) {
          console.warn(`[${job.z}_${job.x}_${job.y}] worker died (${signal || code}), retrying`);
          queue.unshift(job);
        } else {
          settle(job, false, 0, `worker died (${signal || code}) after ${job.attempts} attempt(s) — likely out of memory; raise config.render.workerMemoryMB`);
        }
        if (queue.length && !stopping) spawn();
      }
      if (alive === 0) finish();
    });
  };

  for (let i = 0; i < n; i++) spawn();

  process.on('SIGINT', () => stop('interrupted'));
  process.on('SIGTERM', () => stop('terminated')); // Actions sends SIGTERM on cancel/timeout
}

main();
