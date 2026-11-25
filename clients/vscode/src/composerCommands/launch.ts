/**
 * `/launch [environment | <file or folder path> | external | stop | trust] [<path>]` (PRD 31 §W11, "Local launch from the VSIX"):
 * run the workspace folder's app — or an HTML page / folder named by path (`launchTarget.ts`) —
 * through the runtime's local launcher (`createLocalLauncher`)
 * and open it in VS Code's NATIVE integrated browser (a Chromium view, `openExternal.ts`) when
 * this VS Code has one; `/launch external` opens the system browser instead. Never the Simple
 * Browser or a webview: an iframe gets no service worker, cannot click through a certificate
 * warning, and the launcher page refuses to be framed (`frame-ancestors 'none'`).
 * - No integrated browser, an untrusted certificate, or an open that throws ⇒ the system
 *   browser opens, and the reply says why. The reply never claims VS Code opened it when it did not.
 * - `external` / `stop` / `trust` are always the subcommand, never an environment of that name
 *   (`LAUNCH_SUBCOMMANDS`; `entries.ts` leaves such environments out of the choices). Each takes an
 *   optional path (`/launch stop <path>`) and then works on that page or folder's launcher.
 *
 * - A legacy root manifest still runs; the reply says it is deprecated and offers `/manifest move`.
 * - A `.builderforce/builderforce.json` that still carries the stale `$schema` older versions
 *   wrote (`manifestSchema.ts`) runs too; the reply says why VS Code reports a problem in it and
 *   offers its removal (`/manifest move`, `staleSchemaAction`).
 * - No manifest (`.builderforce/builderforce.json`, nor a legacy root file — `manifestLocation.ts`)
 *   ⇒ the app is detected and its manifest passed in memory
 *   (`manifestText`), and the reply says so (save it with `/manifest init`) with detection's
 *   notes, worded as `/manifest init` words them.
 * - Unavailable in a remote extension host (`entries.ts`): the launcher binds loopback on
 *   the host, which is not the person's computer there.
 * - ONE launcher per folder or page (`FolderLaunchers`, which owns the key rule): a second `/launch`
 *   (or `/launch external`) reopens it; another environment restarts it; `/launch stop` closes it.
 * - A path target is held under its own path (the page's file, or the folder); a path that is a workspace
 *   folder is that folder's launcher. A page runs the static-site manifest (`emitStaticSiteManifest`) with
 *   its `page` shown at `/`; a folder runs its manifest, else a detected one (nothing detected ⇒ nothing to
 *   launch, said). A directory outside every workspace folder is launched only on approval, and a drive root
 *   or the home folder never (`launchScope.ts`): the launcher serves the whole directory to the page.
 * - The URL carries the per-launch token in its fragment: it is shown in the chat, and
 *   never written to the output channel.
 * - The launcher serves HTTPS from a local CA: before the browser opens, the person is asked
 *   once per CA whether to trust it (`launcherTrust.ts`); `/launch trust` asks again.
 */
import * as os from "node:os";
import * as path from "node:path";
import { emitStaticSiteManifest } from "@builderforce/app-detect";
import type { ComposerCommandExecutor } from "./dispatch";
import type { ComposerCommandText } from "./labels";
import { LAUNCH_COMMAND_ID, LAUNCH_EXTERNAL, LAUNCH_STOP, LAUNCH_SUBCOMMANDS, LAUNCH_TRUST } from "./entries";
import { NO_TRUST_STEP, type LauncherCa, type TrustOutcome } from "./launcherTrust";
import type { FolderLaunchers, HeldLauncher, RunningLauncher } from "./folderLaunchers";
import { launchScope } from "./launchScope";
import { pageFile, quoteCommandArg, resolveLaunchTarget, typedCandidates, type PathTarget } from "./launchTarget";
import type { DetectedManifest, DetectManifest, ReadFolderFiles } from "./manifestInit";
import { findFolderManifest, MANIFEST_PATH } from "./manifestLocation";
import { legacyManifestAction, staleSchemaAction } from "./manifestMove";
import { APP_MANIFEST_SCHEMA_URL, hasStaleSchema } from "./manifestSchema";
import { messageOf } from "../messageOf";
import { chooseFolder, type ComposerWorkspacePort, type WorkspaceFolderRef } from "./workspacePort";
import type { EditorBrowser } from "./openExternal";
import type { ComposerReply, ComposerReplyAction } from "./reply";

/** What `createLocalLauncher` is called with (its options, less what tests override). */
export interface LaunchRequest {
  projectDir: string;
  environment?: string;
  manifestText?: string;
  /** A top-level HTML file (`/mockup.html`) shown at `/` (`LocalLauncherOptions.page`). */
  page?: string;
}

/** The commands a reply's actions run to reopen, stop or trust a launcher; absent ⇒ no such action. */
interface OpenCommands {
  editor?: string;
  external?: string;
  trust?: string;
  stop?: string;
}

const WORKSPACE_COMMANDS: OpenCommands = {
  editor: `/${LAUNCH_COMMAND_ID}`,
  external: `/${LAUNCH_COMMAND_ID} ${LAUNCH_EXTERNAL}`,
  trust: `/${LAUNCH_COMMAND_ID} ${LAUNCH_TRUST}`,
};

/** The commands that carry a path (`/launch stop "<path>"`); none when the path cannot be quoted for the composer. */
function pathCommands(file: string): OpenCommands {
  const quoted = quoteCommandArg(file);
  if (quoted === undefined) return {};
  const command = (subcommand?: string) => `/${LAUNCH_COMMAND_ID}${subcommand ? ` ${subcommand}` : ""} ${quoted}`;
  return { editor: command(), external: command(LAUNCH_EXTERNAL), trust: command(LAUNCH_TRUST), stop: command(LAUNCH_STOP) };
}

/** The launcher's own refusal of a page (`LaunchPageError`, by name: the published runtime may predate the class), if that is what this is. */
function pageRefusal(error: unknown): { code: string; page: string } | undefined {
  const { name, code, page } = error as { name?: unknown; code?: unknown; page?: unknown };
  return name === "LaunchPageError" && typeof code === "string" && typeof page === "string" ? { code, page } : undefined;
}

export interface LaunchDeps {
  port: ComposerWorkspacePort;
  text: ComposerCommandText;
  launchers: FolderLaunchers;
  /** `createLocalLauncher` with the host's own options (`distDir`, labels) bound in. */
  start: (request: LaunchRequest) => Promise<RunningLauncher>;
  /** Open in the system browser (`/launch external`, the reply's "Open in external browser", and every fallback). */
  openExternal: (url: string) => Promise<void>;
  /** VS Code's native integrated browser (`openExternal.ts`) — what `/launch` opens when this VS Code has it. */
  editorBrowser: EditorBrowser;
  readFiles: ReadFolderFiles;
  detect: DetectManifest;
  /** The certificate step (`launcherTrust.ts`), run before the browser opens. Omitted ⇒ none. */
  trust?: (ca: LauncherCa | null | undefined, force: boolean) => Promise<TrustOutcome>;
  /**
   * The environment names a folder's manifest declares, or (no folder) every open folder's. Omitted ⇒ unknown:
   * any name passes through to the launcher.
   */
  environments?: (folder?: WorkspaceFolderRef) => Promise<readonly string[]>;
  /** The user's home directory, which is never launched (default: the OS's). */
  homeDir?: string;
}

export function launchExecutor(deps: LaunchDeps): ComposerCommandExecutor {
  const { port, text, launchers } = deps;
  /**
   * Where `/launch` (not `external`) opens: VS Code's integrated browser — unless this VS Code has
   * none, the certificate is not trusted (it cannot click through the warning), or opening it
   * throws. Then the system browser opens, and the returned line says why.
   */
  const openInEditor = async (url: string, available: boolean, trusted: boolean): Promise<{ external: boolean; why?: string }> => {
    if (!available) return { external: true, why: text.launchEditorUnavailable };
    if (!trusted) return { external: true, why: text.launchEditorUntrusted };
    try {
      await deps.editorBrowser.open(url);
      return { external: false };
    } catch (error) {
      return { external: true, why: text.launchEditorFailed(messageOf(error)) };
    }
  };

  /**
   * Ask about the launcher's certificate (BEFORE any browser opens on it), then open it, and say
   * where it actually opened. "Open in VS Code" is offered only when this VS Code has the
   * integrated browser; "Open in external browser" always (for the commands that have one).
   */
  const trustThenOpen = async (
    launcher: RunningLauncher,
    headline: (external: boolean) => string,
    more: string[],
    force: boolean,
    askedExternal: boolean,
    moreActions: ComposerReplyAction[] = [],
    commands: OpenCommands = WORKSPACE_COMMANDS,
  ): Promise<ComposerReply> => {
    const trust: TrustOutcome = deps.trust ? await deps.trust(launcher.ca, force) : NO_TRUST_STEP;
    const available = await deps.editorBrowser.available();
    const where: { external: boolean; why?: string } = askedExternal
      ? { external: true }
      : await openInEditor(launcher.url, available, trust.trusted);
    if (where.external) await deps.openExternal(launcher.url);
    // In VS Code only on a trusted certificate; an untrusted one is offered `/launch trust` (which asks again, then opens there).
    const inEditor: ComposerReplyAction[] = !available
      ? []
      : trust.trusted
        ? (commands.editor ? [{ label: text.launchOpenInEditor, command: commands.editor }] : [])
        : (commands.trust ? [{ label: text.launchTrustAndOpenInEditor, command: commands.trust }] : []);
    const actions: ComposerReplyAction[] = [
      ...inEditor,
      ...(commands.external ? [{ label: text.launchOpenExternal, command: commands.external }] : []),
      ...(commands.stop ? [{ label: text.launchStopChoice, command: commands.stop }] : []),
      ...moreActions,
    ];
    return {
      kind: "text",
      tone: trust.failed ? "error" : "info",
      lines: [headline(where.external), ...(where.why ? [where.why] : []), ...more, ...trust.lines],
      link: launcher.url,
      actions,
    };
  };

  /** A launcher that failed to start (or to close for its replacement): reported, worded as the launcher's own refusal of a page when it is one. */
  const failed = (error: unknown): ComposerReply => {
    const refusal = pageRefusal(error);
    return { kind: "text", tone: "error", lines: [refusal ? text.launchPageProblem(refusal.code, refusal.page) : text.launchFailed(messageOf(error))] };
  };

  /** The workspace folder's own app: `asked` is an environment or a subcommand. */
  const launchWorkspace = async (folder: WorkspaceFolderRef, asked: string | undefined): Promise<ComposerReply> => {
    // `/launch trust`: launch (or reopen) as `/launch` does, asking about the certificate again.
    const forceTrust = asked === LAUNCH_TRUST;
    // `/launch external`: launch (or reopen — never restart) as `/launch` does, in the system browser.
    const external = asked === LAUNCH_EXTERNAL;
    // Every subcommand (`LAUNCH_SUBCOMMANDS`) is consumed here or just below — none reaches `start` as an environment.
    const choice = forceTrust || external ? undefined : asked;

    if (choice === LAUNCH_STOP) {
      const stopped = await launchers.stop(folder.path);
      return { kind: "text", tone: "info", lines: [stopped ? text.launchStopped(folder.name) : text.launchNotRunning(folder.name)] };
    }

    const running = await launchers.running(folder.path);
    if (running && (choice === undefined || choice === running.environment)) {
      let held: RunningLauncher;
      try {
        held = await running.launcher; // still starting, perhaps — and that start may fail
      } catch (error) {
        return failed(error);
      }
      return trustThenOpen(held, (opened) => text.launchReopened(folder.name, opened), [], forceTrust, external);
    }
    // Another environment: `start` closes the folder's one launcher first, and a close that fails is reported with the start.

    const found = await findFolderManifest(port, folder);
    const detected = found ? undefined : deps.detect(await deps.readFiles(folder.path));
    const manifestText = detected?.text;
    let launcher: RunningLauncher;
    try {
      launcher = await launchers.start(folder.path, choice, () => deps.start({
        projectDir: folder.path,
        ...(choice !== undefined ? { environment: choice } : {}),
        ...(manifestText !== undefined ? { manifestText } : {}),
      }));
    } catch (error) {
      return failed(error);
    }
    // A detected manifest's notes are shown exactly as `/manifest init` shows them: what detection could not express is never dropped.
    const detectedLines = detected ? [text.launchDetected, ...text.noteLines(detected.notes)] : [];
    // A legacy root manifest still runs (the launcher reads it); the reply says it is deprecated and offers the move.
    const legacyLines = found?.legacy ? [text.manifestLegacy(found.relative, MANIFEST_PATH)] : [];
    const legacyActions = found?.legacy ? [legacyManifestAction(text)] : [];
    // The canonical file's stale `$schema` (a legacy file loses it when moved): said, and its removal offered.
    // Read after the launcher started: a file that cannot be read now (EACCES) never loses the reply.
    const stale = found && !found.legacy && hasStaleSchema(await port.readText(found.file).catch(() => undefined));
    const staleLines = stale ? [text.manifestStaleSchema(MANIFEST_PATH, APP_MANIFEST_SCHEMA_URL)] : [];
    const staleActions = stale ? [staleSchemaAction(text)] : [];
    return trustThenOpen(
      launcher, (opened) => text.launchStarted(folder.name, opened), [...detectedLines, ...legacyLines, ...staleLines], forceTrust, external,
      [...legacyActions, ...staleActions],
    );
  };

  /** A launcher that is already held: `stop` closes it; anything else reopens it (`external`, `trust`, or plain). */
  const actOnHeld = async (held: HeldLauncher, subcommand: string | undefined): Promise<ComposerReply> => {
    const name = path.basename(held.path) || held.path;
    if (subcommand === LAUNCH_STOP) {
      const stopped = await launchers.stop(held);
      return { kind: "text", tone: "info", lines: [stopped ? text.launchStopped(name) : text.launchNotRunning(name)] };
    }
    let launcher: RunningLauncher;
    try {
      launcher = await held.launcher; // still starting, perhaps — and that start may fail
    } catch (error) {
      return failed(error);
    }
    return trustThenOpen(
      launcher, (opened) => text.launchReopened(name, opened), [], subcommand === LAUNCH_TRUST, subcommand === LAUNCH_EXTERNAL, [], pathCommands(held.path),
    );
  };

  /**
   * A page or a folder named by path, under its own key. `subcommand` is `stop`, `external` or `trust`
   * (`/launch stop <path>`). A new launch of a directory outside the workspace is approved first, and a
   * drive root or the home folder is refused (`launchScope.ts`).
   */
  const launchPath = async (target: PathTarget, subcommand: string | undefined): Promise<ComposerReply> => {
    const file = target.kind === "page" ? pageFile(target) : target.projectDir;
    const name = path.basename(file) || file;
    const forceTrust = subcommand === LAUNCH_TRUST;
    const external = subcommand === LAUNCH_EXTERNAL;
    // Held by the page's file or folder, or by the path that was typed (a folder that gained an index page, a page deleted since).
    const running = await launchers.held([file, target.via]);
    if (running) return actOnHeld(running, subcommand);
    if (subcommand === LAUNCH_STOP) return { kind: "text", tone: "info", lines: [text.launchNotRunning(name)] };

    // What will be served is named by its REAL path, whatever link was typed.
    const { scope, real } = await launchScope(port, target.projectDir, deps.homeDir ?? os.homedir());
    if (scope === "root") return { kind: "text", tone: "info", lines: [text.launchRootRefused(real)] };
    if (scope === "home") return { kind: "text", tone: "info", lines: [text.launchHomeRefused(real)] };
    if (scope === "outside" && !(await port.confirm(text.launchOutsideQuestion(real), text.launchOutsideApprove))) {
      return { kind: "text", tone: "info", lines: [text.launchOutsideDeclined(real)] };
    }
    // Another `/launch` of the same path may have started it while the person was asked.
    const raced = await launchers.held([file, target.via]);
    if (raced) return actOnHeld(raced, subcommand);

    let request: LaunchRequest;
    let detected: DetectedManifest | undefined;
    if (target.kind === "page") {
      request = { projectDir: target.projectDir, manifestText: emitStaticSiteManifest(path.basename(file, path.extname(file))).text, page: target.page };
    } else {
      detected = target.hasManifest ? undefined : deps.detect(await deps.readFiles(target.projectDir));
      if (detected?.recognised === false) return { kind: "text", tone: "info", lines: [text.launchNothingToRun(target.projectDir)] };
      request = { projectDir: target.projectDir, ...(detected ? { manifestText: detected.text } : {}) };
    }
    let launcher: RunningLauncher;
    try {
      launcher = await launchers.start(file, undefined, () => deps.start(request), [target.via]);
    } catch (error) {
      return failed(error);
    }
    const notes = detected ? text.noteLines(detected.notes) : [];
    return trustThenOpen(launcher, (opened) => text.launchStarted(name, opened), notes, forceTrust, external, [], pathCommands(file));
  };

  /** The environments of the manifest detection would run for a folder that has none (`emitManifest` writes `local`). */
  const detectedEnvironments = async (folder: WorkspaceFolderRef): Promise<string[]> => {
    const manifest = JSON.parse(deps.detect(await deps.readFiles(folder.path)).text) as { environments?: Record<string, unknown> };
    return Object.keys(manifest.environments ?? {});
  };

  /** `value` is no environment of `known`: the parser's bad-choice wording, and nothing starts or stops. */
  const badEnvironment = (value: string, known: readonly string[]): ComposerReply => ({
    kind: "text",
    tone: "info",
    lines: [text.invalid(LAUNCH_COMMAND_ID), text.problem({ code: "bad-choice", name: "environment", value, choices: [...known, ...LAUNCH_SUBCOMMANDS] })],
  });

  return async (args) => {
    const asked = typeof args.environment === "string" ? args.environment : undefined;
    const subcommand = asked !== undefined && LAUNCH_SUBCOMMANDS.has(asked) ? asked : undefined;
    // `/launch <path>`: the path is the first argument; `/launch stop <path>`: the second.
    const typed = subcommand ? (typeof args.target === "string" ? args.target : undefined) : asked;
    // A subcommand names a launcher that is already held by the path as typed — before any stat, so it works after the file changed.
    if (subcommand && typed !== undefined) {
      const held = await launchers.held(typedCandidates(port, typed));
      if (held) return actOnHeld(held, subcommand);
    }
    // Every open folder's environments: for parsing and for telling an environment from a path.
    const declared = subcommand || !deps.environments ? undefined : await deps.environments();
    const target = await resolveLaunchTarget(port, typed, declared);
    // `/launch stop <typo>` never falls back to the workspace folder's launcher.
    if (subcommand && typed !== undefined && target.kind === "workspace") return { kind: "text", tone: "info", lines: [text.launchNoSuchPath(typed)] };
    switch (target.kind) {
      case "page":
      case "folder":
        return launchPath(target, subcommand);
      case "workspaceFolder":
        return launchWorkspace(target.folder, subcommand);
      case "notPage": {
        const folder = quoteCommandArg(path.dirname(target.file));
        return {
          kind: "text",
          tone: "info",
          lines: [text.launchNotHtml(target.file)],
          ...(folder ? { actions: [{ label: text.launchFolderAction, command: `/${LAUNCH_COMMAND_ID} ${folder}` }] } : {}),
        };
      }
      case "missing":
        // A dotted name with no separator, with environments known, is a mistyped environment more than a path.
        return target.bare && declared && declared.length > 0
          ? badEnvironment(target.argument, declared)
          : { kind: "text", tone: "info", lines: [text.launchNoSuchPath(target.argument)] };
      case "needsFullPath":
        return { kind: "text", tone: "info", lines: [text.launchNeedsFullPath(target.argument)] };
      case "workspace": {
        const folder = await chooseFolder(port, text.pickFolder);
        if (!folder) return { kind: "text", tone: "info", lines: [text.noFolderChosen] };
        // The CHOSEN folder's own environments judge the name, before anything is stopped or started.
        if (asked !== undefined && !subcommand && deps.environments) {
          const declared = await deps.environments(folder);
          // A folder with a manifest is judged by what it declares (nothing declared: any name is wrong); one with none runs a
          // DETECTED manifest, which declares its own (`local`).
          const own = declared.length > 0 || (await findFolderManifest(port, folder)) ? declared : await detectedEnvironments(folder);
          if (!own.includes(asked)) return badEnvironment(asked, own);
        }
        return launchWorkspace(folder, asked);
      }
    }
  };
}
