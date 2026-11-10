/**
 * What `check:run-delta-layers` holds (PRD 41 §D0: measured decides, predicted advises).
 *
 * A prediction never sets or changes a verdict. So no file on the VERDICT side of
 * `packages/run-delta/src` — `engine/**` (where `verdict.ts` lives today), `rules/**`, and
 * any `verdict/**` folder — may reach `predict/**`, directly or through any chain of the
 * package's own imports (a barrel that re-exports `predict/` counts: importing it is
 * importing `predict/`). `predict/` may import the delta contract; never the reverse.
 *
 * Pure: the guard (`scripts/check-run-delta-layers.mjs`) reads the files and builds the
 * import graph; this module only judges a graph, so the test feeds it fixtures.
 */

/** The package's source root, repo-relative. */
export const RUN_DELTA_SRC = 'packages/run-delta/src';

/** The folders whose files decide verdicts. */
export const VERDICT_LAYERS = ['engine', 'rules', 'verdict'];

/** The folder whose files predict. */
export const PREDICT_LAYER = 'predict';

/** The package's own bare name; a `/predict` subpath of it is a predict import by name. */
export const PACKAGE_NAME = '@builderforce/run-delta';

/** `packages/run-delta/src/<layer>/…` → `<layer>`, else null. */
function layerOf(rel) {
  if (!rel.startsWith(`${RUN_DELTA_SRC}/`)) return null;
  const rest = rel.slice(RUN_DELTA_SRC.length + 1);
  const slash = rest.indexOf('/');
  return slash < 0 ? null : rest.slice(0, slash);
}

/** A test file is not shipped code: it may import both sides. */
export function isTestPath(rel) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.split('/').includes('__fixtures__');
}

export const isVerdictFile = (rel) => VERDICT_LAYERS.includes(layerOf(rel) ?? '') && !isTestPath(rel);
export const isPredictFile = (rel) => layerOf(rel) === PREDICT_LAYER;

/** `@builderforce/run-delta/predict` or any deeper subpath of it. */
export const isPredictSpecifier = (specifier) =>
  specifier === `${PACKAGE_NAME}/${PREDICT_LAYER}` || specifier.startsWith(`${PACKAGE_NAME}/${PREDICT_LAYER}/`);

/**
 * @typedef {object} FileImports
 * @property {string[]} specifiers Every module specifier the file writes (relative and bare).
 * @property {string[]} targets    The repo-relative package files those specifiers resolve to.
 */

/**
 * Every verdict-side file that reaches `predict/`, with the chain that gets there.
 *
 * @param {Map<string, FileImports>} graph repo-relative POSIX path → its imports. Files absent
 *   from the graph are leaves.
 * @returns {{ file: string, chain: string[] }[]} sorted by file; `chain` runs from the verdict
 *   file to the predict file (or ends in the predict specifier written by name).
 */
export function findLayerViolations(graph) {
  /** @type {{ file: string, chain: string[] }[]} */
  const violations = [];
  for (const start of [...graph.keys()].filter(isVerdictFile).sort()) {
    /** @type {Map<string, string | null>} file → the file that reached it first. */
    const parent = new Map([[start, null]]);
    const queue = [start];
    let hit = null;
    while (queue.length && !hit) {
      const file = /** @type {string} */ (queue.shift());
      const entry = graph.get(file);
      if (!entry) continue;
      const named = entry.specifiers.find(isPredictSpecifier);
      if (named) {
        hit = { at: file, tail: named };
        break;
      }
      for (const target of [...entry.targets].sort()) {
        if (parent.has(target) || isTestPath(target)) continue;
        parent.set(target, file);
        if (isPredictFile(target)) {
          hit = { at: target, tail: null };
          break;
        }
        queue.push(target);
      }
    }
    if (!hit) continue;
    const chain = [];
    for (let at = hit.at; at !== null; at = parent.get(at) ?? null) chain.unshift(at);
    if (hit.tail) chain.push(hit.tail);
    violations.push({ file: start, chain });
  }
  return violations;
}
