import { afterEach, describe, expect, it } from "vitest";
import { createNativeStream } from "./nativeBrainRun";
import { GATEWAY_WORKSPACE_HEADER, gatewayWorkspaceHeaders } from "./gatewayAuth";
import { setCurrentWorkspace } from "./workspaceSelection";

describe("the native stream names the workspace", () => {
  afterEach(() => setCurrentWorkspace(undefined));

  const run = async () => {
    const seen: Array<Record<string, string>> = [];
    const stream = createNativeStream(
      "https://gateway.test",
      "key-123",
      async (_input, init) => {
        seen.push(init.headers as Record<string, string>);
        return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
      },
      gatewayWorkspaceHeaders,
    );
    await stream({ messages: [{ role: "user", content: "hi" }] });
    return seen;
  };

  it("sends x-builderforce-workspace for the CURRENT workspace, read per request", async () => {
    setCurrentWorkspace(77);
    const seen = await run();
    expect(seen[0]?.[GATEWAY_WORKSPACE_HEADER]).toBe("77");
    expect(seen[0]?.Authorization).toBe("Bearer key-123");

    setCurrentWorkspace(88);
    expect((await run())[0]?.[GATEWAY_WORKSPACE_HEADER]).toBe("88");
  });

  it("sends no workspace header when none is known", async () => {
    expect((await run())[0]?.[GATEWAY_WORKSPACE_HEADER]).toBeUndefined();
  });
});
