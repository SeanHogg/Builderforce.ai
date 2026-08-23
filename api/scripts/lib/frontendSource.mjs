/**
 * Reader for FRONTEND source files that api-side contracts are held against.
 *
 * Several guards and tests in this package assert parity with a constant the frontend
 * owns — the workflow step palette, the canvas sales ladder, the funding-round
 * vocabulary. None of them can `import` it (different package, TSX, React types), so
 * they read the file off disk. That technique has exactly one failure mode, and it has
 * now fired three times: the frontend file MOVES, the read throws `ENOENT`, and the
 * contract stops being checked. `components/workflow-builder/` was deleted when the
 * canvas absorbed the builder, which broke `dataProviderCatalog.test.ts` outright and
 * left `check-trigger-palette-parity.mjs` printing a fix-it message naming a directory
 * that no longer exists.
 *
 * So the path is read through here instead of being spelled at each call site:
 *   • ONE place resolves paths from the repo root rather than from the CWD, so a guard
 *     behaves the same run from `api/` and from the repo root.
 *   • A miss is not `ENOENT`. It names the contract, says re-point rather than delete,
 *     and SEARCHES `frontend/src` for the file's basename so the message carries the
 *     new path — the move becomes a one-line fix instead of an investigation.
 *
 * `.mjs` with a sibling `.d.mts`, for the same reason as `tsSource.mjs`: unbuilt CI
 * scripts and vitest tests both consume it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root — `api/scripts/lib` is three levels down from it. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Directories a source search must never descend into. */
const SKIP = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'out', '.turbo']);

/** `foo/barBaz.ts` → `barbaz`. */
function stem(name) {
  return basename(name, extname(name)).toLowerCase();
}

/**
 * Whether `candidate` plausibly IS the file that was named `wanted` — the same name, or
 * one renamed by prefixing/suffixing it. `stepIntegrations.ts` is what `integrations.ts`
 * became when it moved into the workflow domain, and a strict equality search would have
 * reported "gone" for a file sitting right there.
 */
function looksLikeMove(candidate, wanted) {
  const [a, b] = [stem(candidate), stem(wanted)];
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && (long.endsWith(short) || long.startsWith(short));
}

/**
 * Every file under `dir` that could be `name` after a move or a rename, as repo-relative
 * paths. Only ever called on the failure path, so a full walk of `frontend/src` costs
 * nothing in the passing case.
 */
function findByBasename(dir, name, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) findByBasename(resolve(dir, entry.name), name, found);
    } else if (looksLikeMove(entry.name, name)) {
      found.push(relative(repoRoot, resolve(dir, entry.name)).split('\\').join('/'));
    }
  }
  return found;
}

/** Absolute path of a repo-relative frontend source file. */
export function frontendSourcePath(relPath) {
  return resolve(repoRoot, relPath);
}

/**
 * The text of a repo-relative frontend source file.
 *
 * @param relPath repo-relative path, e.g. `frontend/src/lib/canvasSalesPipeline.ts`
 * @param contract what the caller is checking, named in the error so a failure says
 *                 which guard just went blind.
 */
export function readFrontendSource(relPath, contract) {
  const abs = frontendSourcePath(relPath);
  if (existsSync(abs)) return readFileSync(abs, 'utf8');

  const moved = findByBasename(resolve(repoRoot, 'frontend', 'src'), basename(relPath));
  const where = moved.length
    ? `Candidates under frontend/src:\n${moved.slice(0, 10).map((p) => `  • ${p}`).join('\n')}`
    : `Nothing under frontend/src resembles \`${basename(relPath)}\` any more.`;
  throw new Error(
    `${contract}: \`${relPath}\` no longer exists, so this cross-package contract is ` +
    `checking nothing. Re-point it — do not delete it.\n${where}`,
  );
}
