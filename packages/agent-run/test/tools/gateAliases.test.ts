/**
 * A gate judges the tool that will RUN, not the word the model wrote. The registry resolves hallucinated names (`shell`,
 * `create_file`, `str_replace`, `delete`, any case) to the catalog tool before it looks the tool up, so a registry surface (tickets, cloud)
 * would run a command or write a file under a spelling the gate never named. These drive real model calls through `runAgent` and the
 * registry, and read what the provider was actually asked to do.
 */
import { describe, expect, it } from "vitest";
import type { Capability, PolicyGate } from "@builderforce/agent-tools";
import { runAgent, type ModelCompletion, type RunEvent, type RunPorts } from "../../src/index.js";
import { TEST_POLICY, TEST_TASK } from "../support/policyContext.js";

function run(call: { name: string; args: Record<string, unknown> }, gates: PolicyGate[]) {
  const script: ModelCompletion[] = [{ content: "", toolCalls: [{ id: "c1", name: call.name, arguments: JSON.stringify(call.args) }] }, { content: "fin" }];
  let n = 0;
  const events: RunEvent[] = [];
  const did: string[] = [];
  const ports: RunPorts = {
    model: { complete: async () => script[n++]! },
    capabilities: {
      capabilities: new Set<Capability>(["repo.write", "repo.read", "repo.delete", "repo.exec"] as Capability[]),
      repoRead: {
        listFiles: async () => ({ ok: true, paths: [] }),
        readFile: async (path: string) => ({ ok: true, path, content: "x" }),
        searchCode: async (query: string) => ({ ok: true, query, total: 0, matches: [] }),
      },
      repoWrite: {
        writeFile: async (path: string) => {
          did.push(`write:${path}`);
          return { ok: true };
        },
        editFile: async (path: string) => {
          did.push(`edit:${path}`);
          return { ok: true };
        },
        deleteFile: async (path: string) => {
          did.push(`delete:${path}`);
          return { ok: true, deleted: true };
        },
      },
      exec: {
        run: async (command: string) => {
          did.push(`exec:${command}`);
          return { ok: true, stdout: "", stderr: "", exitCode: 0 };
        },
      },
    } as unknown as RunPorts["capabilities"],
    store: { load: () => undefined, save: () => undefined },
    events: { emit: (event) => void events.push(event) },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
  return runAgent({ task: TEST_TASK, policy: { ...TEST_POLICY, approvalGates: gates }, ports }).then(() => ({ did, events }));
}

const EXEC_BLOCK: PolicyGate[] = [{ id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" }];
const SECRETS_BLOCK: PolicyGate[] = [{ id: "no-secrets", tool: "write_file", effect: "block", paths: ["secrets/**"], reason: "secrets" }];
const refused = (events: RunEvent[], gateId: string) => events.some((e) => e.kind === "policy.blocked" && e.gateId === gateId);

describe("a shell tool under any spelling is judged as exec", () => {
  for (const name of ["shell", "execute_command", "run_terminal_cmd", "run_shell_command", "bash", "Bash", "BASH", "Run_Command", "EXEC"]) {
    it(`${name}: refused by an exec block and never run`, async () => {
      const { did, events } = await run({ name, args: { command: "rm -rf /" } }, EXEC_BLOCK);
      expect(refused(events, "no-shell")).toBe(true);
      expect(did.filter((d) => d.startsWith("exec:"))).toEqual([]);
    });
  }
});

describe("a file tool under any spelling is judged as the tool it resolves to", () => {
  for (const name of ["create_file", "write_to_file", "Create_File", "WRITE_FILE"]) {
    it(`${name}: refused under a path-scoped write gate, nothing written`, async () => {
      const { did, events } = await run({ name, args: { path: "secrets/key.txt", content: "x" } }, SECRETS_BLOCK);
      expect(refused(events, "no-secrets")).toBe(true);
      expect(did).toEqual([]);
    });
  }

  for (const name of ["str_replace", "search_replace", "edit_file", "EDIT_FILE"]) {
    it(`${name}: an edit is a write, so the same write gate refuses it`, async () => {
      const { did, events } = await run({ name, args: { path: "secrets/key.txt", oldText: "a", newText: "b" } }, SECRETS_BLOCK);
      expect(refused(events, "no-secrets")).toBe(true);
      expect(did).toEqual([]);
    });
  }

  for (const name of ["delete", "delete_file", "DELETE"]) {
    it(`${name}: a delete is a write`, async () => {
      const { did, events } = await run({ name, args: { path: "secrets/key.txt" } }, SECRETS_BLOCK);
      expect(refused(events, "no-secrets")).toBe(true);
      expect(did).toEqual([]);
    });
  }

  it("control: the same aliases DO write when no gate stands in the way (so the refusals above are the gate's)", async () => {
    const { did } = await run({ name: "create_file", args: { path: "docs/a.md", content: "x" } }, SECRETS_BLOCK);
    expect(did).toEqual(["write:docs/a.md"]);
  });
});
