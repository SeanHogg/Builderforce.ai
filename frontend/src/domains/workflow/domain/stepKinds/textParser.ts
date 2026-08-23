import type { NodeKindMeta } from '../stepCatalog';

/**
 * TEXT PARSER — pull structure out of text and HTML
 *
 * Everything that turns an unstructured blob into something the expression language can
 * address. No network, no model: purely local extraction.
 *
 * One family per file, assembled by `stepCatalog.ts`. The catalog is ~60 declarations
 * and grows with the product; kept in one file it was the largest module in the tree
 * and every addition edited the same 1,000 lines. A family is a real seam — the palette
 * groups by it, the 3D badge names it, and a new step almost always joins an existing
 * one — so splitting here costs nothing and stops the file from being the place every
 * change collides.
 */
export const TEXT_PARSER_STEP_KINDS: NodeKindMeta[] = [
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
];
