import { describe, expect, it } from "vitest";
import { initFrameAuth } from "./initFrameAuth";

const base = { signedIn: true, token: "jwt", tenantId: 7, routeDegraded: false, model: undefined };

describe("initFrameAuth", () => {
  it("sends the token and the tenant it is for", () => {
    expect(initFrameAuth(base)).toEqual({ token: "jwt", tenantId: 7 });
  });

  it("OMITS the token key when signed in with none yet (degraded frame)", () => {
    const frame = initFrameAuth({ ...base, token: null });
    expect("token" in frame).toBe(false);
    expect(frame.tenantId).toBe(7);
  });

  it("sends an explicit null when signed out", () => {
    expect(initFrameAuth({ ...base, signedIn: false, token: null })).toEqual({ token: null, tenantId: 7 });
  });

  it("omits the tenant before the first mint", () => {
    expect("tenantId" in initFrameAuth({ ...base, tenantId: undefined })).toBe(false);
  });

  it("flags localPick only for a degraded route whose saved pick is client-pinned", () => {
    const pinned = "direct/kimi-code/k3";
    expect(initFrameAuth({ ...base, token: null, routeDegraded: true, model: pinned }).localPick).toBe(true);
    expect(initFrameAuth({ ...base, token: null, routeDegraded: false, model: pinned }).localPick).toBeUndefined();
    expect(initFrameAuth({ ...base, token: null, routeDegraded: true, model: "anthropic/claude" }).localPick).toBeUndefined();
  });
});
