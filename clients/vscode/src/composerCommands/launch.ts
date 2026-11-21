/**
 * `/launch [environment | external | stop | trust]` (PRD 31 §W11, "Local launch from the VSIX"):
 * run the workspace folder's app through the runtime's local launcher (`createLocalLauncher`)
 * and open it in VS Code's NATIVE integrated browser (a Chromium view, `openExternal.ts`) when
 * this VS Code has one; `/launch external` opens the system browser instead. Never the Simple
 * Browser or a webview: an iframe gets no service worker, cannot click through a certificate
 * warning, and the launcher page refuses to be framed (`frame-ancestors 'none'`).
 * - No integrated browser, an untrusted certificate, or an open that throws ⇒ the system
 *   browser opens, and the reply says why. The reply never claims VS Code opened it when it did not.
 * - `external` / `stop` / `trust` are always the subcommand, never an environment of that name
 *   (`LAUNCH_SUBCOMMANDS`; `entries.ts` leaves such environments out of the choices).
 *
 * - A legacy root manifest still runs; the reply says it is deprecated and offers `/manifest move`.
 * - No manifest (`.builderforce/builderforce.json`, nor a legacy root file — `manifestLocation.ts`)
 *   ⇒ the app is detected and its manifest passed in memory
 *   (`manifestText`), and the reply says so (save it with `/manifest init`) with detection's
 *   notes, worded as `/manifest init` words them.
 * - Unavailable in a remote extension host (`entries.ts`): the launcher binds loopback on
 *   the host, which is not the person's computer there.
 * - ONE launcher per folder (`FolderLaunchers`): a second `/launch` (or `/launch external`)
 *   reopens it; another environment restarts it; `/launch stop` closes it.
 * - The URL carries the per-launch token in its fragment: it is shown in the chat, and
 *   never written to the output channel.
 * - The launcher serves HTTPS from a local CA: before the browser opens, the person is asked
 *   once per CA whether to trust it (`launcherTrust.ts`); `/launch trust` asks again.
 */
import type { ComposerCommandExecutor } from "./dispatch";
import type { ComposerCommandText } from "./labels";
import { LAUNCH_COMMAND_ID, LAUNCH_EXTERNAL, LAUNCH_STOP, LAUNCH_TRUST } from "./entries";
import { NO_TRUST_STEP, type LauncherCa, type TrustOutcome } from "./launcherTrust";
import type { FolderLaunchers, RunningLauncher } from "./folderLaunchers";
import type { DetectManifest, ReadFolderFiles } from "./manifestInit";
import { findFolderManifest, MANIFEST_PATH } from "./manifestLocation";
import { legacyManifestAction } from "./manifestMove";
import { chooseFolder, type ComposerWorkspacePort } from "./workspacePort";
import type { EditorBrowser } from "./openExternal";
import type { ComposerReply, ComposerReplyAction } from "./reply";

/** What `createLocalLauncher` is called with (its options, less what tests override). */
export interface LaunchRequest {
  projectDir: string;
  environment?: string;
  manifestText?: string;
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
      return { external: true, why: text.launchEditorFailed(error instanceof Error ? error.message : String(error)) };
    }
  };

  /**
   * Ask about the launcher's certificate (BEFORE any browser opens on it), then open it, and say
   * where it actually opened. "Open in VS Code" is offered only when this VS Code has the
   * integrated browser; "Open in external browser" always.
   */
  const trustThenOpen = async (
    launcher: RunningLauncher,
    headline: (external: boolean) => string,
    more: string[],
    force: boolean,
    askedExternal: boolean,
    moreActions: ComposerReplyAction[] = [],
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
        ? [{ label: text.launchOpenInEditor, command: `/${LAUNCH_COMMAND_ID}` }]
        : [{ label: text.launchTrustAndOpenInEditor, command: `/${LAUNCH_COMMAND_ID} ${LAUNCH_TRUST}` }];
    const actions: ComposerReplyAction[] = [
      ...inEditor,
      { label: text.launchOpenExternal, command: `/${LAUNCH_COMMAND_ID} ${LAUNCH_EXTERNAL}` },
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

  return async (args) => {
    const asked = typeof args.environment === "string" ? args.environment : undefined;
    // `/launch trust`: launch (or reopen) as `/launch` does, asking about the certificate again.
    const forceTrust = asked === LAUNCH_TRUST;
    // `/launch external`: launch (or reopen — never restart) as `/launch` does, in the system browser.
    const external = asked === LAUNCH_EXTERNAL;
    // Every subcommand (`LAUNCH_SUBCOMMANDS`) is consumed here or just below — none reaches `start` as an environment.
    const choice = forceTrust || external ? undefined : asked;
    const folder = await chooseFolder(port, text.pickFolder);
    if (!folder) return { kind: "text", tone: "info", lines: [text.noFolderChosen] };

    if (choice === LAUNCH_STOP) {
      const stopped = await launchers.stop(folder.path);
      return { kind: "text", tone: "info", lines: [stopped ? text.launchStopped(folder.name) : text.launchNotRunning(folder.name)] };
    }

    const running = launchers.running(folder.path);
    if (running && (choice === undefined || choice === running.environment)) {
      return trustThenOpen(await running.launcher, (opened) => text.launchReopened(folder.name, opened), [], forceTrust, external);
    }
    // Another environment: the folder's one launcher is restarted for it.
    if (running) await launchers.stop(folder.path);

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
      return { kind: "text", tone: "error", lines: [text.launchFailed(error instanceof Error ? error.message : String(error))] };
    }
    // A detected manifest's notes are shown exactly as `/manifest init` shows them: what detection could not express is never dropped.
    const detectedLines = detected ? [text.launchDetected, ...text.noteLines(detected.notes)] : [];
    // A legacy root manifest still runs (the launcher reads it); the reply says it is deprecated and offers the move.
    const legacyLines = found?.legacy ? [text.manifestLegacy(found.relative, MANIFEST_PATH)] : [];
    const legacyActions = found?.legacy ? [legacyManifestAction(text)] : [];
    return trustThenOpen(
      launcher, (opened) => text.launchStarted(folder.name, opened), [...detectedLines, ...legacyLines], forceTrust, external, legacyActions,
    );
  };
}
