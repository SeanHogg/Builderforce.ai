import type { WorkflowNodeKind } from '@/lib/builderforceApi';
import { CONNECT_STEP_KINDS } from './stepKinds/connect';
import { EVERMIND_STEP_KINDS } from './stepKinds/evermind';
import { FLOW_CONTROL_STEP_KINDS } from './stepKinds/flowControl';
import { TEXT_PARSER_STEP_KINDS } from './stepKinds/textParser';
import { TOOL_STEP_KINDS } from './stepKinds/tools';
import { OUTPUT_STEP_KINDS } from './stepKinds/output';

/**
 * THE STEP CATALOG — one vocabulary of executable steps, for every surface.
 *
 * Each kind declares its default label/config and the typed fields the config
 * editor renders. Keeping it here means the palette, the node renderer, and the
 * config editor all agree on one vocabulary, and adding a step kind is a single
 * edit.
 *
 * ── WHY IT LIVES IN THE DOMAIN AND NOT IN `components/workflow-builder/` ─────
 * It used to be `components/workflow-builder/nodeKinds.ts`, which was true while
 * exactly one surface placed a step: the standalone builder. The Creation Canvas
 * now places steps DIRECTLY — a `flowStep` object is one of these kinds — so the
 * catalog is read by two presentation trees plus the compiler that lowers a board
 * into a runnable definition. A module three consumers share cannot live inside
 * one of them: the canvas would be importing sideways out of another component
 * folder, and the compiler (domain) would be importing upward out of
 * presentation, which is the inversion the architecture rules exist to stop.
 *
 * There is deliberately no second catalog for the canvas. "One set of components,
 * reusable in the apps and products users create" is the whole point: a step kind
 * added here appears in the builder palette, in the canvas object picker, on the
 * marketing page's catalog, and in the compiler, without any of them being edited.
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

/**
 * THE CATALOG, ASSEMBLED.
 *
 * The declarations live one family per file under `stepKinds/` — the same families the
 * palette groups by and the 3D badge names — because a single array of ~60 entries was
 * the largest module in the tree and every new step edited the same thousand lines.
 * Order matters only in that it is the order a reader meets them; the palette sorts by
 * `NODE_GROUPS` and the pickers search across all of it.
 */
export const NODE_KINDS: NodeKindMeta[] = [
  ...CONNECT_STEP_KINDS,
  ...EVERMIND_STEP_KINDS,
  ...FLOW_CONTROL_STEP_KINDS,
  ...TEXT_PARSER_STEP_KINDS,
  ...TOOL_STEP_KINDS,
  ...OUTPUT_STEP_KINDS,
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
 * The i18n slug for EVERY node kind.
 *
 * It used to cover only the kinds added alongside Flow Control / Tools / Text
 * Parser / Diagnostics, and the ~30 older kinds rendered their catalog literal
 * through a `??` fallback — so a French operator's palette named half its steps
 * in French and the other half in English, and the 3D card sublabel and the
 * config panel inherited the same split.
 *
 * The map is now TOTAL, which is the point: the fallback in
 * {@link nodeKindLabel} / {@link nodeKindBlurb} is unreachable, so a kind added
 * without a translation shows a raw key (visible, fixable) rather than silently
 * shipping English into four locales.
 *
 * The catalog keeps its English `label` / `blurb` as the DEFAULT node title a
 * dropped node is created with — that is stored workflow data, not UI copy.
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
  trigger: 'trigger',
  agent: 'agent',
  memory: 'memory',
  knowledge: 'knowledge',
  llm: 'llm',
  mcp: 'mcp',
  connector: 'connector',
  gmail: 'gmail',
  train: 'train',
  'train-tokenizer': 'trainTokenizer',
  'dataset-quality': 'datasetQuality',
  'train-model': 'trainModel',
  convergence: 'convergence',
  evaluate: 'evaluate',
  'generate-check': 'generateCheck',
  benchmark: 'benchmark',
  roundtrip: 'roundtrip',
  export: 'export',
  'distill-corpus': 'distillCorpus',
  'code-parse-check': 'codeParseCheck',
  'code-eval': 'codeEval',
  'code-benchmark': 'codeBenchmark',
  transform: 'transform',
  filter: 'filter',
  branch: 'branch',
  output: 'output',
};

/** A translator over the `evermindBuild` namespace — `useTranslations('evermindBuild')`'s
 *  return type, accepting an arbitrary key (the catalog builds keys dynamically). */
type EvermindBuildTranslator = (key: string) => string;

/** The label to show for a node kind, in the reader's locale. THE accessor —
 *  the palette, the flat node, the 3D card and the config panel all read here,
 *  so a step is named the same thing on every surface and in every language. */
export function nodeKindLabel(meta: NodeKindMeta, t: EvermindBuildTranslator): string {
  const slug = I18N_NODE_KIND_SLUG[meta.kind];
  return slug ? t(`nodeKind.${slug}.label`) : meta.label;
}

/** The blurb (tooltip / inspector subtitle) for a node kind — same accessor
 *  rule as {@link nodeKindLabel}. */
export function nodeKindBlurb(meta: NodeKindMeta, t: EvermindBuildTranslator): string {
  const slug = I18N_NODE_KIND_SLUG[meta.kind];
  return slug ? t(`nodeKind.${slug}.blurb`) : meta.blurb;
}

/**
 * A short one-line summary of a step's key config, shown under its title.
 *
 * ── WHY IT LIVES IN THE CATALOG ──────────────────────────────────────────────
 * Four surfaces now say what a step is CONFIGURED to do: the builder's flat node,
 * the 3D reading of the same graph, the canvas card, and the canvas inspector.
 * Two summaries of one step read as two steps, and the knowledge involved — that
 * `connector` is identified by connector+action and `llm` by provider+model — is
 * the catalog's, not any one renderer's. It was exported from `BuilderNode.tsx`
 * while only that file's two readers needed it; a canvas card importing a summary
 * out of another component tree is how the second copy gets written instead.
 */
export function configSummary(kind: WorkflowNodeKind, config: Record<string, unknown>): string {
  switch (kind) {
    case 'agent':
      return [config.role, config.runtime].filter(Boolean).join(' · ') || 'agent';
    case 'llm':
      return [config.provider, config.model].filter(Boolean).join(' · ') || 'llm';
    case 'mcp':
      return [config.integration, config.operation].filter(Boolean).join(' · ') || 'tool';
    case 'connector':
      // Reads as "twilio · send_sms" on the canvas — which integration and which
      // action is the whole identity of this node.
      return [config.connector, config.action].filter(Boolean).join(' · ') || 'integration';
    case 'memory':
      return `${String(config.op ?? 'recall')}${config.query ? ` · ${String(config.query).slice(0, 24)}` : ''}`;
    case 'knowledge':
      return `${String(config.op ?? 'query')}${config.namespace ? ` · ${String(config.namespace)}` : ''}`;
    case 'train':
      return String(config.model || 'model');
    case 'trigger':
      return String(config.triggerType ?? 'manual');
    case 'output':
      return String(config.target ?? 'artifact');
    case 'router':
      return String(config.fallback ? `→ ${config.fallback}` : 'routes');
    case 'switch':
      return String(config.field ? `on ${config.field}` : 'switch');
    case 'iterator':
      return 'per array item';
    case 'merge':
      return String(config.strategy ?? 'array');
    case 'numeric-aggregator':
      return String(config.op ?? 'sum');
    case 'table-aggregator':
      return 'rows';
    case 'text-aggregator':
      return `sep: ${JSON.stringify(String(config.separator ?? '\n'))}`;
    case 'set-variable':
    case 'get-variable':
    case 'increment':
      return String(config.key ?? '');
    case 'set-variables':
      return 'multiple';
    case 'get-variables':
      return String(config.keys ?? '');
    case 'sleep':
      return `${String(config.seconds ?? 0)}s`;
    case 'compose-string':
      return String(config.template ?? '{{input}}');
    case 'convert-encoding':
      return String(config.mode ?? 'base64-encode');
    case 'regex-match':
    case 'match-pattern-advanced':
      return String(config.pattern ?? '');
    case 'html-elements':
    case 'match-elements':
      return `<${String(config.tag ?? '')}>`;
    case 'replace':
      return String(config.pattern ?? '');
    case 'chunk-text':
      return `${String(config.chunkSize ?? 1000)} chars`;
    case 'assert':
      return String(config.expression ?? '');
    case 'healthcheck':
      return String(config.url ?? '');
    case 'web-search':
      return String(config.query ?? '{{input}}');
    case 'web-fetch':
      return String(config.url ?? '');
    case 'google-drive':
      return String(config.operation ?? 'search');
    case 'analyze-image':
      return String(config.url ?? '{{input}}');
    case 'extract-document-data':
      return String(config.fields ?? 'all fields');
    case 'transcribe-audio':
      return `${config.mode === 'translate' ? 'translate' : 'transcribe'}`;
    default:
      return '';
  }
}
