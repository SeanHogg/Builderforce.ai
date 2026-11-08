/**
 * THE capability source (PRD 41 Part A1/A2): one pure derivation of what this install can do
 * from what the platform policy allows and whether a session exists. Commands, views
 * (`capabilityContextKeys` -> `package.json` `when`), the knowledge host (`workspaceLinked`), the
 * workspace init / session frames and the personality limbic (`networkDenied`) all read THIS, so
 * none of them can disagree. No `vscode` import, so a webview imports it too: the webview realm's
 * ONE read is `useCapability(id)` (`webview/src/useCapability.ts`), fed by the host's pushed policy.
 *
 * Capability states, not a login gate: understanding a folder, the visualizer, health and
 * Evermind need no account and no network. `account` and `sync` are the only states that do.
 */

export const CAPABILITY_IDS = ["understand", "visualizer", "health", "evermind", "localRuns", "account", "sync", "network", "connected"] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** What the states are derived from: the session, and the platform policy's traffic-carrying grants. */
export interface CapabilityInputs {
  signedIn: boolean;
  synchronize: boolean;
  gatewayInference: boolean;
  connectedFeatures: boolean;
}

export type CapabilityStates = Readonly<Record<CapabilityId, boolean>>;

/** True when no platform capability that carries traffic is granted: nothing may be attempted. */
export function networkDenied(inputs: Pick<CapabilityInputs, "synchronize" | "gatewayInference" | "connectedFeatures">): boolean {
  return !inputs.synchronize && !inputs.gatewayInference && !inputs.connectedFeatures;
}

export function capabilityStates(inputs: CapabilityInputs): CapabilityStates {
  return {
    // Local by construction: shipped in the VSIX, no account, no network.
    understand: true,
    visualizer: true,
    health: true,
    evermind: true,
    localRuns: true,
    account: inputs.signedIn,
    sync: inputs.signedIn && inputs.synchronize,
    network: !networkDenied(inputs),
    // Server-backed features (the `@`/`#` rosters): the connected-features grant specifically.
    connected: inputs.connectedFeatures,
  };
}

/** `builderforce.capability.<id>` context keys for the states, as `setContext` takes them. */
export function capabilityContextKeys(states: CapabilityStates): Record<string, boolean> {
  const keys: Record<string, boolean> = {};
  for (const id of CAPABILITY_IDS) keys[`builderforce.capability.${id}`] = states[id];
  return keys;
}

/**
 * A2: a workspace is linked to its project only when a project is selected, a session exists AND
 * `synchronize` is granted. A selection made signed out is a pending binding, not a link.
 */
export function workspaceLinked(input: { hasProject: boolean; signedIn: boolean; synchronize: boolean }): boolean {
  return input.hasProject && input.signedIn && input.synchronize;
}
