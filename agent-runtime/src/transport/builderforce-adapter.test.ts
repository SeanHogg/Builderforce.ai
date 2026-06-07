/**
 * Tests for Builderforce transport adapter
 *
 * Uses fetch mocking (no real network calls) to verify:
 *  - execution submission maps fields correctly
 *  - task state polling / streaming
 *  - cancellation
 *  - agent and skill listing
 *  - error and close handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BuilderforceTransportAdapter } from "./builderforce-adapter.js";
import type { BuilderforceConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = "http://localhost:8000";
const EXECUTION_ID = 101;

const config: BuilderforceConfig = {
  baseUrl: BASE_URL,
  authToken: "tenant-jwt",
  agentNodeId: 42,
  userId: "test-user",
  deviceId: "test-device",
  pollIntervalMs: 10, // fast for tests
  timeoutMs: 5000,
};

function makeExecutionResponse(status: string, overrides?: Record<string, unknown>) {
  return {
    id: EXECUTION_ID,
    taskId: 77,
    agentId: 5,
    agentNodeId: 42,
    tenantId: 9,
    submittedBy: "user-1",
    sessionId: "sess-1",
    status,
    payload: "input",
    result: status === "completed" ? "done" : null,
    errorMessage: null,
    startedAt: status === "running" || status === "completed" ? new Date().toISOString() : null,
    completedAt: status === "completed" ? new Date().toISOString() : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a fetch mock that returns the given bodies in sequence. */
function mockFetchSequence(bodies: unknown[]) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const body = bodies[call++] ?? bodies[bodies.length - 1];
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BuilderforceTransportAdapter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = mockFetchSequence([makeExecutionResponse("pending")]);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  describe("connect", () => {
    it("is a no-op for stateless runtime API", async () => {
      const adapter = new BuilderforceTransportAdapter(config);
      await adapter.connect();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("remains idempotent on repeated calls", async () => {
      const adapter = new BuilderforceTransportAdapter(config);
      await adapter.connect();
      await adapter.connect();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("fetchNextQueuedTask", () => {
    it("returns null when server reports no task", async () => {
      fetchMock = mockFetchSequence([{ task: null }]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BuilderforceTransportAdapter(config);
      const result = await adapter.fetchNextQueuedTask?.();
      expect(result).toBeNull();
      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/tasks/next`, {
        method: "POST",
        headers: expect.any(Object),
        signal: expect.any(AbortSignal),
      });
    });

    it("maps a returned task into a TaskState-like object", async () => {
      const fakeTask = { id: "123", status: "todo", projectId: "1", priority: "high" };
      fetchMock = mockFetchSequence([{ task: fakeTask }]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BuilderforceTransportAdapter(config);
      const state = await adapter.fetchNextQueuedTask?.();
      expect(state).not.toBeNull();
      expect(state?.id).toBe("123");
      expect(state?.metadata?.projectId).toBe("1");
    });
  });

  // -------------------------------------------------------------------------
  describe("submitTask", () => {
    it("submits a task and maps the response to TaskState", async () => {
      fetchMock = mockFetchSequence([makeExecutionResponse("submitted")]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BuilderforceTransportAdapter(config);
      const state = await adapter.submitTask({
        agentId: "5",
        description: "Build login feature",
        input: "Create a login component",
        sessionId: "sess-1",
        model: "claude-opus-4",
        metadata: { taskId: 77, project: "my-app" },
      });

      expect(state.id).toBe(String(EXECUTION_ID));
      expect(state.status).toBe("pending");
      expect(state.sessionId).toBe("sess-1");
      expect(state.metadata?.taskId).toBe(77);
      expect(state.metadata?.agentNodeId).toBe(42);

      const [submitUrl, submitInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(submitUrl).toContain("/api/runtime/executions");
      const body = JSON.parse(submitInit.body as string);
      expect(body.taskId).toBe(77);
      expect(body.agentId).toBe(5);
      expect(body.agentNodeId).toBe(42);
      expect(body.sessionId).toBe("sess-1");
      expect(body.payload).toBe("Create a login component");

      const headers = submitInit.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tenant-jwt");
    });

    it("throws when metadata.taskId is missing", async () => {
      fetchMock = mockFetchSequence([makeExecutionResponse("running")]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BuilderforceTransportAdapter(config);
      await expect(
        adapter.submitTask({
          description: "test",
          input: "test input",
          metadata: {},
        }),
      ).rejects.toThrow("metadata.taskId");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("queryTaskState", () => {
    it("returns task state from Builderforce", async () => {
      fetchMock = mockFetchSequence([makeExecutionResponse("completed")]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BuilderforceTransportAdapter(config);
      const state = await adapter.queryTaskState(String(EXECUTION_ID));

      expect(state).not.toBeNull();
      expect(state!.status).toBe("completed");
      expect(state!.progress).toBe(100);
      expect(state!.output).toBe("done");
    });

    it("returns null when Builderforce responds with an error", async () => {
      fetchMock = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve("Not found"),
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BuilderforceTransportAdapter(config);
      const state = await adapter.queryTaskState("nonexistent-task");
      expect(state).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("streamTaskUpdates", () => {
    it("polls until task reaches a terminal state and yields status changes", async () => {
      const responses = [
        makeExecutionResponse("running"),
        makeExecutionResponse("running"), // same — no yield
        makeExecutionResponse("completed"),
      ];
      fetchMock = mockFetchSequence(responses);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BuilderforceTransportAdapter(config);

      const events = [];
      for await (const event of adapter.streamTaskUpdates(String(EXECUTION_ID))) {
        events.push(event);
      }

      // Should yield "running" (first change) and "completed" (terminal)
      expect(events).toHaveLength(2);
      expect(events[0].status).toBe("running");
      expect(events[1].status).toBe("completed");
      expect(events[1].progress).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  describe("cancelTask", () => {
    it("returns true when Builderforce confirms cancellation", async () => {
      fetchMock = mockFetchSequence([makeExecutionResponse("cancelled")]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BuilderforceTransportAdapter(config);
      const result = await adapter.cancelTask(String(EXECUTION_ID));

      expect(result).toBe(true);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/api/runtime/executions/${EXECUTION_ID}/cancel`);
    });

    it("returns false on network error", async () => {
      fetchMock = vi.fn().mockImplementation(() => {
        return Promise.reject(new Error("Network error"));
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BuilderforceTransportAdapter(config);
      const result = await adapter.cancelTask(String(EXECUTION_ID));
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("listAgents", () => {
    it("maps Builderforce agent_type to BuilderForceAgents AgentInfo id", async () => {
      const agents = [
        {
          agent_type: "claude",
          name: "Claude",
          description: "Anthropic Claude",
          available: true,
          capabilities: ["code"],
        },
        {
          agent_type: "ollama",
          name: "Ollama",
          description: "Local LLM",
          available: false,
          capabilities: ["code"],
        },
      ];
      fetchMock = mockFetchSequence([agents]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BuilderforceTransportAdapter(config);
      const result = await adapter.listAgents();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("claude");
      expect(result[0].name).toBe("Claude");
      expect(result[0].capabilities).toContain("code");
      expect(result[1].id).toBe("ollama");
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/agents");
    });
  });

  // -------------------------------------------------------------------------
  describe("listSkills", () => {
    it("maps Builderforce skill_id to BuilderForceAgents SkillInfo id", async () => {
      const skills = [
        {
          skill_id: "github-pr",
          name: "GitHub PR",
          description: "Create PRs",
          required_permissions: ["project:write"],
        },
      ];
      fetchMock = mockFetchSequence([skills]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BuilderforceTransportAdapter(config);
      const result = await adapter.listSkills();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("github-pr");
      expect(result[0].enabled).toBe(true);
      expect(result[0].version).toBe("1.0.0");

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/agent-hosts/42/skills");
    });
  });

  // -------------------------------------------------------------------------
  describe("close", () => {
    it("is a no-op", async () => {
      fetchMock = mockFetchSequence([makeExecutionResponse("pending")]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BuilderforceTransportAdapter(config);
      await adapter.close();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
