import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseComposerInput } from "@seanhogg/builderforce-brain-embedded/composerCommands";

vi.mock("vscode", () => ({
  l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)])) },
}));

import { composerCommandText } from "./labels";
import { fakeWorkspacePort, folderRef } from "./testWorkspacePort";
import { launchEnvironmentChoices, workspaceRegistry } from "./workspaceRegistry";

const text = composerCommandText();
const app = folderRef("app");
const api = folderRef("api");
const manifest = (...environments: string[]) => JSON.stringify({ version: 1, environments: Object.fromEntries(environments.map((name) => [name, {}])) });
const at = (folder: typeof app) => path.join(folder.path, "builderforce.json");

describe("the workspace's composer command registry", () => {
  it("makes /launch unavailable, with the localized reason, in a remote extension host", async () => {
    const port = fakeWorkspacePort([app]);
    port.remote = "ssh-remote";
    const registry = await workspaceRegistry(port, text, vi.fn());
    expect(parseComposerInput("/launch", registry)).toMatchObject({ kind: "unavailable", id: "launch", reason: text.launchRemote("ssh-remote") });
    expect(registry.help().entries.find((entry) => entry.id === "launch")).toMatchObject({ availability: { ok: false, reason: text.launchRemote("ssh-remote") } });
    // The other commands still run there: they only write files in the remote workspace.
    expect(parseComposerInput("/manifest init", registry)).toMatchObject({ kind: "command", id: "manifest" });
  });

  it("leaves /launch available in a local extension host", async () => {
    const registry = await workspaceRegistry(fakeWorkspacePort([app]), text, vi.fn());
    expect(parseComposerInput("/launch", registry)).toMatchObject({ kind: "command", id: "launch" });
  });

  it("offers one folder's environments unlabelled", async () => {
    const port = fakeWorkspacePort([app], { [at(app)]: manifest("local", "staging") });
    expect(await launchEnvironmentChoices(port, text, vi.fn())).toEqual([{ value: "local" }, { value: "staging" }]);
  });

  it("offers EVERY folder's environments when several are open, each labelled with the folders declaring it", async () => {
    const port = fakeWorkspacePort([app, api], { [at(app)]: manifest("local", "staging"), [at(api)]: manifest("local", "production") });
    expect(await launchEnvironmentChoices(port, text, vi.fn())).toEqual([
      { value: "local", label: text.launchEnvironmentIn("local", ["app", "api"]) },
      { value: "staging", label: text.launchEnvironmentIn("staging", ["app"]) },
      { value: "production", label: text.launchEnvironmentIn("production", ["api"]) },
    ]);
    const registry = await workspaceRegistry(port, text, vi.fn());
    expect(parseComposerInput("/launch production", registry)).toMatchObject({ kind: "command", args: { environment: "production" } });
  });

  it("reports a manifest that is not JSON, or cannot be read, and offers what the other folders declare", async () => {
    const port = fakeWorkspacePort([app, api], { [at(app)]: "{ not json", [at(api)]: manifest("local") });
    const report = vi.fn();
    expect(await launchEnvironmentChoices(port, text, report)).toEqual([{ value: "local", label: text.launchEnvironmentIn("local", ["api"]) }]);
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0]![0]).toContain(at(app));

    const unreadable = fakeWorkspacePort([app]);
    unreadable.readText = async () => { throw new Error("EACCES"); };
    const reported = vi.fn();
    expect(await launchEnvironmentChoices(unreadable, text, reported)).toEqual([]);
    expect(reported.mock.calls[0]![0]).toContain("EACCES");
  });
});
