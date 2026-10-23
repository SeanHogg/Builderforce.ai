/**
 * Post-edit fast checks (PRD D7, the container half) — after a turn's edits, run the
 * project's OWN quick checks on what was touched and hand the model only the failures.
 *
 * A model that breaks the type-check finds out, today, only when it thinks to run one,
 * or at the verify step after it has already declared victory — and pays a turn (or a
 * whole re-run) for it. This runs the check deterministically, once per turn batch,
 * within a fixed time budget, and costs the model nothing when everything passes.
 *
 * What to run is DATA ({@link POST_EDIT_CHECKS}): one row per check, first applicable row
 * per language group wins, resolved against the NEAREST project marker above each touched
 * file (so a monorepo package's own `typecheck` script runs in that package). A check
 * whose tooling is not present (no node_modules, no cargo) is skipped, never failed — a
 * missing dependency is not the model's error.
 *
 * Failures are shaped by the shared tool-output summarizer (`toolOutputPolicy.mjs`), so
 * the model reads the failing lines, not a 10,000-line log. A timeout is not a verdict
 * and is not reported to the model.
 */
import { dirname, join, posix } from 'node:path';

/** Total wall-clock one batch of checks may take. */
export const POST_EDIT_CHECK_BUDGET_MS = 60 * 1000;
/** The most distinct checks one batch runs. */
const MAX_CHECKS_PER_BATCH = 3;

const JS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const TS_EXTS = ['.ts', '.tsx', '.mts', '.cts'];
/** package.json scripts that are FAST checks, in preference order (never `test`/`build`). */
const FAST_SCRIPTS = ['typecheck', 'type-check', 'lint'];

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * The check table. `group` — one check per group per project; `exts` — touched files it
 * applies to; `marker` — the project file looked up from the touched file upward (its
 * directory is the check's cwd); `needs` — paths (relative to that directory) and
 * binaries that must exist; `command` — the shell command, or null when the row does not
 * apply after all (no fast script declared).
 */
export const POST_EDIT_CHECKS = [
  {
    id: 'package-script',
    group: 'js',
    exts: JS_EXTS,
    marker: 'package.json',
    needs: { paths: ['node_modules'] },
    command: ({ scripts }) => {
      const script = FAST_SCRIPTS.find((s) => typeof scripts?.[s] === 'string');
      return script ? `npm run --silent ${script}` : null;
    },
  },
  {
    id: 'tsc',
    group: 'js',
    exts: TS_EXTS,
    marker: 'tsconfig.json',
    needs: { paths: ['node_modules/.bin/tsc'] },
    command: () => 'npx --no-install tsc --noEmit -p tsconfig.json',
  },
  {
    id: 'cargo-check',
    group: 'rust',
    exts: ['.rs'],
    marker: 'Cargo.toml',
    needs: { bins: ['cargo'] },
    command: () => 'cargo check --quiet --message-format short',
  },
  {
    id: 'py-compile',
    group: 'python',
    exts: ['.py'],
    marker: null,
    needs: { bins: ['python3'] },
    command: ({ files }) => `python3 -m py_compile ${files.map(shellQuote).join(' ')}`,
  },
];

const extOf = (p) => {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
};

/**
 * The batch of checks for the paths touched this turn: `{ key, row, cwd, command, files }`.
 *
 * @param {string[]} touched repo-relative paths
 * @param {{ exists(rel: string): Promise<boolean>, hasBin(name: string): Promise<boolean>, readScripts(relDir: string): Promise<Record<string,string>|null> }} io
 */
export async function planPostEditChecks(touched, io) {
  /** Nearest directory at or above `relFile`'s that contains `marker` ('' = repo root). */
  const nearest = async (relFile, marker) => {
    let dir = posix.dirname(relFile);
    for (;;) {
      const d = dir === '.' ? '' : dir;
      if (await io.exists(d ? `${d}/${marker}` : marker)) return d;
      if (!d) return null;
      dir = posix.dirname(d);
    }
  };
  const plans = new Map();
  const decided = new Set();
  for (const file of touched) {
    const ext = extOf(file);
    for (const row of POST_EDIT_CHECKS) {
      if (!row.exts.includes(ext)) continue;
      const cwd = row.marker ? await nearest(file, row.marker) : '';
      if (cwd === null) continue;
      // One check per group per project: the first row that applies there wins.
      const groupKey = `${row.group}@${cwd}`;
      const existing = plans.get(groupKey);
      if (existing) {
        if (existing.row === row) existing.files.push(file);
        break;
      }
      if (decided.has(`${row.id}@${cwd}`)) continue;
      decided.add(`${row.id}@${cwd}`);
      const at = (p) => (cwd ? `${cwd}/${p}` : p);
      let ok = true;
      for (const p of row.needs.paths ?? []) if (!(await io.exists(at(p)))) { ok = false; break; }
      for (const b of row.needs.bins ?? []) if (ok && !(await io.hasBin(b))) ok = false;
      if (!ok) continue;
      const scripts = row.marker === 'package.json' ? await io.readScripts(cwd) : null;
      const files = [file];
      const plan = { key: groupKey, row, cwd, files, command: null, scripts };
      if (row.command({ scripts, files }) === null) continue;
      plans.set(groupKey, plan);
      break;
    }
  }
  for (const plan of plans.values()) plan.command = plan.row.command({ scripts: plan.scripts, files: plan.files.map((f) => (plan.cwd ? posix.relative(plan.cwd, f) : f)) });
  return [...plans.values()].slice(0, MAX_CHECKS_PER_BATCH);
}

/** The verifier name the cascade (PRD D1) records a post-edit verdict under. */
export const POST_EDIT_VERIFIER = 'post_edit_checks';

/**
 * The debounced runner for one run: `touch()` after each successful edit/write, then
 * before the next model turn either `drain()` — the model-facing message, or null when
 * nothing ran or everything passed (D7) — or `drainVerdict()`, which also carries the
 * verdict the Worker's cascade folds in (D1): null when no check could judge the batch
 * (nothing touched, nothing to run, every check skipped or timed out), else
 * `{ passed, verifier, reason?, steer }`.
 *
 * @param {{ workdir: string, run: (command: string, cwd: string, timeoutMs: number) => Promise<{ exitCode: number, output: string, timedOut?: boolean }>, io: Parameters<typeof planPostEditChecks>[1], fit: (output: string) => string, onEvent?: (event: object) => void, budgetMs?: number }} deps
 */
export function createPostEditChecks({ workdir, run, io, fit, onEvent = () => {}, budgetMs = POST_EDIT_CHECK_BUDGET_MS }) {
  const pending = new Set();
  const drainVerdict = async () => {
    if (pending.size === 0) return null;
    const touched = [...pending];
    pending.clear();
    const plans = await planPostEditChecks(touched, io);
    if (plans.length === 0) return null;
    const deadline = Date.now() + budgetMs;
    const failures = [];
    let judged = 0;
    for (const plan of plans) {
      const left = deadline - Date.now();
      if (left <= 1000) {
        onEvent({ check: plan.row.id, cwd: plan.cwd, skipped: 'budget' });
        continue;
      }
      const t0 = Date.now();
      const r = await run(plan.command, plan.cwd ? join(workdir, plan.cwd) : workdir, left);
      onEvent({ check: plan.row.id, cwd: plan.cwd, command: plan.command, exitCode: r.exitCode, timedOut: !!r.timedOut, durationMs: Date.now() - t0 });
      if (r.timedOut) continue;
      judged++;
      if (r.exitCode !== 0) failures.push({ plan, output: r.output, exitCode: r.exitCode });
    }
    if (judged === 0) return null;
    if (failures.length === 0) return { passed: true, verifier: POST_EDIT_VERIFIER, steer: null };
    return {
      passed: false,
      verifier: POST_EDIT_VERIFIER,
      reason: failures.slice(0, 5).map(({ plan, exitCode }) => `\`${plan.command}\`${plan.cwd ? ` (in ${plan.cwd})` : ''} exit ${exitCode}`).join('; '),
      steer: postEditCheckMessage(failures, fit),
    };
  };
  return {
    touch(path) {
      if (typeof path === 'string' && path) pending.add(path.replace(/\\/g, '/').replace(/^\.\/+/, ''));
    },
    drainVerdict,
    async drain() {
      const verdict = await drainVerdict();
      return verdict ? verdict.steer : null;
    },
  };
}

/** The steer the model reads: failing checks only, each summarized. */
export function postEditCheckMessage(failures, fit) {
  if (!failures.length) return null;
  const blocks = failures.map(({ plan, output, exitCode }) =>
    `✗ \`${plan.command}\`${plan.cwd ? ` (in ${plan.cwd})` : ''} — exit ${exitCode}\n${fit(output)}`);
  return [
    '[post-edit checks] Your last edits fail the project\'s own fast checks. These ran automatically on the files you just changed:',
    ...blocks,
    'Fix these before moving on. (Checks that passed are not listed.)',
  ].join('\n\n');
}

/** The filesystem half of `io`, over a real clone. */
export function cloneCheckIo(workdir, { access, readFile, hasBin }) {
  return {
    exists: async (rel) => {
      try {
        await access(join(workdir, rel));
        return true;
      } catch {
        return false; // absent is an answer, not an error
      }
    },
    hasBin,
    readScripts: async (relDir) => {
      const file = join(workdir, relDir, 'package.json');
      try {
        const scripts = JSON.parse(await readFile(file, 'utf8'))?.scripts;
        return scripts && typeof scripts === 'object' && !Array.isArray(scripts) ? scripts : null;
      } catch (e) {
        console.warn(`[container] post-edit checks: unreadable ${dirname(file)}/package.json (${e.message})`);
        return null;
      }
    },
  };
}
