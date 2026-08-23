import type { NodeKindMeta } from '../stepCatalog';

/**
 * FLOW CONTROL — shape, route, gate, join, and remember
 *
 * Where the payload GOES and what it looks like on the way. `router`/`switch`/`branch`
 * are the ones with named outlets — see `stepOutlets.ts`, which is the only module that
 * parses their `routes`/`cases` config.
 *
 * One family per file, assembled by `stepCatalog.ts`. The catalog is ~60 declarations
 * and grows with the product; kept in one file it was the largest module in the tree
 * and every addition edited the same 1,000 lines. A family is a real seam — the palette
 * groups by it, the 3D badge names it, and a new step almost always joins an existing
 * one — so splitting here costs nothing and stops the file from being the place every
 * change collides.
 */
export const FLOW_CONTROL_STEP_KINDS: NodeKindMeta[] = [
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
];
