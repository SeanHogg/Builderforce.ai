import type { WorkflowNodeKind } from '@/lib/builderforceApi';

/**
 * Node-kind catalog — the single source of truth for the builder palette.
 *
 * Each kind declares its default label/config and the typed fields the config
 * panel renders. Keeping this here (not inlined in the canvas or the panel)
 * means the palette, the node renderer, and the config editor all agree on one
 * vocabulary, and adding a node kind is a single edit.
 */

export type ConfigFieldType = 'text' | 'textarea' | 'number' | 'select';

export interface ConfigField {
  key: string;
  label: string;
  type: ConfigFieldType;
  options?: string[];
  placeholder?: string;
  /**
   * Only render this field when another config field holds one of these values.
   * Lets a kind reveal type-specific options (e.g. a cron field for a `schedule`
   * trigger) instead of showing every field at once. Omitted = always visible.
   */
  visibleWhen?: { field: string; equals: string | string[] };
}

/** Whether a field should render given the node's current config. */
export function isFieldVisible(field: ConfigField, config: Record<string, unknown>): boolean {
  if (!field.visibleWhen) return true;
  const current = String(config[field.visibleWhen.field] ?? '');
  const { equals } = field.visibleWhen;
  return Array.isArray(equals) ? equals.includes(current) : current === equals;
}

export type NodeGroup = 'Trigger' | 'LLM Logic' | 'Evermind Build' | 'Integrations' | 'ETL' | 'Agent' | 'Output';

export interface NodeKindMeta {
  kind: WorkflowNodeKind;
  label: string;
  icon: string;
  group: NodeGroup;
  /** CSS color used for the node accent + handle. */
  accent: string;
  blurb: string;
  defaultConfig: Record<string, unknown>;
  fields: ConfigField[];
}

export const NODE_KINDS: NodeKindMeta[] = [
  {
    kind: 'trigger',
    label: 'Trigger',
    icon: '⚡',
    group: 'Trigger',
    accent: '#a78bfa',
    blurb: 'Entry point that starts the workflow.',
    defaultConfig: { triggerType: 'manual' },
    fields: [
      {
        key: 'triggerType', label: 'Trigger type', type: 'select',
        // Includes Reliability events (a monitor breach / an incident's lifecycle) so a
        // workflow can automate the response, plus marketing / data-collection events so
        // a workflow can start from a captured signal (form, signup, purchase…).
        options: [
          'manual', 'webhook', 'schedule', 'board-event',
          'monitor-breach', 'incident-created', 'incident-resolved', 'incident-status-change',
          'form-submit', 'page-view', 'signup', 'purchase',
          'email-open', 'email-click', 'rss', 'inbound-email', 'integration',
        ],
      },
      { key: 'source', label: 'Source / label', type: 'text', placeholder: 'e.g. pricing-page form, newsletter' },

      // Type-specific options, revealed by the selected trigger type above.
      { key: 'cron', label: 'Cron schedule', type: 'text', placeholder: 'e.g. 0 9 * * 1-5', visibleWhen: { field: 'triggerType', equals: 'schedule' } },
      { key: 'timezone', label: 'Timezone', type: 'text', placeholder: 'e.g. UTC, America/New_York', visibleWhen: { field: 'triggerType', equals: 'schedule' } },
      { key: 'webhookPath', label: 'Webhook path', type: 'text', placeholder: 'e.g. /hooks/lead', visibleWhen: { field: 'triggerType', equals: 'webhook' } },
      { key: 'secret', label: 'Signing secret', type: 'text', placeholder: 'Shared secret to verify payloads', visibleWhen: { field: 'triggerType', equals: 'webhook' } },
      { key: 'boardEvent', label: 'Board event', type: 'select', options: ['task-created', 'task-moved', 'task-completed', 'comment-added'], visibleWhen: { field: 'triggerType', equals: 'board-event' } },

      // Reliability event filters (blank = fire on any). severity/affectedSystem apply
      // to every Reliability event; the rest are event-specific. Keys are matched
      // server-side by fireEventTriggers.
      { key: 'severity', label: 'Severity filter (blank = any)', type: 'select', options: ['', 'sev1', 'sev2', 'sev3', 'sev4'], visibleWhen: { field: 'triggerType', equals: ['monitor-breach', 'incident-created', 'incident-resolved', 'incident-status-change'] } },
      { key: 'affectedSystem', label: 'Affected-system filter (blank = any)', type: 'text', placeholder: 'e.g. Payments, Database', visibleWhen: { field: 'triggerType', equals: ['monitor-breach', 'incident-created', 'incident-resolved', 'incident-status-change'] } },
      { key: 'monitorType', label: 'Monitor-type filter (blank = any)', type: 'select', options: ['', 'heartbeat', 'http_check', 'webhook', 'metric_threshold', 'manual'], visibleWhen: { field: 'triggerType', equals: 'monitor-breach' } },
      { key: 'incidentSource', label: 'Incident-source filter (blank = any)', type: 'text', placeholder: 'e.g. monitor, manual, freshdesk', visibleWhen: { field: 'triggerType', equals: 'incident-created' } },
      { key: 'status', label: 'Status filter (blank = any)', type: 'select', options: ['', 'open', 'acknowledged', 'mitigated', 'resolved'], visibleWhen: { field: 'triggerType', equals: 'incident-status-change' } },
      { key: 'formId', label: 'Form id', type: 'text', placeholder: 'Form identifier', visibleWhen: { field: 'triggerType', equals: 'form-submit' } },
      { key: 'pagePath', label: 'Page path', type: 'text', placeholder: 'e.g. /pricing', visibleWhen: { field: 'triggerType', equals: 'page-view' } },
      { key: 'sku', label: 'Product / SKU', type: 'text', placeholder: 'Match a product (blank = any)', visibleWhen: { field: 'triggerType', equals: 'purchase' } },
      { key: 'campaign', label: 'Campaign id', type: 'text', placeholder: 'Email campaign id', visibleWhen: { field: 'triggerType', equals: ['email-open', 'email-click'] } },
      { key: 'feedUrl', label: 'Feed URL', type: 'text', placeholder: 'https://example.com/feed.xml', visibleWhen: { field: 'triggerType', equals: 'rss' } },
      { key: 'pollMinutes', label: 'Poll interval (min)', type: 'number', visibleWhen: { field: 'triggerType', equals: 'rss' } },
      { key: 'inbox', label: 'Inbox address', type: 'text', placeholder: 'e.g. leads@inbound.builderforce.ai', visibleWhen: { field: 'triggerType', equals: 'inbound-email' } },
      { key: 'integrationEvent', label: 'Integration event', type: 'text', placeholder: 'e.g. invoice.paid', visibleWhen: { field: 'triggerType', equals: 'integration' } },
    ],
  },
  {
    kind: 'agent',
    label: 'Agent Run',
    icon: '🤖',
    group: 'Agent',
    accent: '#f4726e',
    blurb: 'Run one of your agents (role + runtime + model).',
    defaultConfig: { role: 'code-creator', runtime: 'cloud', model: '', task: '' },
    fields: [
      { key: 'role', label: 'Agent role', type: 'text', placeholder: 'e.g. code-creator, code-reviewer' },
      { key: 'runtime', label: 'Runtime', type: 'select', options: ['cloud', 'browser', 'local', 'remote'] },
      { key: 'model', label: 'Model (blank = default)', type: 'text', placeholder: 'e.g. claude-opus-4-8' },
      { key: 'task', label: 'Task / prompt', type: 'textarea', placeholder: 'What should this agent do?' },
    ],
  },
  {
    kind: 'memory',
    label: 'Memory',
    icon: '🧠',
    group: 'LLM Logic',
    accent: '#00e5cc',
    blurb: 'Recall from or write to the SSM hippocampus memory.',
    defaultConfig: { op: 'recall', query: '', key: '', content: '', limit: 5 },
    fields: [
      { key: 'op', label: 'Operation', type: 'select', options: ['recall', 'write'] },
      { key: 'query', label: 'Recall query', type: 'text', placeholder: 'What to recall (recall op)' },
      { key: 'key', label: 'Memory key', type: 'text', placeholder: 'Key to write (write op)' },
      { key: 'content', label: 'Content', type: 'textarea', placeholder: 'Content to store (write op)' },
      { key: 'limit', label: 'Recall limit', type: 'number' },
    ],
  },
  {
    kind: 'knowledge',
    label: 'Knowledge Base',
    icon: '📚',
    group: 'LLM Logic',
    accent: '#00e5cc',
    blurb: 'Query a knowledge base or ingest source text into it.',
    defaultConfig: { op: 'query', query: '', source: '', namespace: '', limit: 5 },
    fields: [
      { key: 'op', label: 'Operation', type: 'select', options: ['query', 'ingest'] },
      { key: 'query', label: 'Query', type: 'text', placeholder: 'Retrieval query (query op)' },
      { key: 'source', label: 'Source text', type: 'textarea', placeholder: 'Text/URL to ingest (ingest op)' },
      { key: 'namespace', label: 'Namespace', type: 'text', placeholder: 'KB namespace (optional)' },
      { key: 'limit', label: 'Top-K', type: 'number' },
    ],
  },
  {
    kind: 'llm',
    label: 'Call LLM',
    icon: '✨',
    group: 'LLM Logic',
    accent: '#a855f7',
    blurb: 'Call a model provider (OpenAI, Anthropic, Gemini…) via the gateway.',
    defaultConfig: { provider: 'openai', model: '', system: '', prompt: '', temperature: 0.7 },
    fields: [
      { key: 'provider', label: 'Provider', type: 'text', placeholder: 'openai, anthropic, gemini, mistral…' },
      { key: 'model', label: 'Model (blank = provider default)', type: 'text', placeholder: 'e.g. gpt-4o, claude-opus-4-8' },
      { key: 'system', label: 'System prompt', type: 'textarea', placeholder: 'Optional system instructions' },
      { key: 'prompt', label: 'Prompt', type: 'textarea', placeholder: 'User prompt — supports {{input}}' },
      { key: 'temperature', label: 'Temperature', type: 'number' },
    ],
  },
  {
    kind: 'mcp',
    label: 'MCP Tool',
    icon: '🧩',
    group: 'Integrations',
    accent: '#38bdf8',
    blurb: 'Invoke an MCP server / SaaS integration tool.',
    defaultConfig: { integration: '', operation: '', params: '{}' },
    fields: [
      { key: 'integration', label: 'Integration', type: 'text', placeholder: 'e.g. github, postgres, slack' },
      { key: 'operation', label: 'Operation', type: 'text', placeholder: 'e.g. create-issue, query' },
      { key: 'params', label: 'Params (JSON)', type: 'textarea', placeholder: '{ "title": "..." }' },
    ],
  },
  {
    kind: 'train',
    label: 'Train',
    icon: '🎓',
    group: 'LLM Logic',
    accent: '#00e5cc',
    blurb: 'Train an Evermind model on a dataset (tokenizer → train → package).',
    defaultConfig: { model: '', dataset: '', epochs: 1 },
    fields: [
      { key: 'model', label: 'Model name', type: 'text', placeholder: 'Output model name' },
      { key: 'dataset', label: 'Dataset', type: 'text', placeholder: 'Dataset ref / path' },
      { key: 'epochs', label: 'Epochs', type: 'number' },
    ],
  },
  // --- Evermind Build — engine pipeline steps that run IN-BROWSER (lib/evermindBuild.ts).
  //     Each `kind` equals an engine workflow step `type`, so the graph compiles 1:1
  //     to a WorkflowConfig. Chain them (or load a template) then hit "▶ Build". ---
  {
    kind: 'train-tokenizer',
    label: 'Train Tokenizer',
    icon: '🔤',
    group: 'Evermind Build',
    accent: '#a855f7',
    blurb: 'Learn a byte-BPE tokenizer from a corpus.',
    defaultConfig: { corpus: '', numMerges: 120 },
    fields: [
      { key: 'corpus', label: 'Corpus', type: 'textarea', placeholder: 'Training text…' },
      { key: 'numMerges', label: 'BPE merges', type: 'number' },
    ],
  },
  {
    kind: 'dataset-quality',
    label: 'Dataset Quality',
    icon: '🧪',
    group: 'Evermind Build',
    accent: '#a855f7',
    blurb: 'Gate the corpus: min words/sequences + max duplicate ratio.',
    defaultConfig: { minWords: 20, minSequences: 3, maxDuplicateRatio: 0.5 },
    fields: [
      { key: 'minWords', label: 'Min words', type: 'number' },
      { key: 'minSequences', label: 'Min sequences', type: 'number' },
      { key: 'maxDuplicateRatio', label: 'Max duplicate ratio', type: 'number' },
    ],
  },
  {
    kind: 'train-model',
    label: 'Train Model',
    icon: '🧠',
    group: 'Evermind Build',
    accent: '#a855f7',
    blurb: 'Train an EvermindLM on the corpus (on-device, CPU).',
    defaultConfig: { corpus: '', epochs: 50, dModel: 24, numLayers: 2, hiddenDim: 32 },
    fields: [
      { key: 'corpus', label: 'Corpus', type: 'textarea', placeholder: 'Training text…' },
      { key: 'epochs', label: 'Epochs', type: 'number' },
      { key: 'dModel', label: 'Model dim', type: 'number' },
      { key: 'numLayers', label: 'Layers', type: 'number' },
      { key: 'hiddenDim', label: 'Hidden dim', type: 'number' },
    ],
  },
  {
    kind: 'convergence',
    label: 'Convergence Check',
    icon: '📉',
    group: 'Evermind Build',
    accent: '#a855f7',
    blurb: 'Assert training loss actually dropped.',
    defaultConfig: {},
    fields: [],
  },
  {
    kind: 'evaluate',
    label: 'Evaluate',
    icon: '📊',
    group: 'Evermind Build',
    accent: '#a855f7',
    blurb: 'Score held-out perplexity / next-token accuracy.',
    defaultConfig: { prompt: '' },
    fields: [{ key: 'prompt', label: 'Seed prompt', type: 'text', placeholder: 'Optional' }],
  },
  {
    kind: 'generate-check',
    label: 'Generation Check',
    icon: '✍️',
    group: 'Evermind Build',
    accent: '#a855f7',
    blurb: 'Non-empty + seed-reproducible sampling.',
    defaultConfig: { prompt: '' },
    fields: [{ key: 'prompt', label: 'Seed prompt', type: 'text', placeholder: 'Optional' }],
  },
  {
    kind: 'benchmark',
    label: 'Benchmark',
    icon: '🏁',
    group: 'Evermind Build',
    accent: '#a855f7',
    blurb: 'Held-out perplexity + accuracy scorecard.',
    defaultConfig: {},
    fields: [],
  },
  {
    kind: 'roundtrip',
    label: 'Package (Round-trip)',
    icon: '📦',
    group: 'Evermind Build',
    accent: '#a855f7',
    blurb: 'Package → reload → prove identical output. Emits the .evermind artifact.',
    defaultConfig: { name: 'my-llm' },
    fields: [{ key: 'name', label: 'Model name', type: 'text' }],
  },
  {
    kind: 'export',
    label: 'Export',
    icon: '🚀',
    group: 'Evermind Build',
    accent: '#a855f7',
    blurb: 'Export a publishable repo (Hugging Face / ONNX / safetensors / GGUF).',
    defaultConfig: { format: 'huggingface', name: 'my-llm', version: '1.0.0' },
    fields: [
      { key: 'format', label: 'Format', type: 'select', options: ['huggingface', 'onnx', 'safetensors', 'gguf'] },
      { key: 'name', label: 'Model name', type: 'text' },
      { key: 'version', label: 'Version', type: 'text' },
    ],
  },
  {
    kind: 'distill-corpus',
    label: 'Distil Corpus',
    icon: '🧬',
    group: 'Evermind Build',
    accent: '#a855f7',
    blurb: 'Build a (prompt → completion) corpus from teacher exemplars (JSON pairs).',
    defaultConfig: { pairs: '[]' },
    fields: [{ key: 'pairs', label: 'Exemplar pairs (JSON)', type: 'textarea', placeholder: '[{"prompt":"…","completion":"…"}]' }],
  },
  {
    kind: 'code-parse-check',
    label: 'Code Parse Check',
    icon: '🔩',
    group: 'Evermind Build',
    accent: '#a855f7',
    blurb: 'Structural/parse validity of generated code.',
    defaultConfig: { language: 'js' },
    fields: [{ key: 'language', label: 'Language', type: 'select', options: ['js'] }],
  },
  {
    kind: 'code-eval',
    label: 'Code Test Reward',
    icon: '✅',
    group: 'Evermind Build',
    accent: '#a855f7',
    blurb: 'Execution-grounded test reward (JSON cases).',
    defaultConfig: { cases: '[]' },
    fields: [{ key: 'cases', label: 'Test cases (JSON)', type: 'textarea', placeholder: '[{"call":"add(2,3)","expect":5}]' }],
  },
  {
    kind: 'code-benchmark',
    label: 'Code Benchmark (pass@1)',
    icon: '🎯',
    group: 'Evermind Build',
    accent: '#a855f7',
    blurb: 'Held-out pass@1 on unseen prompts (JSON tasks).',
    defaultConfig: { tasks: '[]' },
    fields: [{ key: 'tasks', label: 'Tasks (JSON)', type: 'textarea', placeholder: '[{"prompt":"function add","cases":[…]}]' }],
  },
  {
    kind: 'transform',
    label: 'Transform',
    icon: '🔧',
    group: 'ETL',
    accent: '#facc15',
    blurb: 'Shape / map the payload.',
    defaultConfig: { expression: '' },
    fields: [{ key: 'expression', label: 'Expression', type: 'textarea', placeholder: 'Mapping expression' }],
  },
  {
    kind: 'filter',
    label: 'Filter',
    icon: '🚦',
    group: 'ETL',
    accent: '#facc15',
    blurb: 'Drop the payload unless a predicate holds.',
    defaultConfig: { predicate: '' },
    fields: [{ key: 'predicate', label: 'Predicate', type: 'text', placeholder: 'e.g. status == "ready"' }],
  },
  {
    kind: 'branch',
    label: 'Branch',
    icon: '🔱',
    group: 'ETL',
    accent: '#facc15',
    blurb: 'Conditional fan-out to downstream nodes.',
    defaultConfig: { condition: '' },
    fields: [{ key: 'condition', label: 'Condition', type: 'text', placeholder: 'Branch condition' }],
  },
  {
    kind: 'output',
    label: 'Output',
    icon: '📤',
    group: 'Output',
    accent: '#22c55e',
    blurb: 'Terminal: write artifact / notify / push to board.',
    defaultConfig: { target: 'artifact', note: '' },
    fields: [
      { key: 'target', label: 'Target', type: 'select', options: ['artifact', 'pr', 'notify', 'board'] },
      { key: 'note', label: 'Note', type: 'text', placeholder: 'Optional label' },
    ],
  },
];

export const NODE_KIND_MAP: Record<WorkflowNodeKind, NodeKindMeta> = NODE_KINDS.reduce(
  (acc, m) => {
    acc[m.kind] = m;
    return acc;
  },
  {} as Record<WorkflowNodeKind, NodeKindMeta>,
);

export const NODE_GROUPS: NodeGroup[] = ['Trigger', 'LLM Logic', 'Evermind Build', 'Integrations', 'Agent', 'ETL', 'Output'];
