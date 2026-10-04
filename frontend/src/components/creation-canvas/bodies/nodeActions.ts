import { createContext, useContext } from 'react';
import type { CreationNodeActions } from './types';

/** A body rendered outside a card (a test, a preview) can do nothing to the board. */
const NO_ACTIONS: CreationNodeActions = Object.freeze({});

/**
 * The card's actions, provided ONCE by `CreationNode` around whichever body it draws.
 *
 * A context rather than props because the bodies are looked up from a registry and
 * share one narrow prop contract ({@link CreationBodyProps}); each body reads only the
 * actions it uses, and the ones that use none never subscribe to a change in them.
 */
export const CreationNodeActionsContext = createContext<CreationNodeActions>(NO_ACTIONS);

export function useCreationNodeActions(): CreationNodeActions {
  return useContext(CreationNodeActionsContext);
}
