import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)])) },
}));

import { composerCommandText } from "./labels";
import { manifestInitExecutor, type DetectedManifest } from "./manifestInit";
import { fakeWorkspacePort, folderRef } from "./testWorkspacePort";

const app = folderRef("app");
const manifestPath = path.join(app.path, "builderforce.json");
const detected: DetectedManifest = { text: "{\"version\":1}\n", services: ["web", "api"], resources: ["db"], notes: ["secrets are not copied"] };

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
      "secrets are not copied",
    ]));
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
