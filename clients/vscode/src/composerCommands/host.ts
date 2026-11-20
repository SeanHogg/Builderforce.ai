/**
 * The composer commands' composition root in the extension host (PRD 31 §W11): the
 * registry for the current workspace, the four executors bound to the editor, and the
 * folder launchers — ONE per extension, closed on deactivate (`context.subscriptions`).
 *
 * The chat surface asks it two things: the `/help` model for the `/` menu's Actions tab
 * (`init`), and the answer to a composer line before any run starts (`composer.input`).
 */
import * as path from "node:path";
import * as vscode from "vscode";
import {
  createComposerCommandRegistry,
  type ComposerCommandRegistry,
} from "@seanhogg/builderforce-brain-embedded/composerCommands";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import * as launcherServer from "@seanhogg/builderforce-webcontainers/launcher/server";
import { ensureLauncherTrust, type CaTrustCommand, type CaTrustDecision, type LauncherTrustDeps } from "./launcherTrust";
import { logLine } from "../errorReporter";
import { detectWorkspaceManifest } from "./detectManifest";
import { handleComposerInput } from "./dispatch";
import { buildComposerCommands, LAUNCH_COMMAND_ID, MANIFEST_COMMAND_ID, STARTER_KIT_COMMAND_ID } from "./entries";
import { FolderLaunchers } from "./folderLaunchers";
import { composerCommandText, type ComposerCommandText } from "./labels";
import { launchExecutor } from "./launch";
import { MANIFEST_FILE_NAME, manifestInitExecutor } from "./manifestInit";
import type { ComposerCommandsInit, ComposerInputResult } from "./reply";
import { starterKitExecutor } from "./starterKit";
import { registerManifestPreview, vscodeWorkspacePort } from "./vscodeWorkspacePort";
import { readWorkspaceFiles } from "./workspaceFiles";
import type { ComposerWorkspacePort } from "./workspacePort";

export interface ComposerCommandHost {
  /** The `/help` model for the `/` menu's Actions tab. */
  init(): Promise<ComposerCommandsInit>;
  /** Answer a composer line: not a command, or the reply to show. Never reaches a model. */
  handle(text: string): Promise<ComposerInputResult>;
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

/**
 * The launcher's TLS surface (`tls` option, `caCertPath`, `caTrustCommand`, `isCaTrusted`) lands
 * with the webcontainers HTTPS release. Read through this view so the extension builds against the
 * current published API and picks the new one up with no edit: absent ⇒ plain HTTP, no trust step.
 */
interface LauncherTlsApi {
  caTrustCommand?: (caCertPath: string, platform: NodeJS.Platform) => CaTrustCommand;
  isCaTrusted?: (caCertPath: string) => boolean | Promise<boolean>;
}
const launcherTls = launcherServer as unknown as LauncherTlsApi;
type LaunchOptionsWithTls = Parameters<typeof launcherServer.createLocalLauncher>[0] & { tls?: { storeDir: string } };

const execFileAsync = promisify(execFile);

function launcherTrustDeps(ctx: vscode.ExtensionContext, text: ComposerCommandText): LauncherTrustDeps {
  return {
    text,
    ...(launcherTls.caTrustCommand ? { trustCommand: launcherTls.caTrustCommand } : {}),
    ...(launcherTls.isCaTrusted ? { isTrusted: launcherTls.isCaTrusted } : {}),
    platform: process.platform,
    fingerprint: async (caCertPath) => createHash("sha256").update(await readFile(caCertPath)).digest("hex"),
    decision: {
      get: () => ctx.globalState.get<CaTrustDecision>(CA_TRUST_STATE_KEY),
      set: async (decision) => { await ctx.globalState.update(CA_TRUST_STATE_KEY, decision); },
    },
    ask: async (message, trust, skip) => {
      const answer = await vscode.window.showInformationMessage(message, { modal: true }, trust, skip);
      return answer === trust ? "trust" : answer === skip ? "skip" : undefined;
    },
    // An argument array, never a shell string.
    exec: async (command, args) => { await execFileAsync(command, [...args], { windowsHide: true }); },
  };
}

/** The environment names a folder's `builderforce.json` declares; empty when it has none or cannot be read. */
async function manifestEnvironments(port: ComposerWorkspacePort): Promise<string[]> {
  const folder = port.folders()[0];
  if (!folder) return [];
  const text = await port.readText(path.join(folder.path, MANIFEST_FILE_NAME)).catch((error: unknown) => {
    logLine(`[composer] could not read ${MANIFEST_FILE_NAME}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  });
  if (!text) return [];
  try {
    const environments = (JSON.parse(text) as { environments?: unknown }).environments;
    return environments && typeof environments === "object" && !Array.isArray(environments) ? Object.keys(environments) : [];
  } catch {
    return []; // a broken manifest: `/launch` passes any name through and the launcher reports the file's issues
  }
}

async function registryFor(port: ComposerWorkspacePort, text: ComposerCommandText): Promise<ComposerCommandRegistry> {
  const entries = buildComposerCommands({
    hasWorkspace: port.folders().length > 0,
    noWorkspaceReason: text.noWorkspace,
    environments: await manifestEnvironments(port),
    stopLabel: text.launchStopChoice,
    trustLabel: text.launchTrustChoice,
  });
  return createComposerCommandRegistry(entries, text);
}

const hosts = new WeakMap<vscode.ExtensionContext, ComposerCommandHost>();

export function composerCommandHost(ctx: vscode.ExtensionContext): ComposerCommandHost {
  const existing = hosts.get(ctx);
  if (existing) return existing;
  const port = vscodeWorkspacePort();
  const launchers = new FolderLaunchers();
  const show = registerManifestPreview(ctx.subscriptions);
  const distDir = vscode.Uri.joinPath(ctx.extensionUri, ...LAUNCHER_DIST_DIR).fsPath;
  const caDir = path.join(ctx.globalStorageUri.fsPath, LAUNCHER_CA_DIR);
  ctx.subscriptions.push({
    dispose: () => void launchers.closeAll((error) => logLine(`[composer] a launcher failed to close: ${error instanceof Error ? error.message : String(error)}`)),
  });

  const host: ComposerCommandHost = {
    // Never fails the `init` frame it rides in: a registry that cannot be built is reported and the tab is empty.
    init: async () => {
      try {
        return { help: (await registryFor(port, composerCommandText())).help() };
      } catch (error) {
        logLine(`[composer] the command registry could not be built: ${error instanceof Error ? error.message : String(error)}`);
        return { help: { entries: [] } };
      }
    },
    handle: async (line) => {
      // Worded per call: the editor's language is read when the person types, not at activation.
      const text = composerCommandText();
      const result = await handleComposerInput(line, {
        registry: await registryFor(port, text),
        text,
        executors: {
          [STARTER_KIT_COMMAND_ID]: starterKitExecutor({ port, text }),
          [MANIFEST_COMMAND_ID]: manifestInitExecutor({ port, text, readFiles: readWorkspaceFiles, detect: detectWorkspaceManifest, show }),
          [LAUNCH_COMMAND_ID]: launchExecutor({
            port,
            text,
            launchers,
            start: (request) => launcherServer.createLocalLauncher({ ...request, distDir, tls: { storeDir: caDir } } as LaunchOptionsWithTls),
            trust: (caCertPath, force) => ensureLauncherTrust(caCertPath, launcherTrustDeps(ctx, text), force),
            // Handed over as the STRING: `Uri.parse(url).toString()` re-encodes the fragment (`#token=…` →
            // `#token%3D…`) and the launcher page would find no token. The extension host's `openUri`
            // accepts a string and opens it verbatim.
            openExternal: async (url) => { await vscode.env.openExternal(url as unknown as vscode.Uri); },
            readFiles: readWorkspaceFiles,
            detect: detectWorkspaceManifest,
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
