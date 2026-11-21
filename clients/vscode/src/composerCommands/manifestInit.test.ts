import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { detectionNote, noteFrom, noteMessages } from "@builderforce/app-detect";

const l10nCalls = vi.hoisted(() => [] as string[]);
vi.mock("vscode", () => ({
  l10n: {
    t: (message: string, ...args: unknown[]) => {
      l10nCalls.push(message);
      return message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));
    },
  },
}));

import { composerCommandText } from "./labels";
import { manifestInitExecutor, type DetectedManifest } from "./manifestInit";
import { fakeWorkspacePort, folderRef } from "./testWorkspacePort";

const app = folderRef("app");
const manifestPath = path.join(app.path, "builderforce.json");
const detected: DetectedManifest = {
  text: "{\"version\":1}\n",
  services: ["web", "api"],
  resources: ["db"],
  notes: [
    detectionNote("secrets-to-vault", { names: ["API_KEY", "TOKEN"] }),
    noteFrom("builderforce.json", detectionNote("manifest-env-differs", { name: "PORT" })),
  ],
};

function setup(files: Record<string, string> = {}) {
  const port = fakeWorkspacePort([app], files);
  const show = vi.fn(async () => undefined);
  const readFiles = vi.fn(async () => new Map([["package.json", "{}"]]));
  const detect = vi.fn(() => detected);
  const execute = manifestInitExecutor({ port, text: composerCommandText(), readFiles, detect, show });
  return { port, show, readFiles, detect, execute: () => execute({ action: "init" }) };
}

describe("/manifest init", () => {
  it("with no builderforce.json: previews the detected manifest, then writes it on approval", async () => {
    const { port, show, readFiles, detect, execute } = setup();
    const reply = await execute();
    expect(readFiles).toHaveBeenCalledWith(app.path);
    expect(detect).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith(detected.text, "builderforce.json (detected)");
    expect(port.asked[0]!.approve).toBe("Write");
    expect(port.files.get(manifestPath)).toBe(detected.text);
    expect(reply.kind === "text" ? reply.lines : []).toEqual(expect.arrayContaining([
      "Wrote builderforce.json (2 services, 1 resources).",
      "Notes:",
      "Secrets are never written to the file: set API_KEY, TOKEN in the vault.",
      "builderforce.json: env PORT differs between services; the first value is kept",
    ]));
  });

  it("words every note from its code through vscode.l10n, never the package's English message", async () => {
    const reply = await setup().execute();
    const lines = reply.kind === "text" ? reply.lines : [];
    // The mocked `t` is the identity on the key, so the lines equal the package's English only through the l10n keys.
    expect(lines).toEqual(expect.arrayContaining(noteMessages(detected.notes)));
    expect(l10nCalls).toEqual(expect.arrayContaining([
      "Secrets are never written to the file: set {0} in the vault.",
      "env {0} differs between services; the first value is kept",
      "{0}: {1}",
    ]));
  });

  it("refuses a builderforce.json that is a symbolic link before showing or asking, naming the path", async () => {
    const { port, show, execute } = setup();
    port.refused.add(manifestPath);
    const reply = await execute();
    expect(show).not.toHaveBeenCalled();
    expect(port.asked).toEqual([]);
    expect(port.files.has(manifestPath)).toBe(false);
    expect(reply).toEqual({ kind: "text", tone: "error", lines: [composerCommandText().writeRefused([manifestPath])] });
  });

  it("offers /launch locally, and never in a remote extension host (it says why instead)", async () => {
    const local = await setup().execute();
    expect(local).toMatchObject({ actions: [{ command: "/launch" }] });
    const { port, execute } = setup();
    port.remote = "ssh-remote";
    const remote = await execute();
    expect(remote.kind === "text" ? remote.actions : "no reply").toBeUndefined();
    expect(remote.kind === "text" ? remote.lines : []).toContain(composerCommandText().launchRemote("ssh-remote"));
    expect(remote.kind === "text" ? remote.lines : []).not.toContain(composerCommandText().launchHint);
  });

  it("with a builderforce.json: shows the diff against it and replaces it only on approval", async () => {
    const { port, show, execute } = setup({ [manifestPath]: "{\"old\":true}" });
    port.approve = false;
    const reply = await execute();
    expect(show).toHaveBeenCalledWith(detected.text, "builderforce.json: current ↔ detected", manifestPath);
    expect(port.asked[0]!.approve).toBe("Replace");
    expect(port.files.get(manifestPath)).toBe("{\"old\":true}");
    expect(reply.kind === "text" ? reply.lines : []).toEqual(["builderforce.json was not written."]);

    port.approve = true;
    await execute();
    expect(port.files.get(manifestPath)).toBe(detected.text);
  });
});
