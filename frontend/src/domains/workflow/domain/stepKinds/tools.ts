import type { NodeKindMeta } from '../stepCatalog';

/**
 * TOOLS & DIAGNOSTICS — assert, fetch, and read a file
 *
 * Steps that check something is true, reach the open web, or read a document, an image
 * or an audio file. The vision and transcription steps route through the tenant's own
 * model pool rather than pinning a vendor.
 *
 * One family per file, assembled by `stepCatalog.ts`. The catalog is ~60 declarations
 * and grows with the product; kept in one file it was the largest module in the tree
 * and every addition edited the same 1,000 lines. A family is a real seam — the palette
 * groups by it, the 3D badge names it, and a new step almost always joins an existing
 * one — so splitting here costs nothing and stops the file from being the place every
 * change collides.
 */
export const TOOL_STEP_KINDS: NodeKindMeta[] = [
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
];
