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
  'routeLaneEntry', // the one door into a lane; `maybeAutoRunOnLaneEntry` behind it is router-only (see SINGLE_DOOR below)
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

/**
 * Identifiers that make a condition a BUDGET guard.
 *
 * Deliberately NOT `shouldDispatch` / `ownsDispatch`. Those express dispatch OWNERSHIP —
 * "the autonomous executor is the single dispatcher on the cron path" — which is a
 * different ceiling answering a different question. Accepting them here made the check
 * pass on an unreserved stage-5 dispatch, because the whole stage sits inside
 * `if (shouldDispatch) { … }`. A guard that accepts the wrong kind of guard is worse than
 * no guard: it certifies the thing it was written to catch.
 */
const GUARD = /\b(mayStartRun|mayRaceExecutor|mayDispatch|hasRoom|budgetLeft|dispatchBudget|canDispatch|refused)\b/;
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

/**
 * SINGLE DOOR: `routeLaneEntry` decides which engine runs a lane (the manager for a managed
 * board, the SwimlaneCoordinator for a staged lane, else the one-agent trigger). The one-agent
 * trigger `maybeAutoRunOnLaneEntry` is exported for the router and its own tests only; a
 * production module importing it is a second door that bypasses the coordinator.
 */
const SINGLE_DOOR_IMPORT = 'maybeAutoRunOnLaneEntry';
const SINGLE_DOOR_MODULE = 'laneEntryTrigger';
const SINGLE_DOOR_OWNER = path.join('src', 'application', 'swimlane', 'laneEntryTrigger.ts');

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
  const source = fs.readFileSync(filePath, 'utf8');
  if (rel !== SINGLE_DOOR_OWNER && (source.includes(SINGLE_DOOR_IMPORT) || source.includes(SINGLE_DOOR_MODULE))) {
    const probe = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const flag = (node, how) => {
      const { line } = probe.getLineAndCharacterOfPosition(node.getStart(probe));
      violations.push(
        `${rel}:${line + 1} ${how} ${SINGLE_DOOR_IMPORT}: enter a lane through routeLaneEntry (laneEntryTrigger.ts), `
        + 'which picks the manager / coordinator / one-agent engine. Omit onManagedBoard from inside the manager.',
      );
    };
    const namesDoor = (specifiers) => specifiers.some((e) => (e.propertyName ?? e.name).text === SINGLE_DOOR_IMPORT);
    const isDoorModule = (spec) => spec && ts.isStringLiteralLike(spec) && /(^|\/)laneEntryTrigger(\.[a-z]+)?$/.test(spec.text);
    const scan = (node) => {
      // import { maybeAutoRunOnLaneEntry } from '…'
      if (ts.isImportDeclaration(node)) {
        const named = node.importClause?.namedBindings;
        if (named && ts.isNamedImports(named) && namesDoor(named.elements)) flag(node, 'imports');
      }
      // export { maybeAutoRunOnLaneEntry } from '…'  (a re-export is a second door in one hop)
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)
        && namesDoor(node.exportClause.elements)) flag(node, 're-exports');
      // import('…/laneEntryTrigger') - a dynamic import hands back the whole module, so the door comes with it.
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && isDoorModule(node.arguments[0])) {
        flag(node, 'dynamically imports the module that exports');
      }
      ts.forEachChild(node, scan);
    };
    scan(probe);
  }
  if (!inScope(filePath) || ALLOWLIST.has(rel)) continue;

  const sourceFile = ts.createSourceFile(
    filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
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
