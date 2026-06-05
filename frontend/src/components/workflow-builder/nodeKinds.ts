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
}

export type NodeGroup = 'Trigger' | 'LLM Logic' | 'ETL' | 'Agent' | 'Output';

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
      { key: 'triggerType', label: 'Trigger type', type: 'select', options: ['manual', 'webhook', 'schedule', 'board-event'] },
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
    kind: 'train',
    label: 'Train',
    icon: '🎓',
    group: 'LLM Logic',
    accent: '#00e5cc',
    blurb: 'Kick a MambaKit/SSMjs training run → hippocampus model.',
    defaultConfig: { model: '', dataset: '', epochs: 1 },
    fields: [
      { key: 'model', label: 'Model name', type: 'text', placeholder: 'Output model name' },
      { key: 'dataset', label: 'Dataset', type: 'text', placeholder: 'Dataset ref / path' },
      { key: 'epochs', label: 'Epochs', type: 'number' },
    ],
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

export const NODE_GROUPS: NodeGroup[] = ['Trigger', 'LLM Logic', 'Agent', 'ETL', 'Output'];
