import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { composeKit } from "@builderforce/ide-templates/kits";

vi.mock("vscode", () => ({
  l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)])) },
}));

import { composerCommandText } from "./labels";
import { starterKitExecutor } from "./starterKit";
import { fakeWorkspacePort, folderRef } from "./testWorkspacePort";

const app = folderRef("app");
const kitFiles = Object.keys(composeKit("react-node", ["postgres"]).files);
const at = (relative: string) => path.join(app.path, ...relative.split("/"));

function run(port: ReturnType<typeof fakeWorkspacePort>, args: Record<string, string | string[]> = { kit: "react-node", with: ["postgres"] }) {
  return starterKitExecutor({ port, text: composerCommandText() })(args);
}

describe("/starter-kit", () => {
  it("writes every file of the kit into an empty folder without asking", async () => {
    const port = fakeWorkspacePort([app], { [at(".git/HEAD")]: "ref" });
    const reply = await run(port);
    expect(port.asked).toEqual([]);
    for (const file of kitFiles) expect(port.files.has(at(file)), file).toBe(true);
    expect(port.files.has(at("builderforce.json"))).toBe(true);
    expect(reply).toMatchObject({ kind: "text", tone: "info", actions: [{ command: "/launch" }] });
    expect(reply.kind === "text" ? reply.lines[0] : "").toBe(`Wrote the react-node starter kit: ${kitFiles.length} files into app.`);
  });

  it("asks before writing into a folder that is not empty", async () => {
    const port = fakeWorkspacePort([app], { [at("notes.txt")]: "mine" });
    await run(port);
    expect(port.asked).toHaveLength(1);
    expect(port.asked[0]!.approve).toBe("Write files");
    expect(port.files.get(at("notes.txt"))).toBe("mine");
    expect(port.files.has(at("builderforce.json"))).toBe(true);
  });

  it("regression: writes without asking into a folder holding only .builderforce (with .git / .vscode)", async () => {
    const port = fakeWorkspacePort([app], {
      [at(".builderforce/symbols.json")]: "{}",
      [at(".git/HEAD")]: "ref",
      [at(".vscode/settings.json")]: "{}",
    });
    const reply = await run(port);
    expect(port.asked).toEqual([]);
    for (const file of kitFiles) expect(port.files.has(at(file)), file).toBe(true);
    expect(reply).toMatchObject({ kind: "text", tone: "info" });
  });

  it("regression: still names a kit file already inside an ignored folder as a conflict", async () => {
    const port = fakeWorkspacePort([app], { [at(".builderforce/symbols.json")]: "{}", [at(kitFiles[0]!)]: "mine" });
    port.approve = false;
    await run(port);
    expect(port.asked).toHaveLength(1);
    expect(port.asked[0]!.approve).toBe("Overwrite and write");
    expect(port.files.get(at(kitFiles[0]!))).toBe("mine");
  });

  it("writes nothing when the approval is declined", async () => {
    const port = fakeWorkspacePort([app], { [at("notes.txt")]: "mine" });
    port.approve = false;
    const reply = await run(port);
    expect([...port.files.keys()]).toEqual([at("notes.txt")]);
    expect(reply.kind === "text" ? reply.lines[0] : "").toContain("was not approved");
  });

  it("names the files it would overwrite, and keeps them when declined", async () => {
    const port = fakeWorkspacePort([app], { [at("builderforce.json")]: "{\"mine\":true}" });
    port.approve = false;
    await run(port);
    expect(port.asked[0]!.approve).toBe("Overwrite and write");
    expect(port.asked[0]!.message).toContain("builderforce.json");
    expect(port.files.get(at("builderforce.json"))).toBe("{\"mine\":true}");
  });

  it("writes NOTHING, and names the path, when one kit path is refused (a symbolic link)", async () => {
    const port = fakeWorkspacePort([app]);
    port.refused.add(at("builderforce.json"));
    const reply = await run(port);
    expect(port.files.size).toBe(0);
    expect(port.asked).toEqual([]);
    expect(reply).toMatchObject({ kind: "text", tone: "error" });
    expect(reply.kind === "text" ? reply.lines : []).toEqual([composerCommandText().writeRefused([at("builderforce.json")])]);
  });

  it("names the file and every file already written when a write is refused partway", async () => {
    const port = fakeWorkspacePort([app]);
    const third = kitFiles[2]!;
    // Passes the up-front check, then refused at write time (the folder changed in between).
    port.checkWrites = async () => [];
    port.refused.add(at(third));
    const reply = await run(port);
    const text = composerCommandText();
    expect(reply).toMatchObject({ kind: "text", tone: "error" });
    expect(reply.kind === "text" ? reply.lines : []).toEqual([text.kitStopped(third, text.writeRefusedReason, kitFiles.slice(0, 2))]);
    expect([...port.files.keys()].sort()).toEqual(kitFiles.slice(0, 2).map(at).sort());
  });

  it("offers no /launch in a remote extension host, and says why", async () => {
    const port = fakeWorkspacePort([app]);
    port.remote = "wsl";
    const reply = await run(port);
    expect(reply.kind === "text" ? reply.actions : "no reply").toBeUndefined();
    expect(reply.kind === "text" ? reply.lines : []).toContain(composerCommandText().launchRemote("wsl"));
    expect(reply.kind === "text" ? reply.lines : []).not.toContain(composerCommandText().launchHint);
  });

  it("writes nothing when the kit has issues", async () => {
    const port = fakeWorkspacePort([app]);
    const reply = await run(port, { kit: "no-such-kit" });
    expect(port.files.size).toBe(0);
    expect(reply).toMatchObject({ kind: "text", tone: "error" });
    // Worded from the issue's code + params through l10n (the mocked `t` returns the English key filled in).
    expect(reply.kind === "text" ? reply.lines.slice(1) : []).toEqual(composeKit("no-such-kit").issues.map((issue) => issue.message));
  });

  it("asks which folder when several are open, and does nothing when none is picked", async () => {
    const port = fakeWorkspacePort([app, folderRef("other")]);
    const reply = await run(port);
    expect(port.files.size).toBe(0);
    expect(reply.kind === "text" ? reply.lines[0] : "").toContain("No folder was chosen");
    port.picked = app;
    await run(port);
    expect(port.files.has(at("builderforce.json"))).toBe(true);
  });
});
