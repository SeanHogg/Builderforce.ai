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
  | 'connector'  // call one action on a connected integration (Twilio, Stripe, Slack…)
  | 'memory'     // read/write the SSM hippocampus memory
  | 'knowledge'  // ingest into / query a knowledge base
  | 'train'      // train an Evermind model (builderforce-memory engine) → hippocampus model
  | 'transform'  // ETL: map/shape the payload
  | 'filter'     // Flow Control: drop the payload unless a predicate holds
  | 'branch'     // Flow Control: conditional fan-out, tags $branch
  | 'router'     // Flow Control: N-way conditional fan-out, tags $route
  | 'switch'     // Flow Control: N-way fan-out by literal value match, tags $route
  | 'merge'      // Flow Control: join multiple upstream branches into one payload
  | 'numeric-aggregator' // Tools: reduce multiple upstream branches to one number
  | 'table-aggregator'   // Tools: collect multiple upstream branches into one row array
  | 'text-aggregator'    // Tools: join multiple upstream branches into one string
  | 'set-variable' // Tools: write a run-scoped variable
  | 'get-variable' // Tools: read a run-scoped variable
  | 'set-variables' // Tools: write several run-scoped variables at once
  | 'get-variables' // Tools: read several run-scoped variables at once
  | 'increment'    // Tools: a definition-scoped, cross-run persistent counter
  | 'sleep'        // Tools: delay this path by N seconds
  | 'compose-string'   // Tools: build a string from a {{input}} template
  | 'convert-encoding' // Tools: base64 / URL / hex encode or decode the input
  | 'regex-match'  // Text Parser: match a regular expression against the input
  | 'html-to-text' // Text Parser: strip HTML tags from the input
  | 'html-table'   // Text Parser: parse the first <table> into rows of cell text
  | 'html-elements'        // Text Parser: extract every matching tag's text + attributes
  | 'match-elements'       // Text Parser: html-elements filtered by a text pattern
  | 'match-pattern-advanced' // Text Parser: every regex match with named capture groups
  | 'replace'      // Text Parser: find/replace (literal or regex)
  | 'chunk-text'   // Text Parser: split the input into fixed-size chunks
  | 'assert'       // Diagnostics: fail (or warn) the run unless an expression holds
  | 'healthcheck'  // Diagnostics: probe a URL for reachability / expected status
  | 'web-search'   // AI Agents: search the open web (tenant key → operator SearXNG → keyless)
  | 'output'     // terminal: write artifact / notify / push to board
  | 'gmail';     // integration: send an email via the tenant's connected Gmail

/** Reserved orchestrator roles for non-agent (in-process) node handlers.
 *  Agent nodes use their configured role instead. Kept here so the builder, the
 *  compiler, and the orchestrator's executeTask switch agree on one vocabulary. */
export const NODE_HANDLER_ROLES: Record<Exclude<WorkflowNodeKind, 'agent'>, string> = {
  trigger:   'node:trigger',
  llm:       'node:llm',
  mcp:       'node:mcp',
  connector: 'node:connector',
  memory:    'node:memory',
  knowledge: 'node:knowledge',
  train:     'node:train',
  transform: 'node:transform',
  filter:    'node:filter',
  branch:    'node:branch',
  router:    'node:router',
  switch:    'node:switch',
  merge:     'node:merge',
  'numeric-aggregator': 'node:numeric-aggregator',
  'table-aggregator':   'node:table-aggregator',
  'text-aggregator':    'node:text-aggregator',
  'set-variable': 'node:set-variable',
  'get-variable': 'node:get-variable',
  'set-variables': 'node:set-variables',
  'get-variables': 'node:get-variables',
  increment:      'node:increment',
  sleep:          'node:sleep',
  'compose-string':   'node:compose-string',
  'convert-encoding': 'node:convert-encoding',
  'regex-match':  'node:regex-match',
  'html-to-text': 'node:html-to-text',
  'html-table':   'node:html-table',
  'html-elements':          'node:html-elements',
  'match-elements':         'node:match-elements',
  'match-pattern-advanced': 'node:match-pattern-advanced',
  replace:        'node:replace',
  'chunk-text':   'node:chunk-text',
  assert:         'node:assert',
  healthcheck:    'node:healthcheck',
  'web-search':   'node:web-search',
  output:    'node:output',
  gmail:     'node:gmail',
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
    case 'connector':
      // `action` is the authoring name, `actionKey` the runtime name — a node
      // written against either runs, so the task text has to read either.
      return `${String(c.connector ?? node.label)} → ${String(c.action ?? c.actionKey ?? 'call')}`;
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
    case 'router':
      return `Route on: ${String(c.fallback ?? node.label ?? 'first matching condition')}`;
    case 'switch':
      return `Switch on: ${String(c.field ?? '(input)')}`;
    case 'merge':
      return `Merge (${String(c.strategy ?? 'array')})`;
    case 'numeric-aggregator':
      return `Numeric aggregator (${String(c.op ?? 'sum')})`;
    case 'table-aggregator':
      return 'Table aggregator';
    case 'text-aggregator':
      return `Text aggregator (sep: ${JSON.stringify(String(c.separator ?? '\n'))})`;
    case 'set-variable':
      return `Set variable "${String(c.key ?? node.label)}"`;
    case 'get-variable':
      return `Get variable "${String(c.key ?? node.label)}"`;
    case 'set-variables':
      return 'Set variables';
    case 'get-variables':
      return `Get variables (${String(c.keys ?? '')})`;
    case 'increment':
      return `Increment "${String(c.key ?? node.label)}"`;
    case 'sleep':
      return `Sleep ${String(c.seconds ?? 0)}s`;
    case 'compose-string':
      return 'Compose a string';
    case 'convert-encoding':
      return `Convert encoding (${String(c.mode ?? 'base64-encode')})`;
    case 'regex-match':
      return `Match /${String(c.pattern ?? node.label)}/`;
    case 'html-to-text':
      return 'HTML to text';
    case 'html-table':
      return 'Get content from HTML table';
    case 'html-elements':
      return `Get elements: <${String(c.tag ?? node.label)}>`;
    case 'match-elements':
      return `Match elements: <${String(c.tag ?? node.label)}>`;
    case 'match-pattern-advanced':
      return `Match pattern (advanced): /${String(c.pattern ?? node.label)}/`;
    case 'replace':
      return `Replace: ${String(c.pattern ?? node.label)}`;
    case 'chunk-text':
      return `Chunk text (${String(c.chunkSize ?? 1000)} chars)`;
    case 'assert':
      return `Assert: ${String(c.expression ?? node.label)}`;
    case 'healthcheck':
      return `Healthcheck: ${String(c.url ?? node.label)}`;
    case 'web-search':
      return `Web search: ${String(c.query ?? '{{input}}')}`;
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
