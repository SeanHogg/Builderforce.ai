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
    expect(reply).toMatchObject({ kind: "text", tone: "info", action: { command: "/launch" } });
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

  it("writes nothing when the kit has issues", async () => {
    const port = fakeWorkspacePort([app]);
    const reply = await run(port, { kit: "no-such-kit" });
    expect(port.files.size).toBe(0);
    expect(reply).toMatchObject({ kind: "text", tone: "error" });
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
