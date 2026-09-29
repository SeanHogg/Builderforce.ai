/**
 * The workflow node-kind vocabulary — every step kind a workflow definition may place,
 * declared ONCE for the server compiler (`api/src/domain/workflowGraph.ts`) and the web
 * builder + Creation Canvas (`frontend/src/lib/builderforceApi.ts`). Both used to spell
 * the union out by hand and "keep them in sync manually"; a kind added to one and not
 * the other saved on the web and was refused (or passed through unhandled) by the
 * compiler.
 *
 * Grouped as the palette groups them. The Evermind Build kinds (train-tokenizer, …) are
 * NOT here: they run in the browser and persist as opaque JSON, so the server never
 * compiles them — the web adds them to its own union.
 */
export const WORKFLOW_NODE_KINDS = [
  // Entry, agents, model platforms and integrations
  'trigger', 'agent', 'llm', 'mcp', 'connector',
  // LLM logic (the SSM hippocampus, knowledge bases, Evermind training)
  'memory', 'knowledge', 'train',
  // ETL + Flow Control
  'transform', 'filter', 'branch', 'router', 'switch', 'iterator', 'merge',
  // Composition: another canvas run as one step (expanded before execution)
  'subflow',
  // Tools
  'numeric-aggregator', 'table-aggregator', 'text-aggregator',
  'set-variable', 'get-variable', 'set-variables', 'get-variables', 'increment', 'sleep',
  'compose-string', 'convert-encoding', 'web-fetch',
  // Text Parser
  'regex-match', 'html-to-text', 'html-table', 'html-elements', 'match-elements',
  'match-pattern-advanced', 'replace', 'chunk-text',
  // Diagnostics
  'assert', 'healthcheck',
  // AI Agents
  'web-search', 'analyze-image', 'extract-document-data', 'transcribe-audio',
  // Connected-account integrations with their own node
  'google-drive', 'gmail',
  // Terminal
  'output',
] as const;

export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];
