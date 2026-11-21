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

  it("drops the stale top-level $schema from a moved file, says so in the question and the reply, and keeps the rest byte for byte", async () => {
    const before = "{\n  \"$schema\": \"https://builderforce.ai/schema/app.v1.json\",\n  \"version\": 1,\n  \"resources\": { \"db\": { \"$schema\": \"https://builderforce.ai/schema/app.v1.json\" } }\n}\n";
    const { port, execute } = setup({ [root]: before });
    const reply = await execute();
    const question = text.manifestMoveQuestion("builderforce.json", ".builderforce/builderforce.json", "app");
    expect(port.asked).toEqual([{ message: `${question} ${text.manifestSchemaDropNote("https://builderforce.ai/schema/app.v1.json")}`, approve: "Move" }]);
    expect([...port.files]).toEqual([[canonical, "{\n  \"version\": 1,\n  \"resources\": { \"db\": { \"$schema\": \"https://builderforce.ai/schema/app.v1.json\" } }\n}\n"]]);
    expect(reply).toEqual({
      kind: "text",
      tone: "info",
      lines: [text.manifestMoved("builderforce.json", ".builderforce/builderforce.json"), text.manifestSchemaRemoved(".builderforce/builderforce.json")],
    });
  });

  it("moves a file whose $schema is any other value unchanged", async () => {
    const before = "{\"$schema\":\"https://builderforce.ai/schema/app.v2.json\",\"version\":1}";
    const { port, execute } = setup({ [root]: before });
    await execute();
    expect(port.asked[0]!.message).toBe(text.manifestMoveQuestion("builderforce.json", ".builderforce/builderforce.json", "app"));
    expect([...port.files]).toEqual([[canonical, before]]);
  });

  it("offers to remove the stale $schema from .builderforce/builderforce.json when there is no root manifest", async () => {
    const { port, execute } = setup({ [canonical]: "{\n  \"version\": 1,\n  \"$schema\": \"https://builderforce.ai/schema/app.v1.json\"\n}\n" });
    const reply = await execute();
    expect(port.asked).toEqual([{
      message: text.manifestSchemaRemoveQuestion(".builderforce/builderforce.json", "https://builderforce.ai/schema/app.v1.json", "app"),
      approve: text.manifestSchemaRemove,
    }]);
    expect(port.files.get(canonical)).toBe("{\n  \"version\": 1\n}\n");
    expect(reply).toEqual({ kind: "text", tone: "info", lines: [text.manifestSchemaRemoved(".builderforce/builderforce.json")] });
  });

  it("removes the canonical file's stale $schema even when a leftover root file is beside it, which is never moved over it", async () => {
    const { port, execute } = setup({ [root]: "{\"old\":true}", [canonical]: "{\"$schema\":\"https://builderforce.ai/schema/app.v1.json\",\"version\":1}" });
    const reply = await execute();
    expect(port.files.get(root)).toBe("{\"old\":true}");
    expect(port.files.get(canonical)).toBe("{\"version\":1}");
    expect(reply).toEqual({ kind: "text", tone: "info", lines: [text.manifestSchemaRemoved(".builderforce/builderforce.json")] });
  });

  it("moves but keeps an edit made to the root file while the person was asked, and says $schema was not removed", async () => {
    const { port, execute } = setup({ [root]: "{\"$schema\":\"https://builderforce.ai/schema/app.v1.json\",\"version\":1}" });
    const edited = "{\"$schema\":\"https://builderforce.ai/schema/app.v1.json\",\"version\":1,\"name\":\"edited\"}";
    port.confirm = async () => {
      port.files.set(root, edited);
      return true;
    };
    const reply = await execute();
    expect([...port.files]).toEqual([[canonical, edited]]);
    expect(reply).toEqual({
      kind: "text",
      tone: "info",
      lines: [text.manifestMoved("builderforce.json", ".builderforce/builderforce.json"), text.manifestSchemaChanged(".builderforce/builderforce.json")],
    });
  });

  it("leaves the canonical file alone when the removal is declined", async () => {
    const before = "{\"$schema\":\"https://builderforce.ai/schema/app.v1.json\",\"version\":1}";
    const { port, execute } = setup({ [canonical]: before });
    port.approve = false;
    const reply = await execute();
    expect(port.files.get(canonical)).toBe(before);
    expect(reply).toEqual({ kind: "text", tone: "info", lines: [text.manifestSchemaKept] });
  });

  it("never overwrites an edit made to the canonical file while the person was asked", async () => {
    const before = "{\"$schema\":\"https://builderforce.ai/schema/app.v1.json\",\"version\":1}";
    const { port, execute } = setup({ [canonical]: before });
    port.confirm = async () => {
      port.files.set(canonical, "{\"$schema\":\"https://builderforce.ai/schema/app.v1.json\",\"version\":1,\"name\":\"edited\"}");
      return true;
    };
    const reply = await execute();
    expect(port.files.get(canonical)).toContain("edited");
    expect(reply).toEqual({ kind: "text", tone: "error", lines: [text.manifestSchemaChanged(".builderforce/builderforce.json")] });
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
