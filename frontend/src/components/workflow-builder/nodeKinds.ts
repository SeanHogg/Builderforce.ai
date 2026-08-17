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

export type NodeGroup =
  | 'Trigger' | 'LLM Logic' | 'Evermind Build' | 'Integrations' | 'ETL' | 'Agent' | 'Output'
  | 'Flow Control' | 'Tools' | 'Text Parser' | 'Diagnostics' | 'AI Agents';

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
    accent: 'var(--violet-bright)',
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
      // Twilio cannot be made to send a generic HMAC header — it signs the URL
      // plus the sorted form parameters with its own scheme. Without this choice
      // a Twilio number could not start a workflow at all.
      { key: 'verify', label: 'Verify caller as', type: 'select', options: ['hmac', 'twilio'], visibleWhen: { field: 'triggerType', equals: 'webhook' } },
      { key: 'secret', label: 'Signing secret / Twilio auth token', type: 'text', placeholder: 'Shared secret, or your Twilio auth token', visibleWhen: { field: 'triggerType', equals: 'webhook' } },
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
    accent: 'var(--coral-bright)',
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
    accent: 'var(--cyan-bright)',
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
    accent: 'var(--cyan-bright)',
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
    accent: 'var(--purple-bright)',
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
    accent: 'var(--sky-bright)',
    blurb: 'Invoke an MCP server / SaaS integration tool.',
    defaultConfig: { integration: '', operation: '', params: '{}' },
    fields: [
      { key: 'integration', label: 'Integration', type: 'text', placeholder: 'e.g. github, postgres, slack' },
      { key: 'operation', label: 'Operation', type: 'text', placeholder: 'e.g. create-issue, query' },
      { key: 'params', label: 'Params (JSON)', type: 'textarea', placeholder: '{ "title": "..." }' },
    ],
  },
  {
    kind: 'connector',
    label: 'Integration action',
    icon: '🔌',
    group: 'Integrations',
    accent: 'var(--orange-bright)',
    blurb: 'Call any connected integration — SMS, voice, WhatsApp, email, CRM, payments.',
    // No declared fields: this node's options come from the tenant's LIVE catalog
    // (including connectors they authored), so it renders its own editor —
    // see ConnectorNodeFields.tsx.
    defaultConfig: { connector: '', action: '', input: '{}' },
    fields: [],
  },
  {
    kind: 'gmail',
    label: 'Send Gmail',
    icon: '✉️',
    group: 'Integrations',
    accent: 'var(--red-bright)',
    blurb: 'Send an email through your connected Gmail account.',
    defaultConfig: { to: '', subject: '', body: '{{input}}' },
    fields: [
      { key: 'to', label: 'To', type: 'text', placeholder: 'recipient@example.com — supports {{input}}' },
      { key: 'subject', label: 'Subject', type: 'text', placeholder: 'Email subject — supports {{input}}' },
      { key: 'body', label: 'Body', type: 'textarea', placeholder: 'Email body — {{input}} inserts the upstream output' },
    ],
  },
  {
    kind: 'train',
    label: 'Train',
    icon: '🎓',
    group: 'LLM Logic',
    accent: 'var(--cyan-bright)',
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
    accent: 'var(--purple-bright)',
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
    accent: 'var(--purple-bright)',
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
    accent: 'var(--purple-bright)',
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
    accent: 'var(--purple-bright)',
    blurb: 'Assert training loss actually dropped.',
    defaultConfig: {},
    fields: [],
  },
  {
    kind: 'evaluate',
    label: 'Evaluate',
    icon: '📊',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Score held-out perplexity / next-token accuracy.',
    defaultConfig: { prompt: '' },
    fields: [{ key: 'prompt', label: 'Seed prompt', type: 'text', placeholder: 'Optional' }],
  },
  {
    kind: 'generate-check',
    label: 'Generation Check',
    icon: '✍️',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Non-empty + seed-reproducible sampling.',
    defaultConfig: { prompt: '' },
    fields: [{ key: 'prompt', label: 'Seed prompt', type: 'text', placeholder: 'Optional' }],
  },
  {
    kind: 'benchmark',
    label: 'Benchmark',
    icon: '🏁',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Held-out perplexity + accuracy scorecard.',
    defaultConfig: {},
    fields: [],
  },
  {
    kind: 'roundtrip',
    label: 'Package (Round-trip)',
    icon: '📦',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Package → reload → prove identical output. Emits the .evermind artifact.',
    defaultConfig: { name: 'my-llm' },
    fields: [{ key: 'name', label: 'Model name', type: 'text' }],
  },
  {
    kind: 'export',
    label: 'Export',
    icon: '🚀',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
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
    accent: 'var(--purple-bright)',
    blurb: 'Build a (prompt → completion) corpus from teacher exemplars (JSON pairs).',
    defaultConfig: { pairs: '[]' },
    fields: [{ key: 'pairs', label: 'Exemplar pairs (JSON)', type: 'textarea', placeholder: '[{"prompt":"…","completion":"…"}]' }],
  },
  {
    kind: 'code-parse-check',
    label: 'Code Parse Check',
    icon: '🔩',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Structural/parse validity of generated code.',
    defaultConfig: { language: 'js' },
    fields: [{ key: 'language', label: 'Language', type: 'select', options: ['js'] }],
  },
  {
    kind: 'code-eval',
    label: 'Code Test Reward',
    icon: '✅',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Execution-grounded test reward (JSON cases).',
    defaultConfig: { cases: '[]' },
    fields: [{ key: 'cases', label: 'Test cases (JSON)', type: 'textarea', placeholder: '[{"call":"add(2,3)","expect":5}]' }],
  },
  {
    kind: 'code-benchmark',
    label: 'Code Benchmark (pass@1)',
    icon: '🎯',
    group: 'Evermind Build',
    accent: 'var(--purple-bright)',
    blurb: 'Held-out pass@1 on unseen prompts (JSON tasks).',
    defaultConfig: { tasks: '[]' },
    fields: [{ key: 'tasks', label: 'Tasks (JSON)', type: 'textarea', placeholder: '[{"prompt":"function add","cases":[…]}]' }],
  },
  {
    kind: 'transform',
    label: 'Transform',
    icon: '🔧',
    group: 'ETL',
    accent: 'var(--yellow-bright)',
    blurb: 'Shape / map the payload.',
    defaultConfig: { expression: '' },
    fields: [{ key: 'expression', label: 'Expression', type: 'textarea', placeholder: 'Mapping expression' }],
  },
  {
    kind: 'filter',
    label: 'Filter',
    icon: '🚦',
    group: 'Flow Control',
    accent: 'var(--emerald-bright)',
    blurb: 'Drop the payload unless a predicate holds. Pair with Router/Branch: filter on $route == "Name" to gate one path.',
    defaultConfig: { predicate: '' },
    fields: [{ key: 'predicate', label: 'Predicate', type: 'text', placeholder: 'e.g. status == "ready", or $route == "Then"' }],
  },
  {
    kind: 'branch',
    label: 'Branch',
    icon: '🔱',
    group: 'Flow Control',
    accent: 'var(--emerald-bright)',
    blurb: 'Tags the payload with $branch (true/false) from a condition — pair with a Filter reading $branch to gate one side.',
    defaultConfig: { condition: '' },
    fields: [{ key: 'condition', label: 'Condition', type: 'text', placeholder: 'Branch condition' }],
  },
  {
    kind: 'router',
    label: 'Router / If-Else',
    icon: '🔀',
    group: 'Flow Control',
    accent: 'var(--emerald-bright)',
    blurb: 'N-way conditional fan-out — tags the payload with $route (the first matching route\'s name, or the fallback). Pair with a Filter reading $route == "Name" on each downstream path, the same way as Branch/$branch.',
    // `routes` is a JSON-encoded string (not a live array) — same convention as
    // the `mcp` kind's `params` field: a textarea field's config value is always
    // a string, parsed by the executor (see cloudExecutor.ts's `router` case).
    defaultConfig: { routes: '[{"name":"Then","condition":""}]', fallback: 'Else' },
    fields: [
      { key: 'routes', label: 'Routes (JSON: [{"name","condition"}])', type: 'textarea', placeholder: '[{"name":"Then","condition":"status == \\"ready\\""}]' },
      { key: 'fallback', label: 'Fallback route name', type: 'text', placeholder: 'e.g. Else' },
    ],
  },
  {
    kind: 'switch',
    label: 'Switch',
    icon: '🔛',
    group: 'Flow Control',
    accent: 'var(--emerald-bright)',
    blurb: 'Fan-out by matching a VALUE against a list of literal cases (not a condition, unlike Router) — tags the payload with $route. Pair with a Filter reading $route == "Name" on each downstream path.',
    defaultConfig: { field: '', cases: '[{"match":"","name":"Case 1"}]', fallback: 'Else' },
    fields: [
      { key: 'field', label: 'Field to match (blank = whole input)', type: 'text', placeholder: 'e.g. status' },
      { key: 'cases', label: 'Cases (JSON: [{"match","name"}])', type: 'textarea', placeholder: '[{"match":"ready","name":"Ready"}]' },
      { key: 'fallback', label: 'Fallback route name', type: 'text', placeholder: 'e.g. Else' },
    ],
  },
  {
    kind: 'iterator',
    label: 'Iterator',
    icon: '🔁',
    group: 'Flow Control',
    accent: 'var(--emerald-bright)',
    blurb: 'Forks the ONE node directly after it into a copy per array item (the input must be a JSON array, or {"items":[...]}) — connect a Merge/Aggregator after that node to collect the results. Only a single processor step is forked; chain more after the aggregator.',
    defaultConfig: {},
    fields: [],
  },
  {
    kind: 'merge',
    label: 'Merge',
    icon: '🔗',
    group: 'Flow Control',
    accent: 'var(--emerald-bright)',
    blurb: 'Join multiple upstream branches back into one payload.',
    defaultConfig: { strategy: 'array', keys: '' },
    fields: [
      { key: 'strategy', label: 'Strategy', type: 'select', options: ['array', 'object-keys', 'first'] },
      { key: 'keys', label: 'Keys (for object-keys, comma-separated)', type: 'text', placeholder: 'e.g. a,b,c', visibleWhen: { field: 'strategy', equals: 'object-keys' } },
    ],
  },
  {
    kind: 'numeric-aggregator',
    label: 'Numeric Aggregator',
    icon: '➕',
    group: 'Tools',
    accent: 'var(--indigo-bright)',
    blurb: 'Reduce multiple upstream branches to one number — sum, average, min, max, or count.',
    defaultConfig: { op: 'sum' },
    fields: [{ key: 'op', label: 'Operation', type: 'select', options: ['sum', 'avg', 'min', 'max', 'count'] }],
  },
  {
    kind: 'table-aggregator',
    label: 'Table Aggregator',
    icon: '🗂️',
    group: 'Tools',
    accent: 'var(--indigo-bright)',
    blurb: 'Collect multiple upstream branches\' JSON-object outputs into one array of rows.',
    defaultConfig: {},
    fields: [],
  },
  {
    kind: 'text-aggregator',
    label: 'Text Aggregator',
    icon: '📜',
    group: 'Tools',
    accent: 'var(--indigo-bright)',
    blurb: 'Join multiple upstream branches\' text outputs into one string.',
    defaultConfig: { separator: '\n' },
    fields: [{ key: 'separator', label: 'Separator', type: 'text', placeholder: '\\n' }],
  },
  {
    kind: 'set-variable',
    label: 'Set Variable',
    icon: '📌',
    group: 'Tools',
    accent: 'var(--indigo-bright)',
    blurb: 'Write a variable for the rest of THIS run to read (not shared across runs).',
    defaultConfig: { key: '', value: '{{input}}' },
    fields: [
      { key: 'key', label: 'Key', type: 'text', placeholder: 'e.g. leadScore' },
      { key: 'value', label: 'Value', type: 'text', placeholder: 'Supports {{input}}' },
    ],
  },
  {
    kind: 'get-variable',
    label: 'Get Variable',
    icon: '📎',
    group: 'Tools',
    accent: 'var(--indigo-bright)',
    blurb: 'Read a variable set earlier in THIS run.',
    defaultConfig: { key: '' },
    fields: [{ key: 'key', label: 'Key', type: 'text', placeholder: 'e.g. leadScore' }],
  },
  {
    kind: 'set-variables',
    label: 'Set Multiple Variables',
    icon: '📌',
    group: 'Tools',
    accent: 'var(--indigo-bright)',
    blurb: 'Write several run-scoped variables at once.',
    defaultConfig: { values: '{"key1":"{{input}}"}' },
    fields: [{ key: 'values', label: 'Values (JSON: {"key":"value"})', type: 'textarea', placeholder: '{"leadScore":"{{input}}"}' }],
  },
  {
    kind: 'get-variables',
    label: 'Get Multiple Variables',
    icon: '📎',
    group: 'Tools',
    accent: 'var(--indigo-bright)',
    blurb: 'Read several variables set earlier in THIS run — outputs one JSON object.',
    defaultConfig: { keys: '' },
    fields: [{ key: 'keys', label: 'Keys (comma-separated)', type: 'text', placeholder: 'e.g. leadScore,region' }],
  },
  {
    kind: 'increment',
    label: 'Increment',
    icon: '🔢',
    group: 'Tools',
    accent: 'var(--indigo-bright)',
    blurb: 'A counter that PERSISTS ACROSS RUNS of this workflow (unlike Set/Get Variable) — returns the new value.',
    defaultConfig: { key: 'counter', step: 1 },
    fields: [
      { key: 'key', label: 'Counter key', type: 'text', placeholder: 'e.g. counter' },
      { key: 'step', label: 'Step', type: 'number' },
    ],
  },
  {
    kind: 'sleep',
    label: 'Sleep',
    icon: '⏱️',
    group: 'Tools',
    accent: 'var(--indigo-bright)',
    blurb: 'Delay this path by N seconds before continuing.',
    defaultConfig: { seconds: 5 },
    fields: [{ key: 'seconds', label: 'Seconds', type: 'number' }],
  },
  {
    kind: 'compose-string',
    label: 'Compose a String',
    icon: '✍️',
    group: 'Tools',
    accent: 'var(--indigo-bright)',
    blurb: 'Build a string from a {{input}} template.',
    defaultConfig: { template: '{{input}}' },
    fields: [{ key: 'template', label: 'Template', type: 'textarea', placeholder: 'Hello {{input}}!' }],
  },
  {
    kind: 'convert-encoding',
    label: 'Convert Encoding',
    icon: '🔡',
    group: 'Tools',
    accent: 'var(--indigo-bright)',
    blurb: 'Base64 / URL / hex encode or decode the input.',
    defaultConfig: { mode: 'base64-encode' },
    fields: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['base64-encode', 'base64-decode', 'url-encode', 'url-decode', 'hex-encode', 'hex-decode'] },
    ],
  },
  {
    kind: 'regex-match',
    label: 'Match Pattern',
    icon: '🔎',
    group: 'Text Parser',
    accent: 'var(--amber-bright)',
    blurb: 'Match a regular expression against the input; outputs matches + capture groups.',
    defaultConfig: { pattern: '', flags: '' },
    fields: [
      { key: 'pattern', label: 'Pattern (regex)', type: 'text', placeholder: 'e.g. \\d{3}-\\d{4}' },
      { key: 'flags', label: 'Flags', type: 'text', placeholder: 'e.g. gi' },
    ],
  },
  {
    kind: 'html-to-text',
    label: 'HTML to Text',
    icon: '📄',
    group: 'Text Parser',
    accent: 'var(--amber-bright)',
    blurb: 'Strip HTML tags from the input, leaving plain text.',
    defaultConfig: {},
    fields: [],
  },
  {
    kind: 'html-table',
    label: 'Get Content from HTML Table',
    icon: '📊',
    group: 'Text Parser',
    accent: 'var(--amber-bright)',
    blurb: 'Search the input HTML for a table and return its rows and columns as text.',
    defaultConfig: {},
    fields: [],
  },
  {
    kind: 'html-elements',
    label: 'Get Elements from HTML',
    icon: '🏷️',
    group: 'Text Parser',
    accent: 'var(--amber-bright)',
    blurb: 'Extract every matching tag from the input HTML, with its text and attributes.',
    defaultConfig: { tag: 'a' },
    fields: [{ key: 'tag', label: 'Tag name', type: 'text', placeholder: 'e.g. a, img, p' }],
  },
  {
    kind: 'match-elements',
    label: 'Match Elements',
    icon: '🔍',
    group: 'Text Parser',
    accent: 'var(--amber-bright)',
    blurb: 'Get Elements from HTML, filtered to those whose text matches a pattern.',
    defaultConfig: { tag: 'a', pattern: '' },
    fields: [
      { key: 'tag', label: 'Tag name', type: 'text', placeholder: 'e.g. a, li' },
      { key: 'pattern', label: 'Text pattern (regex)', type: 'text', placeholder: 'e.g. ^Buy' },
    ],
  },
  {
    kind: 'match-pattern-advanced',
    label: 'Match Pattern (Advanced)',
    icon: '🧬',
    group: 'Text Parser',
    accent: 'var(--amber-bright)',
    blurb: 'Every match of a regular expression, each with its named capture groups as a structured object.',
    defaultConfig: { pattern: '', flags: '' },
    fields: [
      { key: 'pattern', label: 'Pattern (regex)', type: 'text', placeholder: 'e.g. (?<year>\\d{4})-(?<month>\\d{2})' },
      { key: 'flags', label: 'Flags', type: 'text', placeholder: 'e.g. i' },
    ],
  },
  {
    kind: 'replace',
    label: 'Replace',
    icon: '♻️',
    group: 'Text Parser',
    accent: 'var(--amber-bright)',
    blurb: 'Find and replace — literal substring or regular expression (supports $1 backreferences).',
    defaultConfig: { pattern: '', replacement: '', flags: '', literal: true },
    fields: [
      { key: 'pattern', label: 'Find', type: 'text', placeholder: 'Text or regex to find' },
      { key: 'replacement', label: 'Replace with', type: 'text', placeholder: 'Replacement (supports $1)' },
      { key: 'literal', label: 'Literal (not regex)', type: 'select', options: ['true', 'false'] },
      { key: 'flags', label: 'Regex flags', type: 'text', placeholder: 'e.g. gi', visibleWhen: { field: 'literal', equals: 'false' } },
    ],
  },
  {
    kind: 'chunk-text',
    label: 'Chunk Text',
    icon: '🧩',
    group: 'Text Parser',
    accent: 'var(--amber-bright)',
    blurb: 'Split the input into fixed-size, optionally overlapping chunks — for feeding an LLM/embedding node piece by piece.',
    defaultConfig: { chunkSize: 1000, overlap: 0 },
    fields: [
      { key: 'chunkSize', label: 'Chunk size (chars)', type: 'number' },
      { key: 'overlap', label: 'Overlap (chars)', type: 'number' },
    ],
  },
  {
    kind: 'assert',
    label: 'Assert',
    icon: '✅',
    group: 'Diagnostics',
    accent: 'var(--pink-bright)',
    blurb: 'Fail (or just warn) the run unless an expression holds — makes a bad upstream state visible in run history instead of silently continuing.',
    defaultConfig: { expression: '', onFail: 'fail-task' },
    fields: [
      { key: 'expression', label: 'Expression', type: 'text', placeholder: 'e.g. status == "ready"' },
      { key: 'onFail', label: 'On fail', type: 'select', options: ['fail-task', 'warn-only'] },
    ],
  },
  {
    kind: 'healthcheck',
    label: 'Healthcheck',
    icon: '🩺',
    group: 'Diagnostics',
    accent: 'var(--pink-bright)',
    blurb: 'Probe a URL and report whether it returned the expected status.',
    defaultConfig: { url: '', expectedStatus: 200 },
    fields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com/health — supports {{input}}' },
      { key: 'expectedStatus', label: 'Expected status', type: 'number' },
    ],
  },
  {
    kind: 'web-search',
    label: 'Web Search',
    icon: '🔎',
    group: 'AI Agents',
    accent: 'var(--teal-bright)',
    blurb: 'Search the open web and return results with page content — resolves your connected Tavily/Exa/Linkup key, then an operator SearXNG instance, then a keyless encyclopedic fallback, so it always returns something.',
    defaultConfig: { query: '' },
    fields: [
      { key: 'query', label: 'Query', type: 'text', placeholder: '{{input}} — defaults to the upstream output' },
    ],
  },
  {
    kind: 'web-fetch',
    label: 'Web Fetch',
    icon: '🌐',
    group: 'Tools',
    accent: 'var(--indigo-bright)',
    blurb: 'Fetch a public URL and return its readable text (HTML stripped) — SSRF-guarded, no credential needed.',
    defaultConfig: { url: '' },
    fields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com — supports {{input}}' },
    ],
  },
  {
    kind: 'google-drive',
    label: 'Google Drive',
    icon: '📂',
    group: 'Tools',
    accent: 'var(--indigo-bright)',
    blurb: 'Search or read a file (as text) from your connected Google Drive.',
    defaultConfig: { operation: 'search', query: '', fileId: '' },
    fields: [
      { key: 'operation', label: 'Operation', type: 'select', options: ['search', 'read'] },
      { key: 'query', label: 'Search query', type: 'text', placeholder: '{{input}} — defaults to the upstream output', visibleWhen: { field: 'operation', equals: 'search' } },
      { key: 'fileId', label: 'File id', type: 'text', placeholder: 'Drive file id — supports {{input}}', visibleWhen: { field: 'operation', equals: 'read' } },
    ],
  },
  {
    kind: 'analyze-image',
    label: 'Analyze Image',
    icon: '🖼️',
    group: 'AI Agents',
    accent: 'var(--teal-bright)',
    blurb: 'Vision analysis of an image URL — auto-routed to a vision-capable model.',
    defaultConfig: { url: '', prompt: '' },
    fields: [
      { key: 'url', label: 'Image URL', type: 'text', placeholder: '{{input}} — defaults to the upstream output' },
      { key: 'prompt', label: 'Prompt', type: 'textarea', placeholder: 'What do you want to know about the image?' },
    ],
  },
  {
    kind: 'extract-document-data',
    label: 'Extract Document Data',
    icon: '🧾',
    group: 'AI Agents',
    accent: 'var(--teal-bright)',
    blurb: 'Pull structured fields out of a document, invoice, or receipt image — vision analysis with a structured-extraction prompt, outputs JSON.',
    defaultConfig: { url: '', fields: '' },
    fields: [
      { key: 'url', label: 'Document/image URL', type: 'text', placeholder: '{{input}} — defaults to the upstream output' },
      { key: 'fields', label: 'Fields to extract (comma-separated)', type: 'text', placeholder: 'e.g. date, total, vendor' },
    ],
  },
  {
    kind: 'transcribe-audio',
    label: 'Transcribe Audio',
    icon: '🎙️',
    group: 'AI Agents',
    accent: 'var(--teal-bright)',
    blurb: 'Transcribe an audio file, or translate it directly to English — real Whisper API call (operator-configured, no per-tenant BYO key yet).',
    defaultConfig: { url: '', mode: 'transcribe', language: '' },
    fields: [
      { key: 'url', label: 'Audio file URL', type: 'text', placeholder: '{{input}} — defaults to the upstream output' },
      { key: 'mode', label: 'Mode', type: 'select', options: ['transcribe', 'translate'] },
      { key: 'language', label: 'Language hint (ISO 639-1, optional)', type: 'text', placeholder: 'e.g. en', visibleWhen: { field: 'mode', equals: 'transcribe' } },
    ],
  },
  {
    kind: 'output',
    label: 'Output',
    icon: '📤',
    group: 'Output',
    accent: 'var(--success)',
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

export const NODE_GROUPS: NodeGroup[] = [
  'Trigger', 'Flow Control', 'Tools', 'Text Parser', 'AI Agents', 'Diagnostics',
  'LLM Logic', 'Evermind Build', 'Integrations', 'Agent', 'ETL', 'Output',
];

/**
 * The translation key each family is named by.
 *
 * The catalog's own group names are identifiers, not copy: the palette heading and
 * the 3D group badge both show a family to a reader, so the catalog says which key
 * names it rather than either surface shipping its own English.
 */
export const NODE_GROUP_KEYS: Record<NodeGroup, string> = {
  'Trigger': 'trigger',
  'LLM Logic': 'llmLogic',
  'Evermind Build': 'evermindBuild',
  'Integrations': 'integrations',
  'Agent': 'agent',
  'ETL': 'etl',
  'Output': 'output',
  'Flow Control': 'flowControl',
  'Tools': 'tools',
  'Text Parser': 'textParser',
  'Diagnostics': 'diagnostics',
  'AI Agents': 'aiAgentsGroup',
};

/**
 * i18n slug for each node kind ADDED alongside Flow Control / Tools / Text
 * Parser / Diagnostics — deliberately NOT a full retrofit of the ~30
 * pre-existing kinds above (their `label`/`blurb`/field labels predate i18n
 * entirely; see ROADMAP.md's tracked gap). Only kinds present here have a
 * `evermindBuild.nodeKind.<slug>.{label,blurb}` translation; every other kind
 * keeps rendering its catalog literal, unchanged, via the `??` fallback in
 * {@link nodeKindLabel} / {@link nodeKindBlurb}.
 */
export const I18N_NODE_KIND_SLUG: Partial<Record<WorkflowNodeKind, string>> = {
  router: 'router',
  switch: 'switch',
  iterator: 'iterator',
  merge: 'merge',
  'numeric-aggregator': 'numericAggregator',
  'table-aggregator': 'tableAggregator',
  'text-aggregator': 'textAggregator',
  'set-variable': 'setVariable',
  'get-variable': 'getVariable',
  'set-variables': 'setVariables',
  'get-variables': 'getVariables',
  increment: 'increment',
  sleep: 'sleep',
  'compose-string': 'composeString',
  'convert-encoding': 'convertEncoding',
  'regex-match': 'regexMatch',
  'html-to-text': 'htmlToText',
  'html-table': 'htmlTable',
  'html-elements': 'htmlElements',
  'match-elements': 'matchElements',
  'match-pattern-advanced': 'matchPatternAdvanced',
  replace: 'replace',
  'chunk-text': 'chunkText',
  assert: 'assert',
  healthcheck: 'healthcheck',
  'web-search': 'webSearch',
  'web-fetch': 'webFetch',
  'google-drive': 'googleDrive',
  'analyze-image': 'analyzeImage',
  'extract-document-data': 'extractDocumentData',
  'transcribe-audio': 'transcribeAudio',
};

/** A translator over the `evermindBuild` namespace — `useTranslations('evermindBuild')`'s
 *  return type, accepting an arbitrary key (the catalog builds keys dynamically). */
type EvermindBuildTranslator = (key: string) => string;

/** The label to show for a node kind — translated for newly-added kinds, the
 *  catalog literal for every kind that predates i18n. */
export function nodeKindLabel(meta: NodeKindMeta, t: EvermindBuildTranslator): string {
  const slug = I18N_NODE_KIND_SLUG[meta.kind];
  return slug ? t(`nodeKind.${slug}.label`) : meta.label;
}

/** The blurb (tooltip / inspector subtitle) to show for a node kind — same
 *  translated-if-new, literal-otherwise rule as {@link nodeKindLabel}. */
export function nodeKindBlurb(meta: NodeKindMeta, t: EvermindBuildTranslator): string {
  const slug = I18N_NODE_KIND_SLUG[meta.kind];
  return slug ? t(`nodeKind.${slug}.blurb`) : meta.blurb;
}
