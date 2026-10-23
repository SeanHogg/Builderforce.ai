/**
 * The container's repo index (PRD C5) — the `repo.semantic` capability backed by the
 * image's own `bf-context` binary (builderforce-inference, built into the image by the
 * Dockerfile's builder stage) over the run's clone.
 *
 * The clone is indexed ONCE, in the background, right after it lands, so the first LLM
 * turn is never held by it. Until that finishes both tools answer "still building"
 * rather than racing the indexer for the same SQLite file; afterwards `repo-map` rescans
 * incrementally on each call, so the map includes the run's own edits.
 *
 * The tool DEFINITIONS are not here: `semanticTools.mjs` is the shared `repo_map` /
 * `semantic_search` from `@builderforce/agent-tools` (compiled by
 * `api/scripts/gen-container-shared.mjs`), so the result shape the model reads is the
 * one Desktop and the durable runner produce. This module only answers the capability.
 *
 * Every process is spawned WITHOUT a shell (argv, not a command string), so a query or
 * a focus path from the model can never be interpreted as shell syntax.
 */
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where the Dockerfile installs the binary; overridable for local runs and tests. */
export const BF_CONTEXT_BIN = process.env.BF_CONTEXT_BIN || '/usr/local/bin/bf-context';

/** The tool names this module backs — added to the image's handshake only when it is live. */
export const REPO_INDEX_TOOL_NAMES = ['repo_map', 'semantic_search'];

/** One full index of a large clone can take minutes; past this it is abandoned. */
const INDEX_TIMEOUT_MS = 10 * 60 * 1000;
/** One repo-map / search call. */
const QUERY_TIMEOUT_MS = 60 * 1000;
/** The longest stdout read from one call (a map is ≤ 8,000 tokens; search JSON is small). */
const MAX_STDOUT_CHARS = 256 * 1024;

/** Run `file` with `args` (no shell); resolves with the exit code and captured output. */
export function execFileCapture(file, args, { env, timeoutMs, signal }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(file, args, { env, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ exitCode: -1, stdout: '', stderr: e instanceof Error ? e.message : String(e), timedOut: false });
      return;
    }
    child.stdout.on('data', (c) => { if (stdout.length < MAX_STDOUT_CHARS) stdout += c; });
    child.stderr.on('data', (c) => { if (stderr.length < 8_192) stderr += c; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const done = (exitCode) => { clearTimeout(timer); resolve({ exitCode, stdout, stderr, timedOut }); };
    child.on('close', (code) => done(code ?? -1));
    child.on('error', (e) => { stderr += e.message; done(-1); });
  });
}

/** Whether the binary is in this image — an image built before C5 has none. */
export async function bfContextAvailable(bin = BF_CONTEXT_BIN) {
  try {
    await access(bin, fsConstants.X_OK);
    return true;
  } catch (e) {
    console.warn(`[container] bf-context not available at ${bin} (${e.code || e.message}); repo_map / semantic_search stay off`);
    return false;
  }
}

/** Free words of a query as argv entries; a word starting `--` would end bf-context's value list. */
function queryArgs(query) {
  return String(query || '').split(/\s+/).filter((w) => w && !w.startsWith('--'));
}

/** bf-context's search hit (camelCase) → the shared SemanticSearchHit. */
function toHit(h) {
  return {
    path: String(h.path ?? ''),
    startLine: Number(h.startLine ?? h.start_line ?? 0),
    endLine: Number(h.endLine ?? h.end_line ?? 0),
    symbol: h.symbol ?? undefined,
    kind: h.kind,
    snippet: String(h.snippet ?? ''),
    source: h.source === 'embedding' || h.source === 'hybrid' ? h.source : 'keyword',
  };
}

function inScope(path, scope) {
  if (!scope) return true;
  const s = scope.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  return !s || path === s || path.startsWith(`${s}/`);
}

/**
 * Start indexing `workdir` in the background and return the capability over it.
 *
 * @param {{ workdir: string, bin?: string, exec?: typeof execFileCapture, onEvent?: (event: object) => void }} opts
 */
export async function startRepoIndex({ workdir, bin = BF_CONTEXT_BIN, exec = execFileCapture, onEvent = () => {} }) {
  // bf-context keeps its index under $HOME/.builderforce — a per-run home keeps it out
  // of the clone (where `git add -A` would stage it) and is removed with the run.
  const home = await mkdtemp(join(tmpdir(), 'bf-context-'));
  const env = { ...process.env, HOME: home };
  const startedAt = Date.now();
  // Disposing the run stops an index that is still building (the process may outlive it).
  const stop = new AbortController();
  let state = 'building';
  let failure = '';

  const indexing = exec(bin, ['index', workdir], { env, timeoutMs: INDEX_TIMEOUT_MS, signal: stop.signal }).then((r) => {
    if (stop.signal.aborted) {
      state = 'failed';
      failure = 'the run ended';
      return;
    }
    if (r.exitCode === 0) {
      state = 'ready';
      onEvent({ phase: 'ready', durationMs: Date.now() - startedAt });
    } else {
      state = 'failed';
      failure = r.timedOut ? `indexing timed out after ${Math.round(INDEX_TIMEOUT_MS / 1000)}s` : (r.stderr || `exit ${r.exitCode}`).slice(0, 300);
      onEvent({ phase: 'failed', error: failure, durationMs: Date.now() - startedAt });
    }
  });

  /** The answer while the index is not usable, or null when it is. */
  const notReady = () => {
    if (state === 'building') {
      return { ok: false, indexing: true, error: `The repo index is still building (started ${Math.round((Date.now() - startedAt) / 1000)}s ago). Call this again in a minute; use list_files / run_command (grep) meanwhile.` };
    }
    if (state === 'failed') return { ok: false, error: `The repo index is unavailable (${failure}). Use list_files / run_command (grep) instead.` };
    return null;
  };

  return {
    /** For tests and the handshake: 'building' | 'ready' | 'failed'. */
    get state() { return state; },
    /** Resolves once the background index has finished (either way). */
    whenSettled: () => indexing,

    async repoMap(opts = {}) {
      const blocked = notReady();
      if (blocked) return blocked;
      const args = ['repo-map', '--root', workdir, '--max-tokens', String(opts.maxTokens ?? 1500)];
      const focus = Array.isArray(opts.focus) ? opts.focus.filter((f) => typeof f === 'string' && f && !f.startsWith('--')) : [];
      if (focus.length) args.push('--focus', ...focus);
      const words = queryArgs(opts.query);
      if (words.length) args.push('--query', ...words);
      const r = await exec(bin, args, { env, timeoutMs: QUERY_TIMEOUT_MS });
      if (r.exitCode !== 0) return { ok: false, error: `repo map failed: ${(r.timedOut ? 'timed out' : r.stderr || `exit ${r.exitCode}`).slice(0, 300)}` };
      return { ok: true, map: r.stdout };
    },

    async search(query, opts = {}) {
      const blocked = notReady();
      if (blocked) return blocked;
      const words = queryArgs(query);
      if (!words.length) return { ok: false, error: 'query is required' };
      const r = await exec(bin, ['search', workdir, ...words], { env, timeoutMs: QUERY_TIMEOUT_MS });
      if (r.exitCode !== 0) return { ok: false, error: `semantic search failed: ${(r.timedOut ? 'timed out' : r.stderr || `exit ${r.exitCode}`).slice(0, 300)}` };
      let parsed;
      try {
        parsed = JSON.parse(r.stdout);
      } catch (e) {
        return { ok: false, error: `semantic search returned unreadable output: ${e.message}` };
      }
      const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : 8;
      const results = (Array.isArray(parsed?.results) ? parsed.results : []).map(toHit).filter((h) => inScope(h.path, opts.scope)).slice(0, limit);
      return { ok: true, query, total: results.length, results };
    },

    /** Remove the per-run index home. */
    async dispose() {
      stop.abort();
      await rm(home, { recursive: true, force: true }).catch((e) => console.warn('[container] could not remove the bf-context home', e));
    },
  };
}
