/**
 * THE `system` HARNESS'S SANDBOX — an in-Worker, stubbed dry-run of a listing's
 * declared steps through the SAME executor real cloud workflows run through.
 *
 * ── WHY NOT A CONTAINER ───────────────────────────────────────────────────────
 * `executeCloudNode` (application/workflow/cloudExecutor.ts) already runs in the
 * Worker and already reaches everything a step needs. Porting it into a
 * container image would be a second implementation of the same executor — the
 * exact duplication this whole feature exists to avoid. With every outbound
 * step stubbed (`sandboxOutboundPort`), a dry-run is pure CPU and finishes in
 * milliseconds, so there is nothing here that benefits from process isolation.
 *
 * ── WHAT ACTUALLY GETS EXECUTED ───────────────────────────────────────────────
 * A snapshot's declared steps are a flat, unordered list — not the graph a real
 * workflow run compiles from (`domain/workflowGraph.ts`), which lives server-side
 * as a `workflow_definitions` row and is not itself part of what a buyer's copy
 * carries. So this cannot replay dependency order; it smoke-tests each step in
 * isolation, which still catches the failure that matters for a Stage check: a
 * malformed `transform` expression or `filter` predicate that would throw for
 * every buyer. Steps whose kind is `memory`/`knowledge`/`train`/`agent` are
 * skipped rather than run — those are valid on a self-hosted agentHost and
 * merely unsupported on the cloud runtime, which is a platform fact, not a
 * defect in the listing, so running them would produce a false failure.
 *
 * Only steps whose `kind` field is a real `WorkflowNodeKind` are recognized. A
 * listing whose steps never carry one (most `system`-harness kinds today do not
 * embed an executable graph in their portable content) executes nothing, and the
 * caller falls back to the existing static declaration — an honest degrade, not
 * a broken feature.
 */

import { executeCloudNode, type CloudExecutorEnv, type NodeInput, type OutboundPort } from '../workflow/cloudExecutor';
import { sandboxOutboundPort } from '../workflow/sandboxOutboundPort';
import type { StageCheck } from '@builderforce/creation-canvas-contract';

/** Node kinds the cloud runtime executes AND that a dry-run can safely run —
 *  outbound-capable kinds only ever run stubbed. `router`/`switch`/`assert` are
 *  pure expression/value evaluation exactly like `branch`/`filter`;
 *  `regex-match`/`html-to-text`/`html-table`/`html-elements`/`match-elements`/
 *  `match-pattern-advanced`/`replace`/`chunk-text`/`compose-string`/
 *  `convert-encoding` are pure string transforms. `merge` and the three
 *  `*-aggregator` kinds/`set-variable(s)`/`get-variable(s)`/`increment`/
 *  `sleep`/`healthcheck` are deliberately excluded: they need the raw
 *  per-dependency `depOutputs` this simple step harness never populates, a
 *  real tenant `usageCtx` (DB-backed variable state), or reach the network
 *  (`healthcheck`) — none of which this stubbed harness provides — they're
 *  skipped exactly like `memory`/`knowledge`/`train`/`agent` above. */
const EXECUTABLE_KINDS: ReadonlySet<string> = new Set([
  'trigger', 'llm', 'mcp', 'connector', 'gmail', 'web-search', 'transform', 'filter', 'branch', 'output',
  'router', 'switch', 'assert', 'regex-match', 'html-to-text', 'html-table', 'html-elements',
  'match-elements', 'match-pattern-advanced', 'replace', 'chunk-text', 'compose-string', 'convert-encoding',
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function rows(value: unknown): ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    : [];
}

function stepConfig(step: Record<string, unknown>): Record<string, unknown> {
  const cfg = step.config;
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : step;
}

function errMsg(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

function check(severity: StageCheck['severity'], label: string, detail?: string): StageCheck {
  return detail
    ? { code: 'system.outbound', group: 'runs', severity, label, detail }
    : { code: 'system.outbound', group: 'runs', severity, label };
}

/**
 * Dry-run every recognizable step across a snapshot's objects. Returns `[]`
 * when nothing recognizable was found — the caller's signal to keep the
 * existing static declaration rather than replace it with a false "nothing
 * configured".
 */
export async function dryRunSystemSteps(
  env: CloudExecutorEnv,
  objects: readonly { canvasData: unknown; content: unknown }[],
  outbound: OutboundPort = sandboxOutboundPort(),
): Promise<StageCheck[]> {
  const steps = objects.flatMap((object) => rows({ ...record(object.content), ...record(object.canvasData) }.steps));
  const runnable = steps.filter((step) => EXECUTABLE_KINDS.has(String(step.kind ?? '').trim().toLowerCase()));
  if (!runnable.length) return [];

  let executed = 0;
  const failures: string[] = [];
  for (const step of runnable) {
    const node: NodeInput = { kind: String(step.kind).trim().toLowerCase(), config: stepConfig(step) };
    try {
      await executeCloudNode(env, node, '', undefined, outbound);
      executed++;
    } catch (error) {
      failures.push(`${node.kind}: ${errMsg(error)}`);
    }
  }

  if (failures.length) {
    return [check(
      'block', `${failures.length} of ${runnable.length} step(s) failed a stubbed dry run`,
      failures.slice(0, 3).join('; '),
    )];
  }
  return [check(
    'pass', `${executed} outbound-capable step${executed === 1 ? '' : 's'} ran in a stubbed dry run`,
    'Every outbound call was captured and dropped rather than fired; buyers connect their own accounts on first run.',
  )];
}
