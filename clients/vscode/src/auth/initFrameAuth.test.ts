import { describe, expect, it } from "vitest";
import { initFrameAuth } from "./initFrameAuth";

const base = { signedIn: true, bound: { token: "jwt", tenantId: 7 }, workspaceTenantId: 7, routeDegraded: false, model: undefined };

describe("initFrameAuth", () => {
  it("sends the bound token and the tenant it is for", () => {
    expect(initFrameAuth(base)).toEqual({ token: "jwt", tenantId: 7 });
  });

  it("OMITS the token key when signed in with none bound yet (degraded frame)", () => {
    const frame = initFrameAuth({ ...base, bound: null });
    expect("token" in frame).toBe(false);
    expect(frame.tenantId).toBe(7);
  });

  it("a token minted for another tenant (parked re-scope) is a token-less frame still naming the workspace", () => {
    // boundToken() yields null for a key-tenant token while the workspace is B.
    const frame = initFrameAuth({ ...base, bound: null, workspaceTenantId: 9 });
    expect("token" in frame).toBe(false);
    expect(frame.tenantId).toBe(9);
  });

  it("sends an explicit null when signed out", () => {
    expect(initFrameAuth({ ...base, signedIn: false, bound: null })).toEqual({ token: null, tenantId: 7 });
  });

  it("omits the tenant before the first mint", () => {
    expect("tenantId" in initFrameAuth({ ...base, bound: null, workspaceTenantId: undefined })).toBe(false);
  });

  it("flags localPick only for a degraded route whose saved pick is client-pinned", () => {
    const pinned = "direct/kimi-code/k3";
    expect(initFrameAuth({ ...base, bound: null, routeDegraded: true, model: pinned }).localPick).toBe(true);
    expect(initFrameAuth({ ...base, bound: null, routeDegraded: false, model: pinned }).localPick).toBeUndefined();
    expect(initFrameAuth({ ...base, bound: null, routeDegraded: true, model: "anthropic/claude" }).localPick).toBeUndefined();
  });
});
