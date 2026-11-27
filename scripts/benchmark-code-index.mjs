/**
 * Local lexical comparison against pinned, tracked source on Node 24+. From agent-runtime:
 * node --import tsx ../scripts/benchmark-code-index.mjs --repo <checkout> --inventory
 * node --import tsx ../scripts/benchmark-code-index.mjs --repo <checkout>
 *   --native <bf-context built with --no-default-features> --files 400 --query <term> --query <term>
 * Use --full-comparison to evaluate the entire common corpus with a larger in-memory TypeScript index.
 * The harness fails on any coverage mismatch.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const mib = 1024 ** 2;
const warmRuns = 30;
const timeout = 30 * 60_000;
const round = (value) => Math.round(value * 10) / 10;
const source = (path) => new URL(path, import.meta.url).href;

async function measure(search, queries, started) {
  const cold = await search(queries[0]);
  const coldMs = performance.now() - started;
  const durations = [];
  let hits = 0;
  let partial = Boolean(cold.partial);
  for (let run = 0; run < warmRuns; run += 1) {
    const before = performance.now();
    const result = await search(queries[run % queries.length]);
    durations.push(performance.now() - before);
    hits += result.results.length;
    partial ||= Boolean(result.partial);
  }
  durations.sort((a, b) => a - b);
  const at = (p) => round(durations[Math.ceil(p * durations.length) - 1]);
  return { coldMs: round(coldMs), p50Ms: at(0.5), p95Ms: at(0.95), hits, partial };
}

async function typescriptWorker(manifestPath) {
  const { root, paths, queries, fullComparison } = JSON.parse(await readFile(manifestPath, 'utf8'));
  const { benchmarkWorkspaceCodeIndex, searchWorkspaceCodeIndex } = await import(source('../packages/code-index/src/index.ts'));
  const { codeIndexStorage } = await import(source('../packages/code-index/src/storage.ts'));
  const files = { async listFiles() { return { ok: true, paths }; } };
  const start = performance.now();
  if (fullComparison) {
    const index = await benchmarkWorkspaceCodeIndex({ root, files, lexicalOnly: true });
    const results = await measure((query) => index.search(query, 8), queries, start);
    return { ...results, rssMiB: round(process.memoryUsage().rss / mib), paths: index.paths, chunks: index.chunks };
  }
  const results = await measure(async (query) => {
    const result = await searchWorkspaceCodeIndex({ root, files, query, limit: 8, lexicalOnly: true });
    if (!result.ok || result.indexing) throw new Error('TypeScript index did not commit');
    return result;
  }, queries, start);
  const rssMiB = round(process.memoryUsage().rss / mib);
  const snapshot = await (await codeIndexStorage(await realpath(root))).read();
  if (!snapshot) throw new Error('TypeScript index has no readable committed file');
  return {
    ...results, rssMiB, paths: snapshot.records.map((record) => record.path),
    chunks: snapshot.records.reduce((sum, record) => sum + record.chunks.length, 0),
  };
}

async function nativeRun(binary, scratch, root, queries) {
  const nativeHome = join(scratch, 'native');
  const discovery = join(scratch, 'native.json');
  const child = spawn(binary, ['serve'], {
    env: { ...process.env, BUILDERFORCE_DESKTOP_HOME: nativeHome, BUILDERFORCE_DESKTOP_DISCOVERY: discovery, HF_HUB_OFFLINE: '1' },
    stdio: 'ignore', windowsHide: true,
  });
  let bootError;
  child.once('error', (error) => { bootError = error; });
  try {
    let descriptor;
    const bootDeadline = performance.now() + 10_000;
    while (!descriptor && performance.now() < bootDeadline) {
      if (bootError) throw bootError;
      descriptor = await readFile(discovery, 'utf8').then(JSON.parse).catch(() => undefined);
      if (!descriptor) await delay(50);
    }
    if (!descriptor) throw new Error('Native service did not start');
    async function request(operation, body) {
      const response = await fetch(`http://127.0.0.1:${Number(descriptor.port)}/v1/${operation}`, {
        method: 'POST', body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${descriptor.token}`, 'content-type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Native ${operation} returned HTTP ${response.status}`);
      return response.json();
    }
    if ((await request('health', {})).embeddings !== 'disabled') {
      throw new Error('Build bf-context with cargo build --release --no-default-features -p bf-context for this lexical run');
    }
    const start = performance.now();
    await request('ensure', { root });
    let status;
    do {
      if (performance.now() - start > timeout) throw new Error('Native indexing exceeded the 30-minute budget');
      status = await request('status', { root });
      if (status.phase.state !== 'ready') await delay(150);
    } while (status.phase.state !== 'ready');
    const results = await measure((query) => request('search', { root, query, limit: 8 }), queries, start);
    const rssMiB = process.platform === 'win32'
      ? Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid}).WorkingSet64`], { windowsHide: true })) / mib
      : Number(execFileSync('ps', ['-o', 'rss=', '-p', String(child.pid)])) / 1024;
    const indexDir = join(nativeHome, 'indexes');
    const [dbFile] = (await readdir(indexDir)).filter((path) => path.endsWith('.db'));
    if (!dbFile) throw new Error('Native index has no readable SQLite file');
    const { DatabaseSync } = await import('node:sqlite');
    const index = new DatabaseSync(join(indexDir, dbFile), { readOnly: true });
    try {
      const paths = index.prepare('SELECT path FROM files').all().map((record) => record.path);
      return { ...results, rssMiB: round(rssMiB), paths, chunks: status.chunks };
    } finally {
      index.close();
    }
  } finally {
    child.kill();
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    repo: { type: 'string' }, commit: { type: 'string', default: 'HEAD' }, inventory: { type: 'boolean' },
    native: { type: 'string' }, files: { type: 'string' }, query: { type: 'string', multiple: true },
    'full-comparison': { type: 'boolean' },
  } });
  if (!values.repo) throw new Error('--repo is required');
  const { DEFAULT_REPO_MAP_LIMITS: limits, isMapCandidate } = await import(source('../packages/repo-map/src/filePolicy.ts'));
  const git = (args, opts = {}) => execFileSync('git', ['-c', 'protocol.allow=never', '-C', values.repo, ...args], {
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 64 * mib, windowsHide: true, ...opts,
  });
  const revision = git(['rev-parse', '--verify', '--end-of-options', `${values.commit}^{commit}`], { encoding: 'utf8' }).trim();
  const tracked = git(['ls-tree', '-r', '-l', '-z', revision], { encoding: 'utf8' }).split('\0').flatMap((line) => {
    const [, object, size, path] = /^100[0-7]{3} blob ([\da-f]+)\s+(\d+)\t([^]*?)$/u.exec(line) ?? [];
    return path ? [{ object, path, size: Number(size) }] : [];
  });
  const eligible = tracked.filter(({ path, size }) => isMapCandidate(path, size))
    .sort((a, b) => {
      if (a.path < b.path) return -1;
      if (a.path > b.path) return 1;
      return 0;
    });
  // Native's hidden-file walk excludes `.github` even though the TS policy accepts it.
  // Materialize the common corpus and report the difference on the inventory line.
  const common = eligible.filter(({ path }) => !path.split('/').some((segment) => segment.startsWith('.')));
  const bytes = (entries) => entries.reduce((sum, entry) => sum + entry.size, 0);
  let prefixBytes = 0;
  let prefixFiles = 0;
  for (const { size } of eligible) {
    if (prefixFiles >= limits.maxFiles || prefixBytes + size > limits.maxTotalBytes) break;
    prefixBytes += size;
    prefixFiles += 1;
  }
  console.log(JSON.stringify({
    revision, trackedFiles: tracked.length, eligibleFiles: eligible.length, eligibleBytes: bytes(eligible),
    commonFiles: common.length, nativeHiddenExclusions: eligible.length - common.length,
    maxReachableFilesIgnoringChunkCap: prefixFiles, prefixBytes, limits,
  }));
  if (values.inventory) return;
  if (!values.native || !values.query?.length || values.query.some((query) => !query.trim())) {
    throw new Error('--native and at least one nonempty --query are required');
  }
  const fullComparison = values['full-comparison'];
  if (fullComparison && values.files) throw new Error('--full-comparison requires the whole common corpus');
  const fileCount = values.files ? Number(values.files) : common.length;
  if (!Number.isSafeInteger(fileCount) || fileCount < 1 || fileCount > common.length) throw new Error('Invalid --files count');
  // Sample evenly from the Git tree order rather than measuring only the first package.
  const selected = Array.from({ length: fileCount }, (_, i) => common[Math.floor(i * common.length / fileCount)]);
  const budget = fullComparison
    ? (await import(source('../packages/code-index/src/index.ts'))).codeIndexBenchmarkBudget
    : limits;
  if (fileCount > budget.maxFiles || bytes(selected) > budget.maxTotalBytes) {
    throw new Error(fullComparison ? 'The corpus exceeds the full comparison budget.'
      : 'The corpus exceeds the shipped TypeScript limit. Use --full-comparison or an explicit --files sample size.');
  }
  const scratch = await mkdtemp(join(tmpdir(), 'bf-code-index-benchmark-'));
  const root = join(scratch, 'files');
  console.log(`Scratch corpus ${scratch}`);
  const blobs = git(['cat-file', '--batch'], {
    input: selected.map(({ object }) => `${object}\n`).join(''),
    maxBuffer: bytes(selected) + selected.length * 128,
  });
  const paths = [];
  const directories = new Map();
  const writes = [];
  const decoder = new TextDecoder('utf8', { fatal: true });
  let offset = 0;
  for (const { object, path, size } of selected) {
    const end = blobs.indexOf(10, offset);
    if (blobs.toString('utf8', offset, end) !== `${object} blob ${size}`) throw new Error('Git blob stream is misaligned');
    const body = blobs.subarray(end + 1, end + 1 + size);
    offset = end + size + 2;
    if (body.includes(0)) continue;
    try {
      if (!decoder.decode(body).trim()) continue;
    } catch {
      continue; // The native scanner requires valid UTF-8.
    }
    const destination = resolve(root, path);
    if (!destination.startsWith(root + sep)) throw new Error('Git path left the scratch root');
    const directory = dirname(destination);
    if (!directories.has(directory)) directories.set(directory, mkdir(directory, { recursive: true }));
    writes.push(directories.get(directory).then(() => writeFile(destination, body, { flag: 'wx' })));
    if (writes.length === 16) await Promise.all(writes.splice(0));
    paths.push(path);
  }
  await Promise.all(writes);
  if (!paths.length) throw new Error('The selected corpus has no readable source files');
  const manifest = join(scratch, 'manifest.json');
  await writeFile(manifest, JSON.stringify({ root, paths, queries: values.query, fullComparison }));
  const nodeFlags = fullComparison ? ['--max-old-space-size=12288'] : [];
  const typescript = JSON.parse(execFileSync(process.execPath, [...nodeFlags, '--import', 'tsx', fileURLToPath(import.meta.url), '--ts-worker', manifest], {
    encoding: 'utf8', maxBuffer: 16 * mib, timeout, windowsHide: true,
  }));
  const native = await nativeRun(resolve(values.native), scratch, root, values.query);
  const expected = new Set(paths);
  function summarize({ paths: indexed, ...results }) {
    const unique = new Set(indexed);
    const missing = paths.filter((path) => !unique.has(path));
    const unexpected = indexed.filter((path) => !expected.has(path));
    const coverageMatches = !missing.length && !unexpected.length;
    return {
      ...results, indexedFiles: unique.size, coverageMatches, missingFiles: missing.length, unexpectedFiles: unexpected.length,
      missing: missing.slice(0, 10), unexpected: unexpected.slice(0, 10),
    };
  }
  const result = {
    revision, corpusFiles: paths.length, requestedFiles: fileCount, warmRuns, engineOrder: ['typescript', 'native'],
    typescriptMode: fullComparison ? 'in-memory benchmark budget' : 'shared workspace snapshot',
    typescript: summarize(typescript), native: summarize(native),
  };
  await writeFile(join(scratch, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (!result.typescript.coverageMatches || !result.native.coverageMatches || result.typescript.partial) process.exitCode = 1;
}

if (process.argv[2] === '--ts-worker') console.log(JSON.stringify(await typescriptWorker(process.argv[3])));
else await main();
