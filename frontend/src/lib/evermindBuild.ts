/**
 * evermindBuild.ts — bridge the visual Workflow Builder to the builderforce-memory
 * engine's Evermind BUILD-step runner.
 *
 * The builder canvas authors a node/edge graph. When those nodes are Evermind
 * build steps (`train-tokenizer`, `train-model`, `roundtrip`, …), each `kind`
 * equals an engine workflow step `type`, so the graph compiles 1:1 to an engine
 * `WorkflowConfig` and runs ENTIRELY IN-BROWSER via `runWorkflow` (pure CPU — same
 * pattern as `evermind-benchmark.ts`; no WebGPU, no network unless a `distill-corpus`
 * step configures live teachers). The run yields an execution-output timeline and,
 * for a build workflow, a packaged `.evermind` artifact in `result.artifacts`.
 *
 * The heavy runtime is dynamically imported so it only loads when a build actually
 * runs (or a template loads).
 */

import type {
  WorkflowConfig,
  WorkflowStepConfig,
  StackDiagnosticResult,
  StackStepResult,
} from '@seanhogg/builderforce-memory';
import type { WorkflowDefinitionGraph, EvermindBuildKind, WorkflowNodeKind } from './builderforceApi';

export type { StackDiagnosticResult, StackStepResult, WorkflowConfig };

/** The engine build-step kinds the palette exposes (each === an engine step `type`). */
export const EVERMIND_BUILD_KINDS: readonly EvermindBuildKind[] = [
  'train-tokenizer', 'dataset-quality', 'train-model', 'convergence',
  'evaluate', 'generate-check', 'benchmark', 'roundtrip', 'export',
  'distill-corpus', 'code-parse-check', 'code-eval', 'code-benchmark',
];
const BUILD_KIND_SET = new Set<string>(EVERMIND_BUILD_KINDS);

export function isBuildKind(kind: string): kind is EvermindBuildKind {
  return BUILD_KIND_SET.has(kind);
}

/** Whether a graph carries any Evermind build node (⇒ the in-browser Build path applies). */
export function hasBuildNodes(nodes: { kind: WorkflowNodeKind }[]): boolean {
  return nodes.some((n) => isBuildKind(n.kind));
}

/** Config keys whose textarea value is JSON that must be parsed into the step param. */
const JSON_PARAM_KEYS: Record<string, string[]> = {
  'distill-corpus': ['pairs', 'teachers', 'tasks'],
  'code-eval': ['cases'],
  'code-benchmark': ['tasks'],
};

/** Turn a node's UI config into engine step params: parse JSON fields, drop blanks. */
function toParams(kind: string, config: Record<string, unknown>): Record<string, unknown> {
  const jsonKeys = new Set(JSON_PARAM_KEYS[kind] ?? []);
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (v === '' || v == null) continue; // let the engine default kick in
    if (jsonKeys.has(k) && typeof v === 'string') {
      try {
        params[k] = JSON.parse(v);
      } catch {
        // leave the raw string out rather than pass malformed JSON to the engine
      }
      continue;
    }
    params[k] = v;
  }
  return params;
}

export interface CompileResult {
  config: WorkflowConfig | null;
  /** Human-readable reason the graph couldn't compile (no build nodes, etc.). */
  error?: string;
}

/**
 * Compile the build-step subgraph into an engine `WorkflowConfig`. Non-build nodes
 * (trigger/agent/mcp/…) are ignored — a build run only cares about the pipeline.
 * Steps run sequentially and thread state via the engine's `ctx.bag`, so ORDER
 * matters: we topologically sort by the wired edges (Kahn's), appending any
 * un-wired build nodes in canvas order.
 */
export function compileBuildGraph(graph: WorkflowDefinitionGraph, name = 'Evermind build'): CompileResult {
  const buildNodes = graph.nodes.filter((n) => isBuildKind(n.kind));
  if (buildNodes.length === 0) {
    return { config: null, error: 'no-build-nodes' };
  }
  const ids = new Set(buildNodes.map((n) => n.id));
  // Edges restricted to the build subgraph.
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));

  const inDeg = new Map<string, number>(buildNodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>(buildNodes.map((n) => [n.id, []]));
  for (const e of edges) {
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    out.get(e.source)?.push(e.target);
  }
  // Seed the queue in canvas order so an un-wired chain keeps its authored order.
  const queue = buildNodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const ordered: string[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
    for (const nxt of out.get(id) ?? []) {
      const d = (inDeg.get(nxt) ?? 1) - 1;
      inDeg.set(nxt, d);
      if (d === 0) queue.push(nxt);
    }
  }
  // Any residual (part of a cycle) — append in canvas order so nothing is dropped.
  for (const n of buildNodes) if (!seen.has(n.id)) ordered.push(n.id);

  const byId = new Map(buildNodes.map((n) => [n.id, n]));
  const steps: WorkflowStepConfig[] = ordered.map((id) => {
    const n = byId.get(id)!;
    return { id: n.id, type: n.kind, label: n.label, params: toParams(n.kind, n.config ?? {}) };
  });

  return { config: { id: `build-${Date.now()}`, name, steps } };
}

/**
 * Run a compiled build config in-browser via the engine. Streams each step's
 * result through `onStep` for a live timeline. Never throws for a failing step —
 * the engine records it as a `fail` row and continues (see `runStackDiagnostic`).
 */
export async function runBuildWorkflow(
  config: WorkflowConfig,
  onStep?: (r: StackStepResult) => void,
): Promise<StackDiagnosticResult> {
  const engine = await import('@seanhogg/builderforce-memory');
  // Yield once so the caller's "running" UI paints before the synchronous CPU work.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return engine.runWorkflow(config, onStep ? { onStep } : {});
}

/** The one-click Evermind build templates surfaced in the builder. */
export interface EvermindBuildTemplateMeta {
  /** Engine template id passed to `cloneTemplate`. */
  id: 'train-llm' | 'teach-code';
  /** i18n key suffix under the `evermindBuild` namespace for the display name. */
  nameKey: string;
}

export const EVERMIND_BUILD_TEMPLATES: EvermindBuildTemplateMeta[] = [
  { id: 'train-llm', nameKey: 'templateTrainLlm' },
  { id: 'teach-code', nameKey: 'templateTeachCode' },
];

/** A builder-shaped node (matches BuilderNodeData + React Flow position). */
export interface BuiltGraphNode {
  id: string;
  kind: WorkflowNodeKind;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}
export interface BuiltGraph {
  nodes: BuiltGraphNode[];
  edges: { id: string; source: string; target: string }[];
}

/** Stringify object/array params back to the textarea form the config panel edits. */
function paramToConfigValue(v: unknown): unknown {
  return typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : v;
}

/**
 * Materialize an engine build template into a builder graph: each step becomes a
 * node in a wired vertical chain the user can edit, then run with "▶ Build". The
 * heavy runtime is dynamically imported (templates + `cloneTemplate` live there).
 */
export async function loadTemplateGraph(templateId: 'train-llm' | 'teach-code'): Promise<BuiltGraph> {
  const engine = await import('@seanhogg/builderforce-memory');
  const cfg = engine.cloneTemplate(templateId);
  if (!cfg) return { nodes: [], edges: [] };

  const nodes: BuiltGraphNode[] = cfg.steps.map((s, i) => ({
    id: crypto.randomUUID(),
    kind: s.type as WorkflowNodeKind,
    label: s.label ?? s.type,
    position: { x: 240, y: 60 + i * 96 },
    config: Object.fromEntries(
      Object.entries(s.params ?? {}).map(([k, v]) => [k, paramToConfigValue(v)]),
    ),
  }));
  const edges = nodes.slice(1).map((n, i) => ({
    id: crypto.randomUUID(),
    source: nodes[i].id,
    target: n.id,
  }));
  return { nodes, edges };
}

/** Base64-encode the packaged `.evermind` artifact for the seed endpoint. */
export function evermindArtifactToBase64(artifact: unknown): string | null {
  let bytes: Uint8Array | null = null;
  if (artifact instanceof Uint8Array) bytes = artifact;
  else if (artifact instanceof ArrayBuffer) bytes = new Uint8Array(artifact);
  else if (ArrayBuffer.isView(artifact)) bytes = new Uint8Array(artifact.buffer);
  if (!bytes) return null;
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
