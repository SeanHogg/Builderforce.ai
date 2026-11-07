import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GATEWAY_WORKSPACE_HEADER,
  classifyWorkspaceRefusal,
  gatewayAuthHeaders,
  observeGatewayResponse,
  onWorkspaceRefused,
  workspaceHeaderFor,
} from "./gatewayAuth";
import { setCurrentWorkspace } from "./workspaceSelection";

describe("gateway workspace header", () => {
  beforeEach(() => setCurrentWorkspace(undefined));

  it("is absent when no workspace is known (signed out)", () => {
    expect(gatewayAuthHeaders("bfk_x")).toEqual({ authorization: "Bearer bfk_x" });
  });

  it("names the current workspace, keeping the key as the credential", () => {
    setCurrentWorkspace(77);
    expect(gatewayAuthHeaders("bfk_x", { accept: "text/event-stream" })).toEqual({
      accept: "text/event-stream",
      authorization: "Bearer bfk_x",
      [GATEWAY_WORKSPACE_HEADER]: "77",
    });
  });

  it("an explicit workspace overrides the current one (a queued write replaying)", () => {
    setCurrentWorkspace(99);
    expect(gatewayAuthHeaders("bfk_x", {}, 77)).toEqual({
      authorization: "Bearer bfk_x",
      [GATEWAY_WORKSPACE_HEADER]: "77",
    });
  });

  it("workspaceHeaderFor is empty for an unknown workspace", () => {
    expect(workspaceHeaderFor(undefined)).toEqual({});
  });
});

describe("workspace refusal classifier", () => {
  it("tells the two refusals apart by code, only on a 403", () => {
    expect(classifyWorkspaceRefusal(403, { code: "editor_key_required" })).toBe("editor_key_required");
    expect(classifyWorkspaceRefusal(403, { code: "workspace_not_member" })).toBe("workspace_not_member");
    expect(classifyWorkspaceRefusal(403, { code: "origin_not_authorized" })).toBeNull();
    expect(classifyWorkspaceRefusal(401, { code: "workspace_not_member" })).toBeNull();
    expect(classifyWorkspaceRefusal(403, "workspace_not_member")).toBeNull();
    expect(classifyWorkspaceRefusal(403, null)).toBeNull();
  });

  it("observeGatewayResponse fires listeners with the refusal and the refused key, leaving the body readable", async () => {
    const listener = vi.fn();
    const off = onWorkspaceRefused(listener);
    const sent = { authorization: "Bearer bfk_a", [GATEWAY_WORKSPACE_HEADER]: "7" };
    const res = observeGatewayResponse(
      new Response(JSON.stringify({ error: "x", code: "workspace_not_member" }), { status: 403 }),
      sent,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listener).toHaveBeenCalledWith({ refusal: "workspace_not_member", key: "bfk_a", workspace: 7 });
    expect(await res.json()).toEqual({ error: "x", code: "workspace_not_member" });

    observeGatewayResponse(new Response(JSON.stringify({ code: "other" }), { status: 403 }), sent);
    observeGatewayResponse(new Response("{}", { status: 200 }), sent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });
});

describe("run-outcomes sender", () => {
  it("names the workspace the outcome was QUEUED in, not the current selection", () => {
    const gateway = readFileSync(join(__dirname, "gateway.ts"), "utf8");
    expect(gateway).toMatch(/gatewayAuthHeaders\(key,[^)]*\{[^)]*\},\s*scopeTenantId\(ctx\.scope\)\)/);
  });
});
