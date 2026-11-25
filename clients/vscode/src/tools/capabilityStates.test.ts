import { describe, expect, it } from "vitest";
import { CAPABILITY_IDS, capabilityContextKeys, capabilityStates, networkDenied, workspaceLinked, type CapabilityInputs } from "./capabilityStates";

const denied: CapabilityInputs = { signedIn: false, synchronize: false, gatewayInference: false, connectedFeatures: false };
const granted: CapabilityInputs = { signedIn: true, synchronize: true, gatewayInference: true, connectedFeatures: true };

describe("capability states (PRD 41 A1)", () => {
  it("signed out and offline: local capabilities on, account/sync/network off", () => {
    const s = capabilityStates(denied);
    expect(s).toMatchObject({ understand: true, visualizer: true, health: true, evermind: true, localRuns: true, account: false, sync: false, network: false });
  });

  it("signed in with sync off: account on, sync off", () => {
    const s = capabilityStates({ ...granted, synchronize: false });
    expect(s.account).toBe(true);
    expect(s.sync).toBe(false);
    expect(s.network).toBe(true);
  });

  it("sync needs a session AND the grant", () => {
    expect(capabilityStates({ ...denied, synchronize: true }).sync).toBe(false);
    expect(capabilityStates(granted).sync).toBe(true);
  });

  it("network is denied only when no traffic-carrying capability is granted", () => {
    expect(networkDenied(denied)).toBe(true);
    expect(networkDenied({ ...denied, connectedFeatures: true })).toBe(false);
    expect(networkDenied({ ...denied, gatewayInference: true })).toBe(false);
  });

  it("derives one builderforce.capability.<id> context key per capability", () => {
    const keys = capabilityContextKeys(capabilityStates(denied));
    expect(Object.keys(keys).sort()).toEqual(CAPABILITY_IDS.map((id) => `builderforce.capability.${id}`).sort());
    expect(keys["builderforce.capability.health"]).toBe(true);
    expect(keys["builderforce.capability.sync"]).toBe(false);
  });

  it("a workspace is linked only with a project, a session and the synchronize grant (A2)", () => {
    expect(workspaceLinked({ hasProject: true, signedIn: true, synchronize: true })).toBe(true);
    expect(workspaceLinked({ hasProject: true, signedIn: false, synchronize: true })).toBe(false);
    expect(workspaceLinked({ hasProject: true, signedIn: true, synchronize: false })).toBe(false);
    expect(workspaceLinked({ hasProject: false, signedIn: true, synchronize: true })).toBe(false);
  });
});
