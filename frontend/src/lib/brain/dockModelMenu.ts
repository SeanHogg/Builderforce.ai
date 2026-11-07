import { requestComposerMenu } from '@seanhogg/builderforce-brain-ui';

/**
 * "Open the Brain dock's model menu" for a caller that is NOT inside the dock (a canvas
 * comment's translator hint). The dock's panel registers its composer id while mounted;
 * if the dock has to be opened first, the request waits for that registration.
 */
let dockComposerId: string | null = null;
let pending = false;

export function registerDockComposer(id: string): () => void {
  dockComposerId = id;
  if (pending) { pending = false; requestComposerMenu(id, 'model'); }
  return () => { if (dockComposerId === id) dockComposerId = null; };
}

/** Ask the dock composer's model tab to open; returns true when it was already mounted. */
export function requestDockModelMenu(): boolean {
  if (dockComposerId) { requestComposerMenu(dockComposerId, 'model'); return true; }
  pending = true;
  return false;
}
