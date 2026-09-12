/**
 * Helpers shared by more than one node family. Each existed as 2–4 inline copies
 * inside the old `executeCloudNode` switch.
 */
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import {
  contextFromInput, referencesRunVariables, withRunVariables, type ExprContext,
} from '../../../domain/workflowExpr';
import { listWorkflowVariables } from '../workflowVariables';
import type { NodeInput, NodeResult, UsageContext } from './types';

const SOURCE = 'application/workflow/nodes/helpers.ts';

/** Substitute `{{input}}` (and `{{ input }}`) in a template with the upstream text. */
export function renderTemplate(template: string, input: string): string {
  return template.replace(/\{\{\s*input\s*\}\}/g, input);
}

/**
 * The context an author-written expression is evaluated against: the upstream
 * payload, plus — when one of the node's expressions names `$vars` — every run
 * variable an earlier step published. That is what lets a declared DATA IN read
 * a value three steps back without re-threading it through every step between.
 * Loaded on demand only, so a node that never mentions a variable pays nothing.
 */
export async function expressionContext(
  inputText: string,
  usageCtx: UsageContext | undefined,
  expressions: readonly unknown[],
): Promise<ExprContext> {
  const ctx = contextFromInput(inputText);
  if (!usageCtx || !referencesRunVariables(expressions)) return ctx;
  const variables = await listWorkflowVariables(usageCtx.db, usageCtx.tenantId, 'run', usageCtx.workflowId);
  return withRunVariables(ctx, variables);
}

/**
 * Merge `tag` into a JSON-object payload (`$branch`, `$route`, `$assert`). A
 * payload that is not a JSON object passes through unchanged — the drain loop and
 * any downstream `$branch`/`$route` reader then simply see no tag.
 */
export function tagPayload(inputText: string, tag: Record<string, unknown>): NodeResult {
  try {
    const parsed = JSON.parse(inputText || '{}') as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { output: JSON.stringify({ ...parsed, ...tag }) };
    }
  } catch (error) {
    /* non-JSON payload — fall through to passthrough */
    reportCaughtError(error, { source: SOURCE, operation: 'executeCloudNode' });
  }
  return { output: inputText };
}

/**
 * A config field authored either as an array or as a JSON string (the config
 * panel's convention for `routes`, `cases`, …). A malformed/empty value degrades
 * to `[]` rather than throwing.
 */
export function configArray<T>(value: unknown, operation: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed as T[];
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation, level: 'warning' });
    }
  }
  return [];
}

/**
 * The raw per-dependency outputs a fan-in node reduces (`merge` and the
 * `*-aggregator` kinds) — `advanceCloudWorkflow` populates `node.depOutputs`, so a
 * fan-in knows where one branch's output ends and the next begins. Without it
 * (a direct call), the joined input is the single part.
 */
export function fanInParts(node: NodeInput, inputText: string): string[] {
  return node.depOutputs ?? (inputText ? [inputText] : []);
}
