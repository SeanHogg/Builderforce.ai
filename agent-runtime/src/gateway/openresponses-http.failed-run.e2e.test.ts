/**
 * A non-stream OpenResponses request whose run FAILED but said why as its reply (`meta.runFailed`, the channel runner's notice after a budget
 * or breaker stop) is a FAILED response carrying that account, not a completed one.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentCommand, getFreePort, installGatewayTestHooks } from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

const NOTICE = "The run ended without a reply: its tool calls were refused or failed. Governance gate no-shell refused some of its tool calls.";

let server: Awaited<ReturnType<typeof start>>;
let port: number;

async function start(p: number) {
  const { startGatewayServer } = await import("./server.js");
  return await startGatewayServer(p, { host: "127.0.0.1", auth: { mode: "token", token: "secret" }, controlUiEnabled: false, openResponsesEnabled: true });
}

beforeAll(async () => {
  port = await getFreePort();
  server = await start(port);
});
afterAll(async () => {
  await server.close({ reason: "openresponses failed-run suite done" });
});

async function respond(meta?: unknown) {
  agentCommand.mockReset();
  agentCommand.mockResolvedValueOnce({ payloads: [{ text: NOTICE }], meta } as never);
  const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer secret" },
    body: JSON.stringify({ model: "builderforce", input: "run the build" }),
  });
  return (await res.json()) as { status?: string; error?: { code?: string; message?: string }; output?: Array<{ content?: Array<{ text?: string }> }> };
}

describe("POST /v1/responses (non-stream)", () => {
  it("reports a run that failed and said why as FAILED, carrying the account", async () => {
    const body = await respond({ runFailed: true });

    expect(body.status).toBe("failed");
    expect(body.error).toEqual({ code: "run_failed", message: NOTICE });
    expect(body.output?.[0]?.content?.[0]?.text).toBe(NOTICE);
  });

  it("control: an ordinary run is completed", async () => {
    const body = await respond({});

    expect(body.status).toBe("completed");
    expect(body.error).toBeUndefined();
  });
});
