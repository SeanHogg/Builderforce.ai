/**
 * The one conversion from a registered {@link BrainAction} to the OpenAI `tools[]` entry
 * the model is shown.
 *
 * It lived inline in the React actions registry, which was fine while the registry was
 * the only thing that ever needed it. It no longer is: a headless runner (the VS Code
 * probe, the offline scenario harness) assembles the same action list and must advertise
 * it identically — a second copy of this mapping would be a second definition of what
 * the model can see, which is the single fact those runners exist to reproduce.
 *
 * Type-only import of `BrainAction`, so nothing here pulls React into a Node process.
 */

import type { BrainAction } from './BrainActionsContext';
import type { BrainToolSpec } from './streamChatCompletion';

/** Advertise these actions to the model. Order is preserved. */
export function toolSpecsFor(actions: readonly BrainAction[]): BrainToolSpec[] {
  return actions.map((action) => ({
    type: 'function' as const,
    function: {
      name: action.name,
      description: action.description,
      parameters: action.parameters,
    },
  }));
}
