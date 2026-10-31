import { describe, expect, it, vi } from "vitest";
import type { RunTask } from "@seanhogg/builderforce-brain-embedded";
import { vscodeBinding, type VsCodeRunHost } from "./vscodeAdapter";

/**
 * The editor's part of a run's binding (PRD 35 §4 WS4): the capability provider over the open
 * folder, the structured context pack, the memory commit. It only supplies facts and ports -
 * the run itself is driven by the one agent (`brain-embedded` `runViaAgent`, whose conformance
 * suite runs the same task through the real ports under the `vscode` label).
 */

const TASK: RunTask = { prompt: "fix README.md", chatId: 41, projectId: 7, dispatch: { source: "chat" } };

function host(over: Partial<VsCodeRunHost> = {}): VsCodeRunHost {
  return { root: "/workspace", runKey: 12, memory: true, ...over };
}

describe("vscodeBinding", () => {
  it("is the vscode surface, backed by the open folder: it can read, write and shell", () => {
    const binding = vscodeBinding(host());
    expect(binding.entryPoint).toBe("vscode");
    for (const capability of ["repo.read", "repo.write", "shell"] as const) {
      expect(binding.capabilities.capabilities.has(capability)).toBe(true);
    }
  });

  it("hands the agent the structured context pack the host builds, asked with the task's own facts", async () => {
    const structured = { focus: [{ path: "README.md", content: "# hi" }], facts: [{ key: "codemap:root", content: "map" }], recall: [] };
    const contextPack = vi.fn(async () => ({ block: "rendered", recallHint: "", structured }));

    const pack = await vscodeBinding(host({ contextPack })).gatherContext!(TASK);

    expect(pack).toEqual(structured);
    expect(contextPack).toHaveBeenCalledWith({ projectId: 7, serverChatId: 41, request: "fix README.md", memory: true });
  });

  it("offers no pack when the host builds none, so the agent starts from the served files alone", async () => {
    expect(await vscodeBinding(host()).gatherContext!(TASK)).toBeUndefined();
    const empty = vscodeBinding(host({ contextPack: async () => undefined }));
    expect(await empty.gatherContext!(TASK)).toBeUndefined();
  });

  it("passes the run-end commit, the outcome report and the governance gates through untouched", () => {
    const commitMemory = vi.fn();
    const reportOutcome = vi.fn();
    const approvalGates = [{ id: "g1", tool: "delete_file", effect: "require-approval" as const }];

    const binding = vscodeBinding(host({ commitMemory, reportOutcome, approvalGates }));

    expect(binding.commitMemory).toBe(commitMemory);
    expect(binding.reportOutcome).toBe(reportOutcome);
    expect(binding.approvalGates).toBe(approvalGates);
  });

  it("leaves out what the host did not supply", () => {
    const binding = vscodeBinding(host());
    expect(binding).not.toHaveProperty("commitMemory");
    expect(binding).not.toHaveProperty("reportOutcome");
    expect(binding).not.toHaveProperty("approvalGates");
  });
});
