/**
 * Workflow graph contract + compiler — the single source of truth for the
 * IPAAS-style agentic workflow builder.
 *
 * A `WorkflowDefinition` is the design-time graph the builder canvas serializes
 * to. `compileDefinition()` lowers that graph into an ordered list of steps that
 * is isomorphic to BuilderForce Agents's orchestrator `WorkflowStep[]` — node kinds map to
 * agent roles (agent nodes) or reserved node-handler roles (memory / knowledge /
 * train / etc.), and edges become `dependsOn` relationships.
 *
 * The frontend mirrors these types in `lib/builderforceApi.ts` (this repo has no
 * shared package; `Workflow`/`WorkflowTask` are duplicated the same way). Keep
 * the two in sync.
 */

import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

/** Every node kind the builder palette can place on the canvas. */
export type WorkflowNodeKind =
  | 'trigger'    // entry point: manual / webhook / schedule / board-event / data-collection
  | 'agent'      // run a configured agent (role + runtime + model)
  | 'llm'        // call an LLM platform (OpenAI/Anthropic/Gemini/…) via the gateway
  | 'mcp'        // invoke an MCP-server / SaaS integration tool
  | 'memory'     // read/write the SSM hippocampus memory
  | 'knowledge'  // ingest into / query a knowledge base
  | 'train'      // train an Evermind model (builderforce-memory engine) → hippocampus model
  | 'transform'  // ETL: map/shape the payload
  | 'filter'     // ETL: drop the payload unless a predicate holds
  | 'branch'     // ETL: conditional fan-out
  | 'output';    // terminal: write artifact / notify / push to board

/** Reserved orchestrator roles for non-agent (in-process) node handlers.
 *  Agent nodes use their configured role instead. Kept here so the builder, the
 *  compiler, and the orchestrator's executeTask switch agree on one vocabulary. */
export const NODE_HANDLER_ROLES: Record<Exclude<WorkflowNodeKind, 'agent'>, string> = {
  trigger:   'node:trigger',
  llm:       'node:llm',
  mcp:       'node:mcp',
  memory:    'node:memory',
  knowledge: 'node:knowledge',
  train:     'node:train',
  transform: 'node:transform',
  filter:    'node:filter',
  branch:    'node:branch',
  output:    'node:output',
};

export interface WorkflowDefNode {
  id: string;
  kind: WorkflowNodeKind;
  label: string;
  position: { x: number; y: number };
  /** Free-form per-kind parameters (e.g. agent role, memory op, KB namespace). */
  config: Record<string, unknown>;
}

export interface WorkflowDefEdge {
  id: string;
  source: string;   // source node id
  target: string;   // target node id
}

export interface WorkflowDefinition {
  nodes: WorkflowDefNode[];
  edges: WorkflowDefEdge[];
}

/** One compiled step — isomorphic to an orchestrator `WorkflowStep` plus the
 *  node metadata the LLM-node handlers need at execution time. */
export interface CompiledStep {
  nodeId: string;
  kind: WorkflowNodeKind;
  role: string;                 // orchestrator agentRole
  description: string;          // task text
  config: Record<string, unknown>;
  dependsOnNodeIds: string[];   // upstream node ids (resolved from edges)
}

export const EMPTY_DEFINITION: WorkflowDefinition = { nodes: [], edges: [] };

// ---------------------------------------------------------------------------
// YAML interchange — round-trip a definition to/from a human-authorable YAML
// form, isomorphic to the on-disk `.coderClaw/workflows/*.yaml` convention.
// ---------------------------------------------------------------------------

/** Serialize a definition to YAML for export / hand-editing. */
export function definitionToYaml(def: WorkflowDefinition): string {
  return yamlStringify({
    nodes: def.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      position: n.position,
      config: n.config ?? {},
    })),
    edges: def.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  });
}

/**
 * Parse a YAML (or JSON) workflow document into a normalized definition,
 * tolerating hand-authored input: nodes may omit ids/positions/config and edges
 * may omit ids — these are synthesized so the result is always runnable.
 */
export function yamlToDefinition(text: string): WorkflowDefinition {
  const raw = yamlParse(text) as { nodes?: unknown[]; edges?: unknown[] } | null;
  const nodesIn = Array.isArray(raw?.nodes) ? raw!.nodes : [];
  const edgesIn = Array.isArray(raw?.edges) ? raw!.edges : [];

  const nodes: WorkflowDefNode[] = nodesIn.map((n, i) => {
    const o = (n ?? {}) as Record<string, unknown>;
    const pos = (o.position ?? {}) as { x?: unknown; y?: unknown };
    return {
      id: typeof o.id === 'string' && o.id ? o.id : `n${i + 1}`,
      kind: (o.kind as WorkflowNodeKind) ?? 'agent',
      label: typeof o.label === 'string' ? o.label : String(o.kind ?? `node ${i + 1}`),
      position: { x: Number(pos.x ?? (i % 4) * 200), y: Number(pos.y ?? Math.floor(i / 4) * 120) },
      config: (o.config && typeof o.config === 'object' ? o.config : {}) as Record<string, unknown>,
    };
  });

  const edges: WorkflowDefEdge[] = edgesIn.map((e, i) => {
    const o = (e ?? {}) as Record<string, unknown>;
    return {
      id: typeof o.id === 'string' && o.id ? o.id : `e${i + 1}`,
      source: String(o.source ?? ''),
      target: String(o.target ?? ''),
    };
  }).filter((e) => e.source && e.target);

  return { nodes, edges };
}

/** Parse a stored definition string defensively; returns an empty graph on any
 *  malformed/legacy value so callers never have to null-check. */
export function parseDefinition(raw: string | null | undefined): WorkflowDefinition {
  if (!raw) return { nodes: [], edges: [] };
  try {
    const v = JSON.parse(raw) as Partial<WorkflowDefinition>;
    return {
      nodes: Array.isArray(v.nodes) ? (v.nodes as WorkflowDefNode[]) : [],
      edges: Array.isArray(v.edges) ? (v.edges as WorkflowDefEdge[]) : [],
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

/** Resolve the orchestrator role a node compiles to. */
export function roleForNode(node: WorkflowDefNode): string {
  if (node.kind === 'agent') {
    return String(node.config.role ?? node.config.agentRole ?? 'code-creator');
  }
  // Client-side Evermind BUILD-step kinds (train-tokenizer, train-model, …) are a
  // frontend-only superset run in-browser via the engine, never dispatched here.
  // If one is ever server-run, fall back to a benign role rather than undefined.
  return NODE_HANDLER_ROLES[node.kind] ?? `node:${node.kind}`;
}

/** Human/agent-readable task text for a node, derived from its config. */
export function taskTextForNode(node: WorkflowDefNode): string {
  const c = node.config ?? {};
  switch (node.kind) {
    case 'agent':
      return String(c.task ?? c.prompt ?? node.label ?? 'Run agent');
    case 'llm':
      return `LLM ${String(c.provider ?? 'openai')}${c.model ? `/${String(c.model)}` : ''}: ${String(c.prompt ?? node.label)}`;
    case 'mcp':
      return `${String(c.integration ?? node.label)} → ${String(c.operation ?? 'call')}`;
    case 'memory':
      return `Memory ${String(c.op ?? 'recall')}: ${String(c.query ?? c.key ?? node.label)}`;
    case 'knowledge':
      return `Knowledge ${String(c.op ?? 'query')}: ${String(c.query ?? c.source ?? node.label)}`;
    case 'train':
      return `Train model "${String(c.model ?? node.label)}" on ${String(c.dataset ?? 'configured dataset')}`;
    case 'transform':
      return `Transform: ${String(c.expression ?? node.label)}`;
    case 'filter':
      return `Filter: ${String(c.predicate ?? node.label)}`;
    case 'branch':
      return `Branch on: ${String(c.condition ?? node.label)}`;
    case 'trigger':
      return `Trigger (${String(c.triggerType ?? 'manual')})`;
    case 'output':
      return `Output: ${String(c.target ?? node.label)}`;
    default:
      return node.label ?? node.kind;
  }
}

/**
 * Validate a definition. Returns an error string, or null when valid.
 * Catches the failure modes the orchestrator can't recover from: dangling edges
 * and dependency cycles (the executor would deadlock on a cycle).
 */
export function validateDefinition(def: WorkflowDefinition): string | null {
  const ids = new Set(def.nodes.map((n) => n.id));
  if (def.nodes.length === 0) return 'Workflow has no nodes.';

  for (const e of def.edges) {
    if (!ids.has(e.source)) return `Edge ${e.id} references unknown source node ${e.source}.`;
    if (!ids.has(e.target)) return `Edge ${e.id} references unknown target node ${e.target}.`;
  }

  // Kahn's algorithm — if any node never reaches in-degree 0, there's a cycle.
  const inDeg = new Map<string, number>(def.nodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>(def.nodes.map((n) => [n.id, []]));
  for (const e of def.edges) {
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    out.get(e.source)?.push(e.target);
  }
  const queue = [...inDeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const nxt of out.get(id) ?? []) {
      const d = (inDeg.get(nxt) ?? 1) - 1;
      inDeg.set(nxt, d);
      if (d === 0) queue.push(nxt);
    }
  }
  if (visited !== def.nodes.length) return 'Workflow graph contains a cycle.';

  return null;
}

/**
 * Lower a definition graph into ordered compiled steps. The order is a
 * topological sort so downstream consumers (the API run endpoint, the
 * orchestrator) can instantiate tasks with their dependencies already emitted.
 */
export function compileDefinition(def: WorkflowDefinition): CompiledStep[] {
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, string[]>(def.nodes.map((n) => [n.id, []]));
  for (const e of def.edges) {
    if (incoming.has(e.target) && byId.has(e.source)) incoming.get(e.target)!.push(e.source);
  }

  // Topological order via Kahn's; falls back to declaration order for any
  // residual nodes (validateDefinition rejects true cycles upstream).
  const inDeg = new Map<string, number>(def.nodes.map((n) => [n.id, incoming.get(n.id)!.length]));
  const out = new Map<string, string[]>(def.nodes.map((n) => [n.id, []]));
  for (const e of def.edges) out.get(e.source)?.push(e.target);
  const queue = [...inDeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const ordered: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(id);
    for (const nxt of out.get(id) ?? []) {
      const d = (inDeg.get(nxt) ?? 1) - 1;
      inDeg.set(nxt, d);
      if (d === 0) queue.push(nxt);
    }
  }
  for (const n of def.nodes) if (!ordered.includes(n.id)) ordered.push(n.id);

  return ordered.map((id) => {
    const node = byId.get(id)!;
    return {
      nodeId: node.id,
      kind: node.kind,
      role: roleForNode(node),
      description: taskTextForNode(node),
      config: node.config ?? {},
      dependsOnNodeIds: incoming.get(node.id) ?? [],
    } satisfies CompiledStep;
  });
}
