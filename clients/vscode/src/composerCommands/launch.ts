/**
 * `/launch [environment | stop]` (PRD 31 §W11, "Local launch from the VSIX"): run the
 * workspace folder's app in a real browser through the runtime's local launcher
 * (`createLocalLauncher`) — a VS Code webview cannot register the runtime's service worker.
 *
 * - No `builderforce.json` ⇒ the app is detected and its manifest passed in memory
 *   (`manifestText`), and the reply says so (save it with `/manifest init`).
 * - ONE launcher per folder (`FolderLaunchers`): a second `/launch` reopens it; another
 *   environment restarts it; `/launch stop` closes it.
 * - The URL carries the per-launch token in its fragment: it is shown in the chat, and
 *   never written to the output channel.
 * - The launcher serves HTTPS from a local CA: before the browser opens, the person is asked
 *   once per CA whether to trust it (`launcherTrust.ts`); `/launch trust` asks again.
 */
import type { ComposerCommandExecutor } from "./dispatch";
import type { ComposerCommandText } from "./labels";
import { LAUNCH_COMMAND_ID, LAUNCH_STOP, LAUNCH_TRUST } from "./entries";
import type { TrustOutcome } from "./launcherTrust";
import type { FolderLaunchers, RunningLauncher } from "./folderLaunchers";
import { MANIFEST_FILE_NAME, type DetectManifest, type ReadFolderFiles } from "./manifestInit";
import { chooseFolder, inFolder, type ComposerWorkspacePort } from "./workspacePort";
import type { ComposerReply } from "./reply";

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
  openExternal: (url: string) => Promise<void>;
  readFiles: ReadFolderFiles;
  detect: DetectManifest;
  /** The certificate step (`launcherTrust.ts`), run before the browser opens. Omitted ⇒ none. */
  trust?: (caCertPath: string | undefined, force: boolean) => Promise<TrustOutcome>;
}

export function launchExecutor(deps: LaunchDeps): ComposerCommandExecutor {
  const { port, text, launchers } = deps;
  const opened = (url: string, lines: string[]): ComposerReply => ({
    kind: "text",
    tone: "info",
    lines,
    link: url,
    action: { label: text.launchOpenAgain, command: `/${LAUNCH_COMMAND_ID}` },
  });

  /** Ask about the launcher's certificate (BEFORE the browser opens on it), then open the browser. */
  const trustThenOpen = async (launcher: RunningLauncher, lines: string[], force: boolean): Promise<ComposerReply> => {
    const trust = deps.trust ? await deps.trust(launcher.caCertPath ?? undefined, force) : { lines: [], failed: false };
    await deps.openExternal(launcher.url);
    return { ...opened(launcher.url, [...lines, ...trust.lines]), ...(trust.failed ? { tone: "error" as const } : {}) };
  };

  return async (args) => {
    const asked = typeof args.environment === "string" ? args.environment : undefined;
    // `/launch trust`: launch (or reopen) as `/launch` does, asking about the certificate again.
    const forceTrust = asked === LAUNCH_TRUST;
    const choice = forceTrust ? undefined : asked;
    const folder = await chooseFolder(port, text.pickFolder);
    if (!folder) return { kind: "text", tone: "info", lines: [text.noFolderChosen] };

    if (choice === LAUNCH_STOP) {
      const stopped = await launchers.stop(folder.path);
      return { kind: "text", tone: "info", lines: [stopped ? text.launchStopped(folder.name) : text.launchNotRunning(folder.name)] };
    }

    const running = launchers.running(folder.path);
    if (running && (choice === undefined || choice === running.environment)) {
      return trustThenOpen(await running.launcher, [text.launchReopened(folder.name)], forceTrust);
    }
    // Another environment: the folder's one launcher is restarted for it.
    if (running) await launchers.stop(folder.path);

    const hasManifest = await port.exists(inFolder(folder, MANIFEST_FILE_NAME));
    const manifestText = hasManifest ? undefined : deps.detect(await deps.readFiles(folder.path)).text;
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
    return trustThenOpen(launcher, [text.launchStarted(folder.name), ...(hasManifest ? [] : [text.launchDetected])], forceTrust);
  };
}
