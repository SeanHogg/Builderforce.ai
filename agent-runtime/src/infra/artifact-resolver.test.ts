import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTaskArtifacts } from "./artifact-resolver.js";

const BASE_OPTS = { baseUrl: "https://api.test.com", agentNodeId: "42", apiKey: "testkey" };

describe("artifact-resolver", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns resolved artifacts when fetch succeeds", async () => {
    const mockResolved = {
      skills: [
        {
          artifactType: "skill",
          artifactSlug: "code-review",
          scope: "agentNode",
          scopeId: 42,
          config: null,
        },
      ],
      personas: [],
      content: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResolved,
      }),
    );
    const result = await resolveTaskArtifacts(BASE_OPTS, { projectId: 1 });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]?.artifactSlug).toBe("code-review");
  });

  it("returns empty sets on fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const result = await resolveTaskArtifacts(BASE_OPTS, {});
    expect(result.skills).toHaveLength(0);
    expect(result.personas).toHaveLength(0);
    expect(result.content).toHaveLength(0);
  });

  it("passes taskId and projectId as query params", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ skills: [], personas: [], content: [] }),
      }),
    );
    await resolveTaskArtifacts(BASE_OPTS, { taskId: 10, projectId: 5 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calledUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("taskId=10");
    expect(calledUrl).toContain("projectId=5");
  });
});
