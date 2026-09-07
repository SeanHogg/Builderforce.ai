import type { NodeKindMeta } from '../stepCatalog';

/**
 * COMPOSITION — one canvas, running inside another.
 *
 * A single declaration, and deliberately its own family file rather than a line
 * added to `flowControl.ts`: this is not a step that shapes or routes a payload,
 * it is the step that makes a canvas REUSABLE. It groups under Flow Control in the
 * palette because that is where an author looks for "and then run this whole other
 * thing", and a one-member group would be a heading rather than a family.
 *
 * No declared fields. Choosing a canvas means listing the ones this tenant has, and
 * the derived interface shown underneath is read off the child board itself — so it
 * brings its own editor (`SubflowNodeFields.tsx`), the same way `connector` does for
 * the same reason. See `domain/subflow.ts` for what the config means.
 */
export const COMPOSITION_STEP_KINDS: NodeKindMeta[] = [
  {
    kind: 'subflow',
    label: 'Run a canvas',
    icon: '🧩',
    group: 'Flow Control',
    accent: 'var(--purple-bright)',
    blurb: 'Run another canvas as one step — its flow, its inputs, its outputs. Snapshot freezes it into this build; Live resolves the child canvas fresh on every run.',
    defaultConfig: { canvasSessionId: '', binding: 'snapshot' },
    fields: [],
  },
];
