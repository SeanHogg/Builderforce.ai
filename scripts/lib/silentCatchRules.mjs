/**
 * The rules that decide whether a caught error goes anywhere.
 *
 * This module owns ONE thing: given a parsed source file, which nodes swallow an
 * error. It knows nothing about packages, baselines, or the exit code — those are
 * `../check-silent-catches.mjs`'s question — so the same three rules can be
 * pointed at any source tree in the repository rather than copied per package.
 */

/** Stable ids, used as the baseline's per-rule keys. Renaming one resets its ratchet. */
export const RULES = /** @type {const} */ ([
  'empty-catch',
  'empty-promise-catch',
  'console-only',
  'durable-object-direct-report',
]);

/** Human-readable text for each rule id, shown once per failing rule. */
export const RULE_DESCRIPTIONS = {
  'empty-catch': 'catch clause with an empty body — the error reaches it and stops',
  'empty-promise-catch': 'empty `.catch(() => {})` callback — the rejection is discarded',
  'console-only': 'caught error is written to the console only, never to a durable store',
  'durable-object-direct-report':
    'a Durable Object must report through `createDurableErrorReporter`; a bare '
    + '`reportCaughtError` resolves no runtime there and is dropped after its console line',
};

/**
 * @typedef {object} Violation
 * @property {typeof RULES[number]} rule
 * @property {string} file  Repo-relative, POSIX-separated.
 * @property {number} line  1-indexed.
 */

/**
 * @param {import('typescript')} ts
 * @param {import('typescript').SourceFile} sourceFile
 * @param {string} relativePath Repo-relative, POSIX-separated — used in output and rule scoping.
 * @param {(rule: typeof RULES[number], relativePath: string) => boolean} [isExempt]
 * @returns {Violation[]}
 */
export function findSilentCatches(ts, sourceFile, relativePath, isExempt) {
  /** @type {Violation[]} */
  const violations = [];
  const exempt = (rule) => isExempt?.(rule, relativePath) === true;

  const at = (node) => ({
    file: relativePath,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  });

  /** `.catch(<callback>)` — the promise form of a catch clause. */
  const promiseCatchCallback = (node) => {
    if (!ts.isCallExpression(node)) return null;
    if (!ts.isPropertyAccessExpression(node.expression)) return null;
    if (node.expression.name.text !== 'catch') return null;
    return node.arguments[0] ?? null;
  };

  function visit(node) {
    if (!exempt('empty-catch') && ts.isCatchClause(node) && node.block.statements.length === 0) {
      violations.push({ rule: 'empty-catch', ...at(node) });
    }

    if (!exempt('empty-promise-catch')) {
      const callback = promiseCatchCallback(node);
      if (
        callback
        && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
        && ts.isBlock(callback.body)
        && callback.body.statements.length === 0
      ) {
        violations.push({ rule: 'empty-promise-catch', ...at(node) });
      }
    }

    if (
      !exempt('console-only')
      && ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(sourceFile) === 'console'
      && (node.expression.name.text === 'error' || node.expression.name.text === 'warn')
    ) {
      for (let current = node.parent; current; current = current.parent) {
        const inPromiseCatch = (ts.isArrowFunction(current) || ts.isFunctionExpression(current))
          && promiseCatchCallback(current.parent) === current;
        if (ts.isCatchClause(current) || inPromiseCatch) {
          violations.push({ rule: 'console-only', ...at(node) });
          break;
        }
      }
    }

    if (
      !exempt('durable-object-direct-report')
      && /DO\.ts$/.test(relativePath)
      && ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'reportCaughtError'
    ) {
      violations.push({ rule: 'durable-object-direct-report', ...at(node) });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}
