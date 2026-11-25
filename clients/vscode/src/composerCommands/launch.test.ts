import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { detectionNote, noteFrom, noteMessages, type DetectionNote } from "@builderforce/app-detect";

vi.mock("vscode", () => ({
  l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)])) },
}));

import { FolderLaunchers, type RunningLauncher } from "./folderLaunchers";
import { composerCommandText } from "./labels";
import { launchExecutor, type LaunchRequest } from "./launch";
import type { TrustOutcome } from "./launcherTrust";
import type { DetectedManifest } from "./manifestInit";
import { FS_ROOT, fakeWorkspacePort, folderRef } from "./testWorkspacePort";
import type { WorkspaceFolderRef } from "./workspacePort";

const app = folderRef("app");
const at = (...parts: string[]) => path.join(app.path, ...parts);

interface EditorSetup {
  /** This VS Code has the integrated browser (default: yes). */
  available?: boolean;
  /** The certificate step's outcome (default: no trust step). */
  trust?: TrustOutcome;
  /** The manifest environments known (default: none readable). */
  environments?: string[] | ((folder?: WorkspaceFolderRef) => string[]);
  /** The user's home directory. */
  home?: string;
}

function setup(files: Record<string, string> = {}, folders = [app], editor: EditorSetup = {}) {
  const port = fakeWorkspacePort(folders, files);
  const launchers = new FolderLaunchers(port.realPath);
  const started: Array<{ request: LaunchRequest; launcher: RunningLauncher & { close: ReturnType<typeof vi.fn> } }> = [];
  const start = vi.fn(async (request: LaunchRequest) => {
    const launcher = { url: `http://localhost:${4000 + started.length}/#token=secret`, close: vi.fn(async () => undefined) };
    started.push({ request, launcher });
    return launcher;
  });
  const openExternal = vi.fn(async (_url: string) => undefined);
  const openInEditor = vi.fn(async (_url: string) => undefined);
  const detect = vi.fn((): DetectedManifest => ({ text: "{\"detected\":true}", services: ["web"], resources: [] as string[], notes: [] as DetectionNote[] }));
  const readFiles = vi.fn(async () => new Map<string, string>());
  const available = vi.fn(async () => editor.available ?? true);
  const editorBrowser = { available, open: openInEditor };
  const trust = editor.trust ? { trust: async () => editor.trust! } : {};
  const known = editor.environments;
  const environments = known ? { environments: async (folder?: WorkspaceFolderRef) => (typeof known === "function" ? known(folder) : known) } : {};
  const execute = launchExecutor({
    port, text: composerCommandText(), launchers, start, openExternal, editorBrowser, readFiles, detect, homeDir: editor.home ?? path.join(FS_ROOT, "home", "me"), ...environments, ...trust,
  });
  return {
    port, launchers, start, started, openExternal, openInEditor, detect,
    launch: (environment?: string, target?: string) => execute({ ...(environment ? { environment } : {}), ...(target ? { target } : {}) }),
  };
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

  it("opens in VS Code's integrated browser, and offers both reopening there and the external browser", async () => {
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

  it("opens the system browser, says why, and offers no \"Open in VS Code\" when this VS Code has no integrated browser", async () => {
    const { openExternal, openInEditor, launch } = setup({}, [app], { available: false });
    const reply = await launch();
    const text = composerCommandText();
    expect(openInEditor).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledExactlyOnceWith("http://localhost:4000/#token=secret");
    expect(linesOf(reply).slice(0, 2)).toEqual([text.launchStarted("app", true), text.launchEditorUnavailable]);
    expect(reply.kind === "text" ? reply.actions : []).toEqual([{ label: text.launchOpenExternal, command: "/launch external" }]);
  });

  it("opens the system browser, and says why, when the launcher's certificate is not trusted", async () => {
    const text = composerCommandText();
    const { openExternal, openInEditor, launch } = setup({}, [app], { trust: { lines: [text.trustUntrusted], failed: false, trusted: false } });
    const reply = await launch();
    expect(openInEditor).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledOnce();
    expect(linesOf(reply)[0]).toBe(text.launchStarted("app", true));
    expect(linesOf(reply)).toContain(text.launchEditorUntrusted);
    expect(linesOf(reply)).toContain(text.trustUntrusted);
    // Not "Open in VS Code" (it would fall back again): trust first, then open there.
    expect(reply.kind === "text" ? reply.actions : []).toEqual([
      { label: text.launchTrustAndOpenInEditor, command: "/launch trust" },
      { label: text.launchOpenExternal, command: "/launch external" },
    ]);
  });

  it("opens the system browser, and names the error, when the integrated browser fails to open", async () => {
    const { openExternal, openInEditor, launch } = setup();
    openInEditor.mockRejectedValueOnce(new Error("no editor group"));
    const reply = await launch();
    const text = composerCommandText();
    expect(openExternal).toHaveBeenCalledOnce();
    expect(linesOf(reply).slice(0, 2)).toEqual([text.launchStarted("app", true), text.launchEditorFailed("no editor group")]);
    expect(reply).toMatchObject({ tone: "info" });
  });

  it("treats a manifest environment named like a subcommand as the subcommand", async () => {
    const { start, openExternal, started, launch } = setup({ [path.join(app.path, ".builderforce", "builderforce.json")]: "{}" });
    await launch("external");
    expect(start).toHaveBeenCalledExactlyOnceWith({ projectDir: app.path });
    expect(openExternal).toHaveBeenCalledOnce();
    expect(linesOf(await launch("stop"))).toEqual(["Stopped the launcher for app."]);
    expect(started[0]!.launcher.close).toHaveBeenCalledOnce();
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
      "The launcher for app is running and opened in VS Code's built-in browser.",
      text.launchDetected,
      ...text.noteLines(notes),
    ]);
    expect(text.noteLines(notes)).toEqual(["Notes:", ...noteMessages(notes)]);
  });

  it("runs the folder's own .builderforce/builderforce.json, in the environment asked for", async () => {
    const { start, detect, launch } = setup({ [path.join(app.path, ".builderforce", "builderforce.json")]: "{}" });
    const reply = await launch("staging");
    expect(start).toHaveBeenCalledWith({ projectDir: app.path, environment: "staging" });
    expect(detect).not.toHaveBeenCalled();
    expect(linesOf(reply).some((line) => line.includes("/manifest init") || line.includes("/manifest move"))).toBe(false);
  });

  it("runs a legacy root builderforce.json, says it is deprecated and offers /manifest move", async () => {
    const { start, detect, launch } = setup({ [path.join(app.path, "builderforce.json")]: "{}" });
    const reply = await launch();
    const text = composerCommandText();
    expect(start).toHaveBeenCalledWith({ projectDir: app.path });
    expect(detect).not.toHaveBeenCalled();
    expect(linesOf(reply)).toContain(text.manifestLegacy("builderforce.json", ".builderforce/builderforce.json"));
    expect(reply.kind === "text" ? reply.actions : []).toContainEqual({ label: text.manifestMoveAction, command: "/manifest move" });
  });

  it("runs a .builderforce/builderforce.json carrying the stale $schema, says why VS Code reports a problem and offers its removal", async () => {
    const canonical = path.join(app.path, ".builderforce", "builderforce.json");
    const { start, launch } = setup({ [canonical]: "{\n  \"$schema\": \"https://builderforce.ai/schema/app.v1.json\",\n  \"version\": 1\n}\n" });
    const reply = await launch();
    const text = composerCommandText();
    expect(start).toHaveBeenCalledWith({ projectDir: app.path });
    expect(linesOf(reply)).toContain(text.manifestStaleSchema(".builderforce/builderforce.json", "https://builderforce.ai/schema/app.v1.json"));
    expect(reply.kind === "text" ? reply.actions : []).toContainEqual({ label: text.manifestSchemaRemoveAction, command: "/manifest move" });
  });

  it("still replies normally when the canonical manifest cannot be read for the stale-$schema check", async () => {
    const canonical = path.join(app.path, ".builderforce", "builderforce.json");
    const { port, start, launch } = setup({ [canonical]: "{}" });
    // The advisory read fails (EACCES): the launch reply is never lost to it.
    vi.spyOn(port, "readText").mockRejectedValueOnce(new Error("EACCES: permission denied"));
    const reply = await launch();
    const text = composerCommandText();
    expect(start).toHaveBeenCalledWith({ projectDir: app.path });
    expect(reply).toMatchObject({ kind: "text", tone: "info", link: "http://localhost:4000/#token=secret" });
    expect(linesOf(reply)[0]).toBe(text.launchStarted("app", false));
    expect(linesOf(reply).some((line) => line.includes("$schema"))).toBe(false);
    expect(reply.kind === "text" ? reply.actions : []).not.toContainEqual({ label: text.manifestSchemaRemoveAction, command: "/manifest move" });
  });

  it("says nothing about a $schema with any other value", async () => {
    const canonical = path.join(app.path, ".builderforce", "builderforce.json");
    const { launch } = setup({ [canonical]: "{\"$schema\":\"./my.schema.json\",\"version\":1}" });
    const reply = await launch();
    const text = composerCommandText();
    expect(reply.kind === "text" ? reply.actions : []).not.toContainEqual({ label: text.manifestSchemaRemoveAction, command: "/manifest move" });
    expect(linesOf(reply).some((line) => line.includes("$schema"))).toBe(false);
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

  it("/launch <html file> runs the static-site manifest with that page, names it, and reopens it on a second launch", async () => {
    const file = path.join(app.path, "design", "mock up.html");
    const { start, detect, launch } = setup({ [file]: "<p>hi</p>" });
    const reply = await launch(file);
    const text = composerCommandText();
    expect(start).toHaveBeenCalledOnce();
    const request = start.mock.calls[0]![0];
    expect(request).toMatchObject({ projectDir: path.dirname(file), page: "/mock up.html" });
    expect(JSON.parse(request.manifestText!).services.web.command).toBe("vite");
    expect(detect).not.toHaveBeenCalled();
    expect(linesOf(reply)[0]).toBe(text.launchStarted("mock up.html", false));
    // Every action carries the path, so none of them acts on the workspace folder's launcher.
    expect(reply).toMatchObject({
      actions: [
        { label: text.launchOpenInEditor, command: `/launch "${file}"` },
        { label: text.launchOpenExternal, command: `/launch external "${file}"` },
        { label: text.launchStopChoice, command: `/launch stop "${file}"` },
      ],
    });
    const again = await launch(file);
    expect(start).toHaveBeenCalledOnce();
    expect(linesOf(again)[0]).toBe(text.launchReopened("mock up.html", false));
  });

  it("a page launch does not collide with the workspace folder's launcher", async () => {
    const file = path.join(app.path, "a.html");
    const { start, launch } = setup({ [file]: "" });
    await launch(file);
    await launch();
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[1]![0]).toEqual({ projectDir: app.path, manifestText: "{\"detected\":true}" });
  });

  it("/launch <folder> with an index page launches it as a page, the same launcher as typing the file", async () => {
    const dir = path.join(app.path, ".design");
    const { start, launch } = setup({ [path.join(dir, "Index.HTML")]: "", [path.join(dir, "x.css")]: "" });
    await launch(dir);
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0]![0]).toMatchObject({ projectDir: dir, page: "/Index.HTML" });
    const again = await launch(path.join(dir, "Index.HTML"));
    expect(start).toHaveBeenCalledOnce();
    expect(linesOf(again)[0]).toBe(composerCommandText().launchReopened("Index.HTML", false));
  });

  it("/launch <folder> with a manifest launches it as a project (its manifest, no page, no detection)", async () => {
    const dir = path.join(app.path, "site");
    const { start, detect, launch } = setup({ [path.join(dir, ".builderforce", "builderforce.json")]: "{}" });
    const reply = await launch(dir);
    expect(start).toHaveBeenCalledExactlyOnceWith({ projectDir: dir });
    expect(detect).not.toHaveBeenCalled();
    expect(linesOf(reply)[0]).toBe(composerCommandText().launchStarted("site", false));
  });

  it("/launch <folder> with neither manifest nor index page detects, shows the notes, or says there is nothing to run", async () => {
    const dir = path.join(app.path, "docs");
    const { start, detect, launch } = setup({ [path.join(dir, "readme.md")]: "x" });
    const notes = [detectionNote("secrets-to-vault", { names: ["API_KEY"] })];
    detect.mockReturnValueOnce({ text: "{}", services: [], resources: [], notes });
    const reply = await launch(dir);
    const text = composerCommandText();
    expect(start).toHaveBeenCalledExactlyOnceWith({ projectDir: dir, manifestText: "{}" });
    expect(linesOf(reply)).toEqual([text.launchStarted("docs", false), ...text.noteLines(notes)]);

    const empty = setup({ [path.join(dir, "readme.md")]: "x" });
    empty.detect.mockReturnValueOnce({ text: "{}", services: [], resources: [], notes: [], recognised: false });
    expect(linesOf(await empty.launch(dir))).toEqual([text.launchNothingToRun(dir)]);
    expect(empty.start).not.toHaveBeenCalled();
  });

  it("refuses a file that is not an HTML page (offering its folder), and says when a path does not exist", async () => {
    const file = path.join(app.path, "notes.txt");
    const { start, launch } = setup({ [file]: "x" });
    const text = composerCommandText();
    const refused = await launch(file);
    expect(linesOf(refused)).toEqual([text.launchNotHtml(file)]);
    expect(refused).toMatchObject({ actions: [{ label: text.launchFolderAction, command: `/launch "${app.path}"` }] });
    expect(linesOf(await launch("gone/none.html"))).toEqual([text.launchNoSuchPath("gone/none.html")]);
    expect(start).not.toHaveBeenCalled();
  });

  it("launches a directory outside the workspace only on approval, naming the directory that will be served", async () => {
    const outside = path.join(FS_ROOT, "elsewhere", "site");
    const approved = setup({ [path.join(outside, "index.html")]: "" });
    await approved.launch(outside);
    expect(approved.port.asked).toEqual([{ message: composerCommandText().launchOutsideQuestion(outside), approve: composerCommandText().launchOutsideApprove }]);
    expect(approved.start).toHaveBeenCalledOnce();

    const declined = setup({ [path.join(outside, "index.html")]: "" });
    declined.port.approve = false;
    const reply = await declined.launch(outside);
    expect(linesOf(reply)).toEqual([composerCommandText().launchOutsideDeclined(outside)]);
    expect(declined.start).not.toHaveBeenCalled();
  });

  it("launches a directory inside a workspace folder without asking", async () => {
    const { port, start, launch } = setup({ [at("site", "index.html")]: "" });
    await launch(at("site"));
    expect(port.asked).toEqual([]);
    expect(start).toHaveBeenCalledOnce();
  });

  it("never launches a drive root or the home folder, and never asks about them", async () => {
    const home = path.join(FS_ROOT, "home", "me");
    const { port, start, launch } = setup({ [path.join(home, "readme.md")]: "x" }, [app], { home });
    const text = composerCommandText();
    expect(linesOf(await launch(FS_ROOT))).toEqual([text.launchRootRefused(FS_ROOT)]);
    expect(linesOf(await launch(home))).toEqual([text.launchHomeRefused(home)]);
    expect(port.asked).toEqual([]);
    expect(start).not.toHaveBeenCalled();
  });

  it("/launch stop <path> and /launch external <path> act on that page's launcher, not the workspace folder's", async () => {
    const file = at("a.html");
    const { start, started, openExternal, launch } = setup({ [file]: "" });
    await launch(file);
    await launch();
    expect(start).toHaveBeenCalledTimes(2);
    const reopened = await launch("external", file);
    expect(openExternal).toHaveBeenLastCalledWith(started[0]!.launcher.url);
    expect(linesOf(reopened)[0]).toBe(composerCommandText().launchReopened("a.html", true));
    expect(linesOf(await launch("stop", file))).toEqual([composerCommandText().launchStopped("a.html")]);
    expect(started[0]!.launcher.close).toHaveBeenCalledOnce();
    expect(started[1]!.launcher.close).not.toHaveBeenCalled();
  });

  it("refuses a name that is no declared environment (the parser's bad-choice wording) and starts nothing; a declared one runs", async () => {
    const { start, launch } = setup({}, [app], { environments: ["staging", "prod.eu"] });
    const text = composerCommandText();
    const reply = await launch("stagign");
    expect(linesOf(reply)).toEqual([
      text.invalid("launch"),
      text.problem({ code: "bad-choice", name: "environment", value: "stagign", choices: ["staging", "prod.eu", "external", "stop", "trust"] }),
    ]);
    expect(start).not.toHaveBeenCalled();
    await launch("prod.eu");
    expect(start).toHaveBeenCalledWith({ projectDir: app.path, environment: "prod.eu", manifestText: "{\"detected\":true}" });
  });

  it("words the launcher's own refusal of a page", async () => {
    const file = at("a.html");
    const { start, launch } = setup({ [file]: "" });
    start.mockRejectedValueOnce(Object.assign(new Error("The page does not exist"), { name: "LaunchPageError", code: "missing", page: "/a.html" }));
    expect(await launch(file)).toMatchObject({ tone: "error", lines: [composerCommandText().launchPageProblem("missing", "/a.html")] });
  });

  it("carries a path with a double quote in single quotes, and offers no action for one that cannot be quoted", async () => {
    const quoted = at("say \"hi\".html");
    const both = at("a\"b'c.html");
    const { launch } = setup({ [quoted]: "", [both]: "" });
    expect(await launch(quoted)).toMatchObject({ actions: [{ command: `/launch '${quoted}'` }, { command: `/launch external '${quoted}'` }, { command: `/launch stop '${quoted}'` }] });
    expect(await launch(both)).toMatchObject({ actions: [] });
  });

  it("two quick /launch calls of the same path start ONE launcher, and both get it", async () => {
    const file = at("a.html");
    const { start, started, launch } = setup({ [file]: "" });
    const [first, second] = await Promise.all([launch(file), launch(file)]);
    expect(start).toHaveBeenCalledOnce();
    expect(started).toHaveLength(1);
    expect(first).toMatchObject({ link: started[0]!.launcher.url });
    expect(second).toMatchObject({ link: started[0]!.launcher.url });
  });

  it("/launch stop <typo> stops nothing — never the workspace folder's launcher", async () => {
    const { started, launch } = setup();
    await launch();
    const reply = await launch("stop", "typo");
    expect(linesOf(reply)).toEqual([composerCommandText().launchNoSuchPath("typo")]);
    expect(started[0]!.launcher.close).not.toHaveBeenCalled();
  });

  it("/launch stop <page> still finds the launcher after the page was deleted", async () => {
    const file = at("gone.html");
    const { port, started, launch } = setup({ [file]: "" });
    await launch(file);
    port.files.delete(file);
    expect(linesOf(await launch("stop", file))).toEqual([composerCommandText().launchStopped("gone.html")]);
    expect(started[0]!.launcher.close).toHaveBeenCalledOnce();
  });

  it("/launch stop <dir> still finds a folder launched before its index page appeared", async () => {
    const dir = at("site");
    const { port, started, launch } = setup({ [path.join(dir, "readme.md")]: "x" });
    await launch(dir);
    expect(started).toHaveLength(1);
    port.files.set(path.join(dir, "index.html"), "");
    expect(linesOf(await launch("stop", dir))).toEqual([composerCommandText().launchStopped("site")]);
    expect(started[0]!.launcher.close).toHaveBeenCalledOnce();
  });

  it("/launch stop <dir> still finds a launcher started through its index page after that page was deleted", async () => {
    const dir = at("site");
    const index = path.join(dir, "index.html");
    const { port, started, launch } = setup({ [index]: "" });
    await launch(dir);
    port.files.delete(index);
    port.files.set(path.join(dir, "readme.md"), "x");
    expect(linesOf(await launch("stop", dir))).toEqual([composerCommandText().launchStopped("index.html")]);
    expect(started[0]!.launcher.close).toHaveBeenCalledOnce();
  });

  it("names the REAL directory it asks to serve, whatever link was typed", async () => {
    const real = path.join(FS_ROOT, "elsewhere", "site");
    const alias = path.join(FS_ROOT, "alias");
    const { port, launch } = setup({ [path.join(real, "index.html")]: "" });
    port.links.set(alias, real);
    await launch(alias);
    expect(port.asked[0]!.message).toBe(composerCommandText().launchOutsideQuestion(real));
  });

  it("judges an environment name by the CHOSEN folder's environments, before stopping or starting anything", async () => {
    const other = folderRef("other");
    const perFolder = (folder?: WorkspaceFolderRef) => (folder?.name === "other" ? ["only-in-other"] : folder ? ["staging"] : ["staging", "only-in-other"]);
    const { port, start, launch } = setup({}, [app, other], { environments: perFolder });
    port.picked = app;
    const reply = await launch("only-in-other");
    expect(linesOf(reply)[0]).toBe(composerCommandText().invalid("launch"));
    expect(start).not.toHaveBeenCalled();
    port.picked = other;
    await launch("only-in-other");
    expect(start).toHaveBeenCalledOnce();
  });

  it("a folder that declares no environments refuses an unknown name before stopping its running launcher; detected folders accept the detected one", async () => {
    const { start, started, detect, launch } = setup({}, [app], { environments: [] });
    detect.mockReturnValue({ text: JSON.stringify({ version: 1, environments: { local: {} } }), services: ["web"], resources: [], notes: [] });
    await launch(); // running, on the detected manifest
    const refused = await launch("bogus");
    expect(linesOf(refused)[0]).toBe(composerCommandText().invalid("launch"));
    expect(started[0]!.launcher.close).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledOnce();
    await launch("local");
    expect(start).toHaveBeenCalledTimes(2); // `local` is the detected manifest's own environment: it runs (replacing the default)

    const withManifest = setup({ [at(".builderforce", "builderforce.json")]: "{\"version\":1}" }, [app], { environments: [] });
    await withManifest.launch();
    expect(linesOf(await withManifest.launch("staging"))[0]).toBe(composerCommandText().invalid("launch"));
    expect(withManifest.started[0]!.launcher.close).not.toHaveBeenCalled();
  });

  it("a dotted name that is no path, with environments known, gets the bad-environment wording; a drive-relative path asks for a full one", async () => {
    const { start, launch } = setup({}, [app], { environments: ["prod.eu"] });
    const text = composerCommandText();
    expect(linesOf(await launch("prod.eau"))[0]).toBe(text.invalid("launch"));
    if (process.platform === "win32") expect(linesOf(await launch("C:foo.html"))).toEqual([text.launchNeedsFullPath("C:foo.html")]);
    expect(start).not.toHaveBeenCalled();
  });

  it("a second /launch that waits on a start which then fails gets the failure as a reply, not a throw", async () => {
    const text = composerCommandText();
    const pending = (start: ReturnType<typeof setup>["start"]) => {
      let fail!: (error: Error) => void;
      start.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
      return (error: Error) => fail(error);
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    const workspace = setup();
    const failWorkspace = pending(workspace.start);
    const first = workspace.launch();
    await settle();
    const second = workspace.launch(); // reopens the launcher that is still starting
    await settle();
    failWorkspace(new Error("dist missing"));
    for (const reply of await Promise.all([first, second])) expect(reply).toMatchObject({ tone: "error", lines: [text.launchFailed("dist missing")] });

    const file = at("a.html");
    const page = setup({ [file]: "" });
    const failPage = pending(page.start);
    const firstPage = page.launch(file);
    await settle();
    const secondPage = page.launch("external", file); // acts on the held, still-starting launcher
    await settle();
    failPage(Object.assign(new Error("x"), { name: "LaunchPageError", code: "missing", page: "/a.html" }));
    for (const reply of await Promise.all([firstPage, secondPage])) {
      expect(reply).toMatchObject({ tone: "error", lines: [text.launchPageProblem("missing", "/a.html")] });
    }
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
    expect(await launchers.running(app.path)).toBeUndefined();
  });
});
