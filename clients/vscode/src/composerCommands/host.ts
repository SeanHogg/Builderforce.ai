/**
 * The composer commands' composition root in the extension host (PRD 31 §W11): the
 * registry for the current workspace, the four executors bound to the editor, and the
 * folder launchers — ONE per extension, closed on deactivate (`closeComposerLaunchers`,
 * awaited by `deactivate`; `context.subscriptions` as the fallback).
 *
 * The chat surface asks it two things: the `/help` model for the `/` menu's Actions tab
 * (`init`), and the answer to a composer line before any run starts (`composer.input`).
 */
import * as path from "node:path";
import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { caTrustCheckCommand, caTrustCommand, createLocalLauncher } from "@seanhogg/builderforce-webcontainers/launcher/server";
import { vsixForwardAi } from "./aiRelay";
import { watchComposerHelp } from "./helpRefresh";
import { ensureLauncherTrust, trustCommandRunner, type CaTrustDecision, type LauncherTrustDeps } from "./launcherTrust";
import { logLine } from "../diagnostics/errorReporter";
import { detectWorkspaceManifest } from "./detectManifest";
import { actionExecutor, handleComposerInput } from "./dispatch";
import { LAUNCH_COMMAND_ID, MANIFEST_COMMAND_ID, MANIFEST_INIT_ACTION, MANIFEST_MOVE_ACTION, STARTER_KIT_COMMAND_ID } from "./entries";
import { FolderLaunchers } from "./folderLaunchers";
import { composerCommandText, type ComposerCommandText } from "./labels";
import { launchExecutor } from "./launch";
import { launcherPageLabels } from "./launcherLabels";
import { manifestInitExecutor, type ReadFolderFiles } from "./manifestInit";
import { MANIFEST_READ_ORDER } from "./manifestLocation";
import { manifestMoveExecutor } from "./manifestMove";
import { integratedBrowser, openUrlVerbatim } from "./openExternal";
import type { ComposerCommandsInit, ComposerInputResult } from "./reply";
import { folderManifestWatchers } from "./folderManifestWatchers";
import { messageOf } from "../shared/messageOf";
import { starterKitExecutor } from "./starterKit";
import { registerManifestPreview, vscodeWorkspacePort } from "./vscodeWorkspacePort";
import { readWorkspaceFiles } from "./workspaceFiles";
import { folderEnvironments, launchEnvironmentChoices, workspaceRegistry } from "./workspaceRegistry";

export interface ComposerCommandHost {
  /** The `/help` model for the `/` menu's Actions tab. */
  init(): Promise<ComposerCommandsInit>;
  /** Answer a composer line: not a command, or the reply to show. Never reaches a model. */
  handle(text: string): Promise<ComposerInputResult>;
  /**
   * The help model, recomputed: a workspace folder was added/removed or a folder's
   * manifest was created/changed/deleted (`helpRefresh.ts`).
   */
  readonly onDidChangeHelp: vscode.Event<ComposerCommandsInit>;
}

/**
 * Where the launcher's browser assets ship inside the VSIX: `esbuild.mjs` copies the
 * runtime package's `dist/assets.js` and `dist/launcher/{index.html,page.js,launcher.css}`
 * here (`out/` ships; `node_modules/` does not).
 */
export const LAUNCHER_DIST_DIR = ["out", "bfwc"] as const;

/** Where the launcher keeps its local CA (in the extension's global storage, one per machine). */
const LAUNCHER_CA_DIR = "launcher-ca";
/** The recorded trust decision, per CA fingerprint (`launcherTrust.ts`). */
const CA_TRUST_STATE_KEY = "builderforce.launcher.caTrusted";

const execFileAsync = promisify(execFile);

function launcherTrustDeps(ctx: vscode.ExtensionContext, text: ComposerCommandText): LauncherTrustDeps {
  return {
    text,
    plan: (ca) => caTrustCommand(ca),
    checkCommand: (ca) => caTrustCheckCommand(ca),
    decision: {
      get: () => ctx.globalState.get<CaTrustDecision>(CA_TRUST_STATE_KEY),
      set: async (decision) => { await ctx.globalState.update(CA_TRUST_STATE_KEY, decision); },
    },
    ask: async (message, trust, skip) => {
      const answer = await vscode.window.showInformationMessage(message, { modal: true }, trust, skip);
      return answer === trust ? "trust" : answer === skip ? "skip" : undefined;
    },
    // The tool by absolute path, an argument array, in the CA store directory — never a shell, never the workspace as cwd.
    exec: trustCommandRunner(execFileAsync),
    report: (error, step) => logLine(step === "check"
      ? `[composer] the launcher certificate check could not run: ${messageOf(error)}`
      : `[composer] the launcher certificate could not be trusted: ${messageOf(error)}`),
  };
}

/** Recompute the help model when a folder or a folder's manifest changes; dispose with the extension. */
function watchHelp(ctx: vscode.ExtensionContext, init: () => Promise<ComposerCommandsInit>, publish: (help: ComposerCommandsInit) => void): void {
  ctx.subscriptions.push(watchComposerHelp({
    onFoldersChanged: (listener) => vscode.workspace.onDidChangeWorkspaceFolders(listener),
    manifestEvents: folderManifestWatchers(MANIFEST_READ_ORDER),
    folderRoots: () => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
    recompute: init,
    publish,
    report: (error) => logLine(`[composer] the / menu could not be refreshed: ${messageOf(error)}`),
  }));
}

/** Detection's file read: an unreadable subdirectory or file is reported and left out, never the end of detection. */
const readFolderFiles: ReadFolderFiles = (root) =>
  readWorkspaceFiles(root, (error, relative) => logLine(`[composer] app detection skipped ${relative} in ${root}: ${messageOf(error)}`));

/** Every host's launchers, so `deactivate` can await their close (`closeComposerLaunchers`). */
const allLaunchers = new Set<FolderLaunchers>();

/** Close every launcher this extension started; `deactivate` awaits it so no loopback server outlives the editor. */
export async function closeComposerLaunchers(): Promise<void> {
  await Promise.all([...allLaunchers].map((launchers) =>
    launchers.closeAll((error) => logLine(`[composer] a launcher failed to close: ${messageOf(error)}`))));
}

const hosts = new WeakMap<vscode.ExtensionContext, ComposerCommandHost>();

export function composerCommandHost(ctx: vscode.ExtensionContext): ComposerCommandHost {
  const existing = hosts.get(ctx);
  if (existing) return existing;
  const port = vscodeWorkspacePort();
  const launchers = new FolderLaunchers(port.realPath);
  allLaunchers.add(launchers);
  const show = registerManifestPreview(ctx.subscriptions);
  const distDir = vscode.Uri.joinPath(ctx.extensionUri, ...LAUNCHER_DIST_DIR).fsPath;
  const caDir = path.join(ctx.globalStorageUri.fsPath, LAUNCHER_CA_DIR);
  // The fallback when `deactivate` did not run first; a second close of a closed registry is a no-op.
  ctx.subscriptions.push({ dispose: () => void closeComposerLaunchers() });
  // Detected once for the session (the first `/launch` asks VS Code), not per command.
  const editorBrowser = integratedBrowser(
    { getCommands: (filterInternal) => vscode.commands.getCommands(filterInternal), executeCommand: (command, url) => vscode.commands.executeCommand(command, url) },
    (error) => logLine(`[composer] VS Code's integrated browser could not be detected: ${messageOf(error)}`),
  );

  // Never fails the `init` frame it rides in: a registry that cannot be built is reported and the tab is empty.
  const init = async (): Promise<ComposerCommandsInit> => {
    try {
      return { help: (await workspaceRegistry(port, composerCommandText(), logLine)).help() };
    } catch (error) {
      logLine(`[composer] the command registry could not be built: ${messageOf(error)}`);
      return { help: { entries: [] } };
    }
  };
  const helpChanged = new vscode.EventEmitter<ComposerCommandsInit>();
  ctx.subscriptions.push(helpChanged);
  watchHelp(ctx, init, (help) => helpChanged.fire(help));

  const host: ComposerCommandHost = {
    init,
    onDidChangeHelp: helpChanged.event,
    handle: async (line) => {
      // Worded per call: the editor's language is read when the person types, not at activation.
      const text = composerCommandText();
      const result = await handleComposerInput(line, {
        registry: await workspaceRegistry(port, text, logLine),
        text,
        executors: {
          [STARTER_KIT_COMMAND_ID]: starterKitExecutor({ port, text }),
          [MANIFEST_COMMAND_ID]: actionExecutor({
            [MANIFEST_INIT_ACTION]: manifestInitExecutor({ port, text, readFiles: readFolderFiles, detect: detectWorkspaceManifest, show }),
            [MANIFEST_MOVE_ACTION]: manifestMoveExecutor({ port, text }),
          }),
          [LAUNCH_COMMAND_ID]: launchExecutor({
            port,
            text,
            launchers,
            // The page's own strings in the editor's language, worded when the launcher starts.
            start: (request) => createLocalLauncher({ ...request, distDir, tls: { storeDir: caDir }, labels: launcherPageLabels(), forwardAi: vsixForwardAi(ctx.secrets) }),
            trust: (ca, force) => ensureLauncherTrust(ca, launcherTrustDeps(ctx, text), force),
            openExternal: openUrlVerbatim((target) => vscode.env.openExternal(target)),
            editorBrowser,
            readFiles: readFolderFiles,
            detect: detectWorkspaceManifest,
            // One folder's own environments judge a name for that folder; with none given, every open folder's.
            environments: async (folder) => (folder
              ? folderEnvironments(port, folder, logLine)
              : (await launchEnvironmentChoices(port, text, logLine)).map((choice) => choice.value)),
          }),
        },
      });
      // Reported, never only shown: the reply carries the failure to the person, the channel keeps it.
      // (Only the first line — a launch reply's link carries its token and is never logged.)
      if (result.handled && result.reply.kind === "text" && result.reply.tone === "error") {
        logLine(`[composer] ${line.trim().split(/\s+/)[0]}: ${result.reply.lines[0] ?? ""}`);
      }
      return result;
    },
  };
  hosts.set(ctx, host);
  return host;
}
