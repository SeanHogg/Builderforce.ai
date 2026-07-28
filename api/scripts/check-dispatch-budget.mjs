/**
 * check-dispatch-budget — every autonomous BILLABLE RUN must be reserved before it starts.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ───────────────────────────────────────────────
 * `tickDispatchBudget.ts` states one rule, in bold, in its own header:
 *
 *     "Reserve-then-dispatch, never dispatch-then-count: a sweep must take the slot
 *      BEFORE starting work, or two sweeps racing on the same tenant both see room."
 *
 * The AI-manager sweep did the opposite for months. It checked `hasRoom` ONCE per project
 * as an admission gate, ran a whole pass, then replayed the spend afterwards — discarding
 * every `false` `tryReserve` returned, because by then the runs had happened. Separately,
 * the triage stage's `coordinate` remedy was the one branch of eight that consulted
 * neither `mayStartRun` nor `mayRaceExecutor`, and spent 7 billable runs against a cap of
 * 3 on a free-plan workspace.
 *
 * Both were invisible to review for the same reason: the rule lived in a comment, and the
 * cost of breaking it is a number on someone's bill weeks later. A rule that has to be
 * remembered at each of N dispatch sites gets forgotten at the N+1th, so it is checked
 * here instead.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────
 * In a BUDGET-HOLDING module (the sweeps and the manager pass), a call that can start a
 * billable run must be one of:
 *
 *   (a) inside a `.spend(...)` callback — the reserve-then-dispatch primitive;
 *   (b) guarded by a budget-ish condition (`mayStartRun`, `hasRoom()`, `budgetLeft`, …)
 *       in an enclosing `if` / ternary / `&&`, or by an EARLY RETURN on one earlier in
 *       the same block (`if (!args.mayStartRun) return nothing;`);
 *   (c) passing the decision DOWN explicitly (`dispatch:`, `mayStartRun:`, `force:`) so
 *       the callee is the one that honours it;
 *   (d) marked at the site with `// dispatch-budget: exempt — <reason>`, for a
 *       HUMAN-initiated dispatch, which the autonomous tick ceiling does not govern
 *       (the same rule that lets "Run now" override a breaker);
 *   (e) named in ALLOWLIST below, with a stated reason.
 *
 * This is deliberately syntactic. It cannot prove a budget is honoured — but every one of
 * the defects above was a dispatch site with NO budget reference anywhere near it, and
 * that is exactly what this catches.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Functions that can start a billable agent run. */
const DISPATCHERS = new Set([
  'maybeAutoRunOnLaneEntry',
  'dispatchCloudRunForTask',
  'driveOutstandingSignoffs',
  'coordinateTicket',
  'coordinateCompletedStage',
  'requestRoleRun',
]);

/**
 * Modules that HOLD a dispatch budget and therefore owe it. A leaf dispatcher that simply
 * accepts a flag from its caller (the lane trigger itself, the route handlers a human
 * clicks) is not in scope — the budget belongs to the autonomous caller, not to it.
 */
const BUDGET_HOLDING = [
  path.join('src', 'application', 'manager'),
  path.join('src', 'application', 'runtime', 'autonomousExecutionSweep.ts'),
];

/** Identifiers that make a condition count as a budget guard. */
const GUARD = /\b(mayStartRun|mayRaceExecutor|mayDispatch|hasRoom|budgetLeft|dispatchBudget|shouldDispatch|ownsDispatch|refused|canDispatch)\b/;
/** Argument properties that pass the decision down to the callee. */
const DELEGATES = /\b(dispatch|mayStartRun|mayRaceExecutor|force)\s*:/;

/**
 * Sites that legitimately dispatch without a local budget reference.
 * Every entry states WHY, because an unexplained allowlist entry is how a guard rots.
 */
const ALLOWLIST = new Map([
  [
    path.join('src', 'application', 'manager', 'coordinateTicket.ts'),
    'Takes an explicit `dispatch` flag and honours it at each site; the budget belongs to '
    + 'its callers (the manager pass, the triage remedy, the human-clicked route).',
  ],
]);

const sourceRoot = path.resolve('src');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(full);
  }
}
walk(sourceRoot);

const inScope = (file) => {
  const rel = path.relative(process.cwd(), file);
  return BUDGET_HOLDING.some((prefix) => rel === prefix || rel.startsWith(`${prefix}${path.sep}`) || rel === prefix);
};

const violations = [];
for (const filePath of files) {
  const rel = path.relative(process.cwd(), filePath);
  if (!inScope(filePath) || ALLOWLIST.has(rel)) continue;

  const sourceFile = ts.createSourceFile(
    filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );

  const text = sourceFile.getFullText();

  /** `// dispatch-budget: exempt — …` on or just above the call. */
  function isExempt(call) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile));
    const lines = text.split(/\r?\n/);
    for (let i = Math.max(0, line - 6); i <= line; i += 1) {
      if (/dispatch-budget:\s*exempt/.test(lines[i] ?? '')) return true;
    }
    return false;
  }

  /**
   * An EARLY-RETURN guard in the same block: `if (!args.mayStartRun) return nothing;`
   * before the statement that dispatches. This is the dominant shape in `applyRemedy`,
   * where each remedy branch refuses up front and then acts unconditionally.
   */
  function hasEarlyReturnGuard(block, stmt) {
    const index = block.statements.indexOf(stmt);
    if (index < 0) return false;
    for (let i = 0; i < index; i += 1) {
      const s = block.statements[i];
      if (!ts.isIfStatement(s) || s.elseStatement) continue;
      if (!GUARD.test(s.expression.getText(sourceFile))) continue;
      const branch = ts.isBlock(s.thenStatement) ? s.thenStatement.statements[0] : s.thenStatement;
      if (branch && (ts.isReturnStatement(branch) || ts.isBreakStatement(branch) || ts.isContinueStatement(branch) || ts.isThrowStatement(branch))) {
        return true;
      }
    }
    return false;
  }

  /** Is this call reserved, guarded, or delegating? Walks OUT from the call site. */
  function isAccountedFor(call) {
    if (DELEGATES.test(call.getText(sourceFile))) return true;
    if (isExempt(call)) return true;
    let node = call;
    let child = call;
    while (node.parent) {
      child = node;
      node = node.parent;
      if (ts.isBlock(node) && ts.isStatement(child) && hasEarlyReturnGuard(node, child)) return true;
      if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
        const clause = { statements: node.statements, };
        const index = node.statements.indexOf(child);
        if (index >= 0 && hasEarlyReturnGuard(clause, child)) return true;
      }
      // (a) inside a `.spend(fn, …)` callback — reserve-then-dispatch by construction.
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'spend'
      ) return true;
      // (b) guarded by a budget-ish condition.
      if (ts.isIfStatement(node) && GUARD.test(node.expression.getText(sourceFile))) return true;
      if (ts.isConditionalExpression(node) && node.condition !== child && GUARD.test(node.condition.getText(sourceFile))) return true;
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        && GUARD.test(node.left.getText(sourceFile))
      ) return true;
      // Stop at the enclosing function — a guard further out is too far to be meaningful.
      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) break;
    }
    return false;
  }

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression)
        ? node.expression.text
        : (ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null);
      if (callee && DISPATCHERS.has(callee) && !isAccountedFor(node)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push(
          `${rel}:${line + 1} ${callee}() starts a billable run with no reservation, budget guard, `
          + 'or delegated dispatch flag. Spend through a DispatchReserver (`runs.spend(...)`), '
          + 'guard on the budget, or pass the decision down.',
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

if (violations.length > 0) {
  console.error('Unreserved billable dispatches (reserve-then-dispatch, never dispatch-then-count):\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(`\n${violations.length} violation(s). See api/scripts/check-dispatch-budget.mjs for the rule.`);
  process.exit(1);
}
console.log(`check-dispatch-budget: OK (${files.filter(inScope).length} budget-holding files)`);
