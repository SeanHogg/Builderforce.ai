#!/usr/bin/env node
/**
 * Single tool-classifier guard.
 *
 * Tool side effects are classified in ONE place, `packages/agent-tools/src`
 * (`TOOL_SIDE_EFFECT`, `classifyTool`, `isMutatingTool`, `evaluatePolicyGate`). Every host
 * imports them; an unclassified tool fails closed. A second classifier elsewhere is a second
 * copy that drifts (the VS Code `policy.ts` mirror and its `READ_ONLY_TOOLS` list did exactly
 * that), so this fails when a source file outside that package defines one:
 *
 *   - `function evaluatePolicyGate(`, `TOOL_SIDE_EFFECT =`, `function isMutatingTool(`;
 *   - a `READ_ONLY_TOOLS` set;
 *   - an `isMutating` function/const (`function isMutating(`, `const isMutating =`,
 *     `isMutating = (`) — hosts call `classifyTool` / `isMutatingTool`, they do not define one;
 *   - a literal `mutating: false` in a VS Code tool def (`clients/vscode/src`, non-test) —
 *     a tool def routes through `toolMutating(name, { mutates })`, so the shared classifier decides.
 *
 * Files are enumerated with `git ls-files --cached --others --exclude-standard`, so ignored
 * worktrees, `dist` and `node_modules` are skipped for free while a new untracked copy is
 * still caught. If git is unavailable it falls back to a filesystem walk that skips the usual
 * build/worktree directories and `.builderforce`.
 *
 * Run from anywhere; it derives the repo root from its own location.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(self), '..');
const OWNER = 'packages/agent-tools/src/';
const EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.next', '.wrangler', '.turbo', 'coverage', 'out', '.builderforce']);

const isTest = (rel) => /\.test\.[cm]?[jt]sx?$/.test(rel);

/**
 * Narrow, exact-path allowance: the Brain context's `isMutating` METHOD (the context value's public name)
 * delegates to `isBrainActionMutating` / the shared `isMutatingTool`. Tests are excluded by rule, not by list.
 */
const ISMUTATING_ALLOW = new Set(['brain-embedded/src/BrainActionsContext.tsx']);

const FORBIDDEN = [
  { re: /\bfunction\s+evaluatePolicyGate\s*\(|\bconst\s+evaluatePolicyGate\s*=/, what: 'an evaluatePolicyGate definition' },
  { re: /\bTOOL_SIDE_EFFECT\s*=/, what: 'TOOL_SIDE_EFFECT =' },
  { re: /\bfunction\s+isMutatingTool\s*\(|\bconst\s+isMutatingTool\s*=/, what: 'an isMutatingTool definition' },
  // Name lists that decide "does this tool need confirmation / is it a read": the shared classifier owns them
  // (`HOST_READ_ONLY_TOOLS`, `READ_ONLY_ACTIONS`). Concurrency/dedupe allowlists (READ_ONLY_CLOUD_TOOLS, shell programs) are a different question.
  { re: /\bREAD_ONLY_(?:TOOLS|TOOL_NAMES|ACTIONS|TOOLSET)\b\s*(?::[^=]+)?=/, what: 'a READ_ONLY_TOOLS-style classification set' },
  {
    re: /\bfunction\s+isMutating\s*\(|\bconst\s+isMutating\s*=|\bisMutating\s*=\s*\(/,
    what: 'an isMutating classifier',
    skip: (rel) => isTest(rel) || ISMUTATING_ALLOW.has(rel),
  },
  {
    re: /\bmutating:\s*(?:true|false)\b/,
    what: 'a literal `mutating: true|false` tool def (use toolMutating(name, { mutates }))',
    only: (rel) => rel.startsWith('clients/vscode/src/') && !isTest(rel) && rel !== 'clients/vscode/src/toolMutating.ts',
  },
];


const isCandidate = (rel) =>
  EXTS.has(path.extname(rel)) &&
  !rel.endsWith('.map') &&
  !rel.includes('media/webview') &&
  !rel.startsWith('brain-embedded/dist/') &&
  !rel.startsWith('.builderforce/');

function gitFiles() {
  const r = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs'],
    { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.error || r.status !== 0) return undefined;
  return r.stdout.split('\n').filter(Boolean);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile()) {
      yield path.relative(root, full).split(path.sep).join('/');
    }
  }
}

const files = (gitFiles() ?? [...walk(root)]).filter(isCandidate);

const problems = [];
for (const rel of files) {
  if (rel.startsWith(OWNER)) continue;
  if (path.resolve(root, rel) === self) continue;
  let text;
  try { text = readFileSync(path.join(root, rel), 'utf8'); } catch { continue; } // deleted but still indexed
  for (const { re, what, skip, only } of FORBIDDEN) {
    if (only && !only(rel)) continue;
    if (skip?.(rel)) continue;
    if (re.test(text)) problems.push(`${rel}: defines ${what}`);
  }
}

if (problems.length > 0) {
  console.error(`Single tool-classifier: ${problems.length} problem(s).\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nThe classifier lives in packages/agent-tools/src (tool-side-effect.ts, spec.ts). Import it from\n' +
      '"@builderforce/agent-tools" (classifyTool / isMutatingTool) instead of defining another; extend the shared one if it lacks a case.',
  );
  process.exit(1);
}
console.log('Single tool-classifier: ok.');
