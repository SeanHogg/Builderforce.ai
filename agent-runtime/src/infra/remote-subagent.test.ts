import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchChunkToRemoteAgentNode,
  dispatchResultToRemoteAgentNode,
} from "./remote-subagent.js";

const opts = {
  baseUrl: "https://api.example.test",
  myAgentNodeId: "1",
  apiKey: "k",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("dispatchChunkToRemoteAgentNode", () => {
  it("POSTs remote.task.chunk to the callback /forward door", async () => {
    const fetchMock = mockFetchOk();
    await dispatchChunkToRemoteAgentNode(opts, "9", "corr-1", "Hel");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.test/api/agent-hosts/9/forward");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      type: "remote.task.chunk",
      correlationId: "corr-1",
      chunk: "Hel",
      fromAgentNodeId: "1",
    });
    expect(typeof body.timestamp).toBe("string");
  });

  it("skips empty chunks", async () => {
    const fetchMock = mockFetchOk();
    await dispatchChunkToRemoteAgentNode(opts, "9", "corr-1", "");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("dispatchResultToRemoteAgentNode", () => {
  it("POSTs remote.task.result to the same /forward door", async () => {
    const fetchMock = mockFetchOk();
    await dispatchResultToRemoteAgentNode(opts, "9", "corr-1", "Hello world");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      type: "remote.task.result",
      correlationId: "corr-1",
      result: "Hello world",
      fromAgentNodeId: "1",
    });
  });
});
