/**
 * regression: the editor's lookup scope (typed-entity-ids §3). Signed out it is the unbound scope,
 * never "every destination"; signed in it names the platform instance, because a tenant id that
 * exists on staging and prod is two accounts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNBOUND_DESTINATION, inEntityScope } from "@builderforce/local-first";

const session = vi.hoisted(() => ({ tenantId: undefined as number | undefined, baseUrl: "https://api.builderforce.ai/v1" }));

vi.mock("./bfApi", () => ({
  workspaceTenantId: () => session.tenantId,
  createBrainChat: vi.fn(),
  listBrainChats: vi.fn(),
}));
vi.mock("./gateway", () => ({ getBaseUrl: () => session.baseUrl }));
vi.mock("./platformPolicy", () => ({ platformPolicy: () => ({ allows: () => true }) }));

import { activeEntityScope, chatAccountDestination } from "./chatAccount";

describe("activeEntityScope", () => {
  beforeEach(() => {
    session.tenantId = undefined;
    session.baseUrl = "https://api.builderforce.ai/v1";
  });

  it("signed out: the unbound scope, which matches no bound destination", () => {
    expect(activeEntityScope()).toEqual(UNBOUND_DESTINATION);
    expect(inEntityScope({ kind: "bound", platformInstance: "https://api.builderforce.ai", tenantId: "7" }, activeEntityScope())).toBe(false);
    expect(inEntityScope(UNBOUND_DESTINATION, activeEntityScope())).toBe(true);
  });

  it("signed in: the tenant on THIS platform instance, the same value a bound destination records", () => {
    session.tenantId = 7;
    const scope = activeEntityScope();
    expect(scope).toEqual({ tenantId: "7", platformInstance: "https://api.builderforce.ai" });
    expect(inEntityScope(chatAccountDestination()!, scope)).toBe(true);
    expect(inEntityScope({ kind: "bound", platformInstance: "https://staging.builderforce.ai", tenantId: "7" }, scope)).toBe(false);
  });

  it("signed in with an unreadable base URL: the tenant alone", () => {
    session.tenantId = 7;
    session.baseUrl = "not a url";
    expect(activeEntityScope()).toEqual({ tenantId: "7" });
  });
});
