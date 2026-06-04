import { describe, expect, it } from "vitest";
import { mergeBuilderforceContext } from "./builderforce-context.js";

describe("mergeBuilderforceContext", () => {
  it("merges assignment snapshot, machine profile, and existing agentNode context", () => {
    const merged = mergeBuilderforceContext({
      existing: {
        instanceId: "12",
        instanceSlug: "dev-laptop",
        instanceName: "Dev Laptop",
        tenantId: 33,
        url: "https://api.builderforce.ai",
      },
      fallback: {
        instanceId: "12",
        url: "https://api.builderforce.ai",
      },
      machineProfile: {
        machineName: "DEVBOX",
        machineIp: "10.1.1.8",
        workspaceDirectory: "c:/repo/app",
        gatewayPort: 18789,
      },
      assignmentContext: {
        syncedAt: "2026-03-15T10:30:00.000Z",
        primaryProject: {
          id: 91,
          key: "BF-91",
          name: "Builderforce Runtime",
          rootWorkingDirectory: "c:/repo/app",
          directoryPath: "c:/repo/app/.builderforce",
          contextHints: {
            manifestFiles: [".builderforce/manifest.yaml"],
            prdFiles: ["docs/prds/runtime.md"],
            taskFiles: [".builderforce/tasks/backlog.md"],
            memoryFiles: [".builderforce/memory/decisions.md"],
          },
        },
        agentNode: {
          machineProfile: {
            tunnelUrl: "https://example-tunnel.ngrok.io",
            tunnelStatus: "connected",
          },
        },
      },
    });

    expect(merged.projectId).toBe("91");
    expect(merged.assignmentContext?.project?.key).toBe("BF-91");
    expect(merged.assignmentContext?.contextHints?.manifestFiles).toContain(
      ".builderforce/manifest.yaml",
    );
    expect(merged.machineProfile?.machineName).toBe("DEVBOX");
    expect(merged.machineProfile?.tunnelStatus).toBe("connected");
  });
});
