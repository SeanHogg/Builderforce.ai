import { useSyncExternalStore } from 'react';
import { capabilityStates, type CapabilityId } from '../../src/capabilityStates';
import { subscribeWebviewPolicy, webviewCapabilityInputs } from './platformPolicy';

/**
 * The ONE capability read in a webview (PRD 41 A1): the same pure derivation the host uses
 * (`src/capabilityStates.ts`), fed by the policy and session the host pushes. Components ask
 * "can this install do X?" here and never read the policy, the mode or the session themselves.
 */
export function webviewCapability(id: CapabilityId): boolean {
  return capabilityStates(webviewCapabilityInputs())[id];
}

/** Reactive: re-renders the moment a `platform.policy` or init frame flips the capability. */
export function useCapability(id: CapabilityId): boolean {
  const read = () => webviewCapability(id);
  return useSyncExternalStore(subscribeWebviewPolicy, read, read);
}
