import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)])) },
}));

import { composerCommandText } from "./labels";
import { manifestMoveExecutor } from "./manifestMove";
import { fakeWorkspacePort, folderRef } from "./testWorkspacePort";

const app = folderRef("app");
const canonical = path.join(app.path, ".builderforce", "builderforce.json");
const root = path.join(app.path, "builderforce.json");
const bfwc = path.join(app.path, "bfwc.app.json");
const text = composerCommandText();

function setup(files: Record<string, string>) {
  const port = fakeWorkspacePort([app], files);
  return { port, execute: () => manifestMoveExecutor({ port, text })({ action: "move" }) };
}

describe("/manifest move", () => {
  it("moves a root builderforce.json into .builderforce/ on approval", async () => {
    const { port, execute } = setup({ [root]: "{\"version\":1}" });
    const reply = await execute();
    expect(port.asked).toEqual([{ message: text.manifestMoveQuestion("builderforce.json", ".builderforce/builderforce.json", "app"), approve: "Move" }]);
    expect([...port.files]).toEqual([[canonical, "{\"version\":1}"]]);
    expect(reply).toEqual({ kind: "text", tone: "info", lines: [text.manifestMoved("builderforce.json", ".builderforce/builderforce.json")] });
  });

  it("moves a root bfwc.app.json an older runtime left", async () => {
    const { port, execute } = setup({ [bfwc]: "{\"version\":1}" });
    await execute();
    expect([...port.files.keys()]).toEqual([canonical]);
  });

  it("moves nothing when declined", async () => {
    const { port, execute } = setup({ [root]: "{}" });
    port.approve = false;
    const reply = await execute();
    expect([...port.files.keys()]).toEqual([root]);
    expect(reply).toEqual({ kind: "text", tone: "info", lines: [text.manifestMoveDeclined] });
  });

  it("refuses, without asking, when .builderforce/builderforce.json already exists: nothing is overwritten", async () => {
    const { port, execute } = setup({ [root]: "{\"old\":true}", [canonical]: "{\"new\":true}" });
    const reply = await execute();
    expect(port.asked).toEqual([]);
    expect(port.files.get(canonical)).toBe("{\"new\":true}");
    expect(port.files.get(root)).toBe("{\"old\":true}");
    expect(reply).toEqual({ kind: "text", tone: "error", lines: [text.manifestMoveExists("builderforce.json", ".builderforce/builderforce.json")] });
  });

  it("refuses, naming the canonical file, when it appears after the approval: nothing is moved or replaced", async () => {
    const { port, execute } = setup({ [root]: "{\"old\":true}" });
    // The person approves; meanwhile another window writes the canonical file.
    port.confirm = async () => {
      port.files.set(canonical, "{\"new\":true}");
      return true;
    };
    const reply = await execute();
    expect(port.files.get(canonical)).toBe("{\"new\":true}");
    expect(port.files.get(root)).toBe("{\"old\":true}");
    expect(reply).toEqual({ kind: "text", tone: "error", lines: [text.manifestMoveExists("builderforce.json", ".builderforce/builderforce.json")] });
  });

  it("says there is nothing to move when the folder has no root manifest", async () => {
    const reply = await setup({ [canonical]: "{}" }).execute();
    expect(reply).toEqual({ kind: "text", tone: "info", lines: [text.manifestMoveNone("app", ["builderforce.json", "bfwc.app.json"])] });
  });

  it("refuses a root manifest that is a symbolic link before asking", async () => {
    const { port, execute } = setup({ [root]: "{}" });
    port.refused.add(root);
    const reply = await execute();
    expect(port.asked).toEqual([]);
    expect([...port.files.keys()]).toEqual([root]);
    expect(reply).toEqual({ kind: "text", tone: "error", lines: [text.writeRefused([root])] });
  });
});
