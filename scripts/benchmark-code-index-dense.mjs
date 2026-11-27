/**
 * Offline judged code retrieval, using a scratch corpus from benchmark-code-index.mjs.
 * Run from agent-runtime on Node 24+ after installing its dependencies:
 *   node --import tsx ../scripts/benchmark-code-index-dense.mjs --corpus <lexical scratch>
 *     --judgments <local JSON> --models <bf-context model cache>
 *     --native-lexical <no-default-features binary> --native-hybrid <embeddings-enabled binary>
 * Judgments are a JSON array of {id, query, path}. `path` is the judged relevant repo-relative file.
 * Default sample is all judged files plus evenly spaced distractors up to 64 files. `--files` overrides it.
 * `--prepare-only` writes the sampled corpus and computed overlap without running either engine.
 */
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  CODE_EMBEDDING_MODEL as modelId,
  CODE_EMBEDDING_DIMENSIONS as dimensions,
  cachedBgeSnapshot,
  loadBgeCodeEmbedder,
} from '../packages/code-index/src/bgeEmbedder.ts';

const topK = 8;
const lowOverlap = 0.25;
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const stops = new Set('a an and are as at be before but by could does for from get give how in into is it its let of on or out same so than that the their them then through to up use using was what when where which while who with without would'.split(' '));

function tokens(text) {
  const words = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [];
  return new Set(words.filter((word) => !stops.has(word)));
}

function containedPath(root, path) {
  const within = relative(root, path);
  if (!within || isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`)) {
    throw new Error('A corpus file escaped its scratch root');
  }
  return path;
}

async function prepare(corpus, judgments, count) {
  const origin = await readJson(join(corpus, 'manifest.json'));
  const { revision } = await readJson(join(corpus, 'result.json'));
  const queries = await readJson(judgments);
  if (!Array.isArray(queries) || !queries.length || queries.some((row) => !row || typeof row.id !== 'string'
    || typeof row.query !== 'string' || !row.query.trim() || typeof row.path !== 'string')) {
    throw new Error('Provide a nonempty judgments array of {id, query, path}');
  }
  if (new Set(queries.map(({ id }) => id)).size !== queries.length) throw new Error('Judgment IDs must be unique');
  const targets = new Set(queries.map(({ path }) => path));
  const unique = new Set(origin.paths);
  if (![...targets].every((target) => unique.has(target))) throw new Error('A judged file is absent from the pinned corpus');
  const available = [...unique].sort();
  const sampleSize = count ?? Math.min(64, available.length);
  if (!Number.isSafeInteger(sampleSize) || sampleSize < targets.size || sampleSize > available.length) {
    throw new Error('--files must fit the corpus and include every judged file');
  }
  const other = available.filter((path) => !targets.has(path));
  const extras = sampleSize - targets.size;
  const paths = [...targets, ...Array.from({ length: extras }, (_, i) => other[Math.floor((i + 0.5) * other.length / extras)])].sort();
  const sourceRoot = await realpath(origin.root);
  const scratch = await mkdtemp(join(tmpdir(), 'bf-code-dense-benchmark-'));
  const root = join(scratch, 'files');
  for (const path of paths) {
    const file = containedPath(sourceRoot, await realpath(resolve(sourceRoot, path)));
    const dest = containedPath(root, resolve(root, path));
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(file, dest);
  }
  const qrels = [];
  for (const { id, query, path } of queries) {
    const terms = [...tokens(query)];
    if (!terms.length) throw new Error(`Judgment ${id} needs at least one content term`);
    const code = tokens(`${path}\n${await readFile(join(root, path), 'utf8')}`);
    const overlap = terms.filter((term) => code.has(term)).length / terms.length;
    qrels.push({ id, query, path, overlap });
  }
  const study = { revision, root, paths, qrels };
  await writeFile(join(scratch, 'manifest.json'), JSON.stringify(study, null, 2));
  return { ...study, scratch };
}

function checkCoverage(expected, actual) {
  const indexed = [...actual].sort();
  if (indexed.length !== expected.length || indexed.some((path, i) => path !== expected[i])) {
    throw new Error(`Indexed file coverage differs from the pinned sample (${indexed.length}/${expected.length})`);
  }
}

async function scoreQueries(search, qrels) {
  const rows = [];
  for (const { id, query, path, overlap } of qrels) {
    const { results } = await search(query);
    rows.push({
      id, overlap, rank: results.findIndex((hit) => hit.path === path) + 1,
      denseHits: results.filter((hit) => hit.source === 'embedding' || hit.source === 'hybrid').length,
    });
  }
  return rows;
}

async function typescript(study, snapshot) {
  const load = createRequire(resolve('package.json'));
  const { env, pipeline } = load('@huggingface/transformers');
  const { searchWorkspaceCodeIndex } = await import('../packages/code-index/src/index.ts');
  const { codeIndexStorage } = await import('../packages/code-index/src/storage.ts');
  const { root, paths, qrels } = study;
  const files = { async listFiles() { return { ok: true, paths }; } };
  let model;
  let embeddedInputs = 0;
  const nativeFetch = globalThis.fetch;
  env.allowRemoteModels = false;
  env.useFSCache = false;
  globalThis.fetch = async () => { throw new Error('Network fetch disabled during offline embedding'); };
  try {
    model = await loadBgeCodeEmbedder(snapshot, pipeline);
    const { checkpointSha256, port } = model;
    const { fingerprint } = port;
    const embedder = {
      ...port,
      async embed(texts) {
        embeddedInputs += texts.length;
        return port.embed(texts);
      },
    };
    const search = (lexicalOnly) => async (query) => {
      const result = await searchWorkspaceCodeIndex({ root, files, query, limit: topK, lexicalOnly, embedder });
      if (!result.ok || result.partial || result.indexing) throw new Error('TypeScript index coverage is incomplete');
      return result;
    };
    const hybrid = await scoreQueries(search(false), qrels);
    const lexical = await scoreQueries(search(true), qrels);
    const index = await (await codeIndexStorage(await realpath(root))).read();
    if (!index?.fingerprint.includes(fingerprint) || !embeddedInputs) throw new Error('TypeScript did not commit a BGE snapshot');
    checkCoverage(paths, index.records.map((record) => record.path));
    return { checkpointSha256, fingerprint, embeddedInputs, lexical, hybrid };
  } finally {
    globalThis.fetch = nativeFetch;
    await model?.dispose();
  }
}

async function native(study, binary, models) {
  const { root, paths, qrels, scratch } = study;
  const home = join(scratch, models ? 'native-hybrid' : 'native-lexical');
  const discovery = join(home, 'native.json');
  await mkdir(home);
  if (models) await symlink(models, join(home, 'models'), process.platform === 'win32' ? 'junction' : 'dir');
  const proxy = 'http://127.0.0.1:9';
  const child = spawn(binary, ['serve'], {
    windowsHide: true, stdio: 'ignore',
    env: { ...process.env, BUILDERFORCE_DESKTOP_HOME: home, BUILDERFORCE_DESKTOP_DISCOVERY: discovery,
      HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', HTTP_PROXY: proxy, HTTPS_PROXY: proxy,
      ALL_PROXY: proxy, NO_PROXY: '127.0.0.1,localhost' },
  });
  let bootError;
  child.once('error', (error) => { bootError = error; });
  try {
    let descriptor;
    for (let i = 0; i < 300 && !descriptor; i += 1) {
      if (bootError) throw bootError;
      if (child.exitCode !== null) throw new Error(`Native service exited (${child.exitCode})`);
      descriptor = await readJson(discovery).catch(() => undefined);
      if (!descriptor) await delay(100);
    }
    if (!descriptor) throw new Error('Native service did not start');
    async function request(operation, data) {
      const response = await fetch(`http://127.0.0.1:${Number(descriptor.port)}/v1/${operation}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000), body: JSON.stringify(data),
        headers: { authorization: `Bearer ${descriptor.token}`, 'content-type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Native ${operation} returned HTTP ${response.status}`);
      return response.json();
    }
    let health = await request('health', {});
    for (let i = 0; i < 120 && health.embeddings === 'loading'; i += 1) {
      await delay(1000);
      health = await request('health', {});
    }
    if (health.embeddings !== (models ? 'ready' : 'disabled')) throw new Error(`Native embeddings were ${health.embeddings}`);
    await request('ensure', { root });
    let status = await request('status', { root });
    for (let i = 0; i < 300 && status.phase.state !== 'ready'; i += 1) {
      await delay(1000);
      status = await request('status', { root });
    }
    if (status.phase.state !== 'ready' || status.embedded !== (models ? status.chunks : 0)) {
      throw new Error('Native indexing or model coverage is incomplete');
    }
    const indexDir = join(home, 'indexes');
    const [db] = (await readdir(indexDir)).filter((path) => path.endsWith('.db'));
    if (!db) throw new Error('Native SQLite index is missing');
    const { DatabaseSync } = await import('node:sqlite');
    const index = new DatabaseSync(join(indexDir, db), { readOnly: true });
    try {
      checkCoverage(paths, index.prepare('SELECT path FROM files').all().map((row) => row.path));
    } finally {
      index.close();
    }
    const rows = await scoreQueries((query) => request('search', { root, query, limit: topK }), qrels);
    return { version: health.version, chunks: status.chunks, embedded: status.embedded, rows };
  } finally {
    child.kill();
  }
}

function metrics(rows) {
  const count = rows.length;
  return { count, hitAt1: rows.filter(({ rank }) => rank === 1).length, hitAt8: rows.filter(({ rank }) => rank > 0).length,
    mrrAt8: count ? rows.reduce((sum, { rank }) => sum + (rank ? 1 / rank : 0), 0) / count : null };
}

const { values } = parseArgs({ options: {
  corpus: { type: 'string' }, judgments: { type: 'string' }, files: { type: 'string' }, models: { type: 'string' },
  'native-lexical': { type: 'string' }, 'native-hybrid': { type: 'string' }, 'prepare-only': { type: 'boolean' },
} });
if (!values.corpus || !values.judgments) throw new Error('--corpus and --judgments are required');
if (!values['prepare-only'] && (!values.models || !values['native-lexical'] || !values['native-hybrid'])) {
  throw new Error('--models, --native-lexical and --native-hybrid are required');
}
const study = await prepare(values.corpus, values.judgments, values.files === undefined ? undefined : Number(values.files));
console.log(JSON.stringify({ scratch: study.scratch, revision: study.revision, files: study.paths.length,
  judgments: study.qrels.length, lowOverlap: study.qrels.filter(({ overlap }) => overlap <= lowOverlap).length }));
if (!values['prepare-only']) {
  const models = await realpath(values.models);
  const snapshot = await cachedBgeSnapshot(models);
  if (!snapshot) throw new Error('Missing or invalid cached BGE revision');
  const modelRevision = basename(snapshot);
  const ts = await typescript(study, snapshot);
  const nativeLexical = await native(study, resolve(values['native-lexical']));
  const nativeHybrid = await native(study, resolve(values['native-hybrid']), models);
  const byMode = { typescriptLexical: ts.lexical, typescriptHybrid: ts.hybrid, nativeLexical: nativeLexical.rows, nativeHybrid: nativeHybrid.rows };
  const scores = Object.fromEntries(Object.entries(byMode).map(([mode, rows]) => [mode, {
    all: metrics(rows), lowOverlap: metrics(rows.filter(({ overlap }) => overlap <= lowOverlap)),
    zeroOverlap: metrics(rows.filter(({ overlap }) => overlap === 0)),
  }]));
  const result = { revision: study.revision, modelId, modelRevision, dimensions, topK, lowOverlap,
    files: study.paths.length, judgments: study.qrels.length, judgedFiles: new Set(study.qrels.map(({ path }) => path)).size,
    checkpointSha256: ts.checkpointSha256, fingerprint: ts.fingerprint, scores, typescript: ts, nativeLexical, nativeHybrid };
  await writeFile(join(study.scratch, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ revision: study.revision, fingerprint: ts.fingerprint, scores }));
}
