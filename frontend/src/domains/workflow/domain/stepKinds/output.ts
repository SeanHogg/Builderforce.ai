import type { NodeKindMeta } from '../stepCatalog';

/**
 * OUTPUT — the terminal step
 *
 * Where a finished flow puts what it produced.
 *
 * One family per file, assembled by `stepCatalog.ts`. The catalog is ~60 declarations
 * and grows with the product; kept in one file it was the largest module in the tree
 * and every addition edited the same 1,000 lines. A family is a real seam — the palette
 * groups by it, the 3D badge names it, and a new step almost always joins an existing
 * one — so splitting here costs nothing and stops the file from being the place every
 * change collides.
 */
export const OUTPUT_STEP_KINDS: NodeKindMeta[] = [
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
