/**
 * Incremental typechecks: each tsc step of an area (the package's own script chain is NOT edited) gets
 * `--incremental --tsBuildInfoFile <area>/node_modules/.cache/bf-prepush/<area>-<tsconfig>.tsbuildinfo`, so a second run
 * re-checks only what changed. Checked with `tsc --version` / `--help --all`: api, frontend, clients/vscode and
 * packages/* all resolve TypeScript 7.0.2 (native), which lists `--incremental` and `--tsBuildInfoFile`.
 * A tsconfig that already sets `incremental` or `composite` is left alone (never double-specified).
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ALREADY_INCREMENTAL = /"(?:incremental|composite)"\s*:\s*true/;

/** `tsc ...` or `node <...>/tsc[.js] ...` (how knowledge-graph-view reaches the frontend's compiler). */
export const isTsc = (argv) => argv[0] === 'tsc' || (argv[0] === 'node' && /[\\/]tsc(?:\.js)?$/.test(argv[1] ?? ''));

function tsconfigOf(root, dir, argv) {
  const at = argv.findIndex((a) => a === '-p' || a === '--project');
  const abs = resolve(root, dir, at >= 0 ? argv[at + 1] : 'tsconfig.json');
  return abs.endsWith('.json') ? abs : join(abs, 'tsconfig.json');
}

/** @returns {{ argv: string[], buildInfo?: string }} the step, with the incremental flags when they apply. */
export function withIncremental(root, area, argv) {
  if (!isTsc(argv) || argv.some((a) => a === '--incremental' || a === '-i' || a === '--tsBuildInfoFile')) return { argv };
  const project = tsconfigOf(root, area.dir, argv);
  let text;
  try { text = readFileSync(project, 'utf8'); } catch { return { argv }; }
  if (ALREADY_INCREMENTAL.test(text)) return { argv };
  const slug = relative(join(root, area.dir), project).replace(/\.json$/, '').replace(/[^\w]+/g, '-');
  const buildInfo = join(root, area.dir, 'node_modules', '.cache', 'bf-prepush', `${area.id}-${slug}.tsbuildinfo`);
  try { mkdirSync(dirname(buildInfo), { recursive: true }); } catch { return { argv }; }
  return { argv: [...argv, '--incremental', '--tsBuildInfoFile', buildInfo], buildInfo };
}

/** True when any of the task's tsbuildinfo files does not exist yet (the first run of this area is cold). */
export const isCold = (task) => (task.buildInfos ?? []).some((file) => !existsSync(file));
