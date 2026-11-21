import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { detectionNote, noteFrom, noteMessages, type DetectionNote } from "@builderforce/app-detect";

vi.mock("vscode", () => ({
  l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)])) },
}));

import { FolderLaunchers, type RunningLauncher } from "./folderLaunchers";
import { composerCommandText } from "./labels";
import { launchExecutor, type LaunchRequest } from "./launch";
import { fakeWorkspacePort, folderRef } from "./testWorkspacePort";

const app = folderRef("app");

function setup(files: Record<string, string> = {}, folders = [app]) {
  const port = fakeWorkspacePort(folders, files);
  const launchers = new FolderLaunchers();
  const started: Array<{ request: LaunchRequest; launcher: RunningLauncher & { close: ReturnType<typeof vi.fn> } }> = [];
  const start = vi.fn(async (request: LaunchRequest) => {
    const launcher = { url: `http://localhost:${4000 + started.length}/#token=secret`, close: vi.fn(async () => undefined) };
    started.push({ request, launcher });
    return launcher;
  });
  const openExternal = vi.fn(async (_url: string) => undefined);
  const openInEditor = vi.fn(async (_url: string) => undefined);
  const detect = vi.fn(() => ({ text: "{\"detected\":true}", services: ["web"], resources: [] as string[], notes: [] as DetectionNote[] }));
  const readFiles = vi.fn(async () => new Map<string, string>());
  const execute = launchExecutor({ port, text: composerCommandText(), launchers, start, openExternal, openInEditor, readFiles, detect });
  return { port, launchers, start, started, openExternal, openInEditor, detect, launch: (environment?: string) => execute(environment ? { environment } : {}) };
}

const linesOf = (reply: Awaited<ReturnType<ReturnType<typeof setup>["launch"]>>) => (reply.kind === "text" ? reply.lines : []);

describe("/launch", () => {
  it("runs a detected manifest in memory when the folder has no builderforce.json, and says so", async () => {
    const { start, launch } = setup();
    const reply = await launch();
    expect(start).toHaveBeenCalledWith({ projectDir: app.path, manifestText: "{\"detected\":true}" });
    expect(reply).toMatchObject({ kind: "text", tone: "info", link: "http://localhost:4000/#token=secret" });
    expect(linesOf(reply).some((line) => line.includes("/manifest init"))).toBe(true);
  });

  it("opens in VS Code's browser, and offers both reopening there and the external browser", async () => {
    const { openExternal, openInEditor, launch } = setup();
    const reply = await launch();
    const text = composerCommandText();
    expect(openInEditor).toHaveBeenCalledExactlyOnceWith("http://localhost:4000/#token=secret");
    expect(openExternal).not.toHaveBeenCalled();
    expect(linesOf(reply)[0]).toBe(text.launchStarted("app", false));
    expect(reply).toMatchObject({
      actions: [
        { label: text.launchOpenInEditor, command: "/launch" },
        { label: text.launchOpenExternal, command: "/launch external" },
      ],
    });
  });

  it("/launch external opens the running launcher in the external browser without restarting it", async () => {
    const { start, openExternal, openInEditor, launch } = setup();
    await launch("staging");
    const reply = await launch("external");
    expect(start).toHaveBeenCalledOnce();
    expect(openInEditor).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledExactlyOnceWith("http://localhost:4000/#token=secret");
    expect(linesOf(reply)[0]).toBe(composerCommandText().launchReopened("app", true));
    expect(reply).toMatchObject({ actions: [{ command: "/launch" }, { command: "/launch external" }] });
  });

  it("/launch external starts the launcher when none is running, in the external browser", async () => {
    const { start, openExternal, openInEditor, launch } = setup();
    const reply = await launch("external");
    expect(start).toHaveBeenCalledWith({ projectDir: app.path, manifestText: "{\"detected\":true}" });
    expect(openExternal).toHaveBeenCalledOnce();
    expect(openInEditor).not.toHaveBeenCalled();
    expect(linesOf(reply)[0]).toBe(composerCommandText().launchStarted("app", true));
  });

  it("shows a detected manifest's notes, worded exactly as /manifest init words them", async () => {
    const { detect, launch } = setup();
    const notes = [detectionNote("secrets-to-vault", { names: ["API_KEY"] }), noteFrom("compose.yaml", detectionNote("compose-no-services", { file: "compose.yaml" }))];
    detect.mockReturnValueOnce({ text: "{}", services: [], resources: [], notes });
    const lines = linesOf(await launch());
    const text = composerCommandText();
    expect(lines).toEqual([
      "The launcher for app is running and opened in VS Code's browser.",
      text.launchDetected,
      ...text.noteLines(notes),
    ]);
    expect(text.noteLines(notes)).toEqual(["Notes:", ...noteMessages(notes)]);
  });

  it("runs the folder's own builderforce.json, in the environment asked for", async () => {
    const { start, detect, launch } = setup({ [path.join(app.path, "builderforce.json")]: "{}" });
    const reply = await launch("staging");
    expect(start).toHaveBeenCalledWith({ projectDir: app.path, environment: "staging" });
    expect(detect).not.toHaveBeenCalled();
    expect(linesOf(reply).some((line) => line.includes("/manifest init"))).toBe(false);
  });

  it("keeps ONE launcher per folder: a second /launch reopens it", async () => {
    const { start, openInEditor, launch } = setup();
    await launch();
    const reply = await launch();
    expect(start).toHaveBeenCalledOnce();
    expect(openInEditor).toHaveBeenCalledTimes(2);
    expect(linesOf(reply)[0]).toContain("already running");
  });

  it("restarts the folder's launcher for another environment", async () => {
    const { start, started, launch } = setup();
    await launch("local");
    await launch("staging");
    expect(start).toHaveBeenCalledTimes(2);
    expect(started[0]!.launcher.close).toHaveBeenCalledOnce();
  });

  it("/launch stop closes it, and says when none is running", async () => {
    const { started, launch } = setup();
    await launch();
    expect(linesOf(await launch("stop"))).toEqual(["Stopped the launcher for app."]);
    expect(started[0]!.launcher.close).toHaveBeenCalledOnce();
    expect(linesOf(await launch("stop"))).toEqual(["No launcher is running for app."]);
  });

  it("closes every launcher on deactivate", async () => {
    const other = folderRef("other");
    const { port, launchers, started, launch } = setup({}, [app, other]);
    port.picked = app;
    await launch();
    port.picked = other;
    await launch();
    await launchers.closeAll(() => undefined);
    expect(started).toHaveLength(2);
    for (const { launcher } of started) expect(launcher.close).toHaveBeenCalledOnce();
  });

  it("reports a launcher that cannot start, and forgets it", async () => {
    const { start, launchers, launch } = setup();
    start.mockRejectedValueOnce(new Error("dist missing"));
    const reply = await launch();
    expect(reply).toMatchObject({ kind: "text", tone: "error", lines: ["The launcher could not start: dist missing"] });
    expect(launchers.running(app.path)).toBeUndefined();
  });
});
