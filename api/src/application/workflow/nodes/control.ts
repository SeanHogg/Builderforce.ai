/**
 * Flow-control node handlers — the kinds that decide WHERE a payload goes (or
 * whether the run may continue) rather than what it becomes: `trigger`,
 * `branch`, `router`, `switch`, `iterator`, `subflow`, `sleep`, `output`,
 * `assert`.
 *
 * `branch`/`router`/`switch` tag the payload (`$branch` / `$route`). The tag is
 * read TWICE: by any downstream node that wants it in its expressions, and by the
 * drain loop in `../cloudExecutor.ts`, which prunes an arm whose labeled edge
 * does not match it (`prunedByEdgeLabel`). An unlabeled graph still runs every
 * side, exactly as before.
 */
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { contextFromInput, evaluateBool } from '../../../domain/workflowExpr';
import { configArray, expressionContext, tagPayload } from './helpers';
import type { NodeHandlerTable } from './types';

/** The configured fallback route (trimmed), else `'none'`. Shared by `router`/`switch`. */
function fallbackRoute(config: Record<string, unknown>): string {
  return typeof config.fallback === 'string' && config.fallback.trim() ? config.fallback.trim() : 'none';
}

export const CONTROL_NODE_HANDLERS: NodeHandlerTable = {
  trigger: ({ node, inputText }) =>
    ({ output: node.payload !== undefined ? JSON.stringify(node.payload) : inputText }),

  branch: async ({ node, inputText, usageCtx }) => {
    const condition = typeof node.config.condition === 'string' ? node.config.condition : '';
    const ctx = await expressionContext(inputText, usageCtx, [condition]);
    const taken = condition ? evaluateBool(condition, ctx) : true;
    return tagPayload(inputText, { $branch: taken });
  },

  router: async ({ node, inputText, usageCtx }) => {
    // `branch`'s tag generalized to N named routes: the first route (in declared
    // order) whose condition holds (or which has no condition) wins; an unmatched
    // payload takes `fallback`.
    const ctx = await expressionContext(inputText, usageCtx, [node.config.routes]);
    const routes = configArray<{ name?: unknown; condition?: unknown }>(node.config.routes, 'router.parseRoutes');
    let taken: string | null = null;
    for (const r of routes) {
      const name = typeof r?.name === 'string' ? r.name.trim() : '';
      if (!name) continue;
      const condition = typeof r?.condition === 'string' ? r.condition : '';
      if (!condition || evaluateBool(condition, ctx)) { taken = name; break; }
    }
    return tagPayload(inputText, { $route: taken ?? fallbackRoute(node.config) });
  },

  switch: ({ node, inputText }) => {
    // Like `router`, but matches a VALUE against literal cases rather than
    // evaluating a boolean expression per route — Make's Switch module.
    // `field` names a top-level property of the JSON payload to read; empty
    // means match against the whole (trimmed) input text instead.
    const ctx = contextFromInput(inputText);
    const field = typeof node.config.field === 'string' ? node.config.field.trim() : '';
    const actual = field ? String((ctx as Record<string, unknown>)[field] ?? '') : inputText.trim();
    const cases = configArray<{ match?: unknown; name?: unknown }>(node.config.cases, 'switch.parseCases');
    let taken: string | null = null;
    for (const c of cases) {
      if (String(c?.match ?? '') === actual) { taken = typeof c?.name === 'string' && c.name ? c.name : actual; break; }
    }
    return tagPayload(inputText, { $route: taken ?? fallbackRoute(node.config) });
  },

  iterator: ({ inputText }) => {
    // Validates the shape and hands the array back unchanged — the actual
    // per-item fan-out happens in `advanceCloudWorkflow` the moment THIS
    // task is recorded `completed`, via `planIteratorExpansion`.
    let parsed: unknown;
    try {
      parsed = JSON.parse(inputText);
    } catch (error) {
      reportCaughtError(error, { source: 'application/workflow/nodes/control.ts', operation: 'iterator.parseInput', level: 'warning' });
      parsed = null;
    }
    const items = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items))
        ? (parsed as { items: unknown[] }).items
        : null;
    if (!items) throw new Error('Iterator needs an array (or {"items":[...]}) as its input');
    return { output: JSON.stringify(items) };
  },

  // A nested canvas is EXPANDED when the run is instantiated (`expandSubflows.ts`),
  // so a node of this kind reaching the executor was never expanded — a definition
  // compiled by a path that does not know about composition. Fail loudly: a
  // pass-through here would report success for a whole canvas nobody ran.
  subflow: ({ node }) => {
    throw new Error(
      `Nested canvas "${String(node.config.canvas ?? node.config.definitionId ?? '')}" was not resolved before the run started, so it cannot run.`,
    );
  },

  // The delay itself is enforced by advanceCloudWorkflow's `not_before` gate
  // before this handler ever runs — by the time we get here, it's due.
  sleep: ({ inputText }) => ({ output: inputText }),

  output: ({ inputText }) => ({ output: inputText }),

  assert: async ({ node, inputText, usageCtx }) => {
    const expression = typeof node.config.expression === 'string' ? node.config.expression : '';
    const ctx = await expressionContext(inputText, usageCtx, [expression]);
    const onFail = node.config.onFail === 'warn-only' ? 'warn-only' : 'fail-task';
    const holds = evaluateBool(expression, ctx);
    if (!holds && onFail === 'fail-task') throw new Error(`Assertion failed: ${expression || '(empty expression)'}`);
    return tagPayload(inputText, { $assert: holds });
  },
};
