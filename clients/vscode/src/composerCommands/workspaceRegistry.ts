/**
 * The composer command registry for the workspace as it is NOW (PRD 31 §W11): which
 * folders are open, what each folder's `builderforce.json` declares, and whether this
 * extension host is remote. Rebuilt per `/` menu refresh and per composer line
 * (`host.ts`); over the {@link ComposerWorkspacePort}, so it is tested against a fake.
 */
import * as path from "node:path";
import {
  createComposerCommandRegistry,
  type ComposerCommandChoice,
  type ComposerCommandRegistry,
} from "@seanhogg/builderforce-brain-embedded/composerCommands";
import { buildComposerCommands } from "./entries";
import type { ComposerCommandText } from "./labels";
import { MANIFEST_FILE_NAME } from "./manifestInit";
import type { ComposerWorkspacePort, WorkspaceFolderRef } from "./workspacePort";

/** Where a failure the registry survives goes (the output channel, `logLine`). */
export type RegistryReport = (message: string) => void;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The environment names one folder's `builderforce.json` declares; empty when it has none or cannot be read (reported). */
async function folderEnvironments(port: ComposerWorkspacePort, folder: WorkspaceFolderRef, report: RegistryReport): Promise<string[]> {
  const file = path.join(folder.path, MANIFEST_FILE_NAME);
  let text: string | undefined;
  try {
    text = await port.readText(file);
  } catch (error) {
    report(`[composer] could not read ${file}: ${messageOf(error)}`);
    return [];
  }
  if (!text) return [];
  try {
    const environments = (JSON.parse(text) as { environments?: unknown }).environments;
    return environments && typeof environments === "object" && !Array.isArray(environments) ? Object.keys(environments) : [];
  } catch (error) {
    // A broken manifest: `/launch` passes any name through and the launcher reports the file's issues.
    report(`[composer] ${file} is not valid JSON, so /launch offers no environments from it: ${messageOf(error)}`);
    return [];
  }
}

/**
 * `/launch`'s environment choices for every open folder. The menu is ONE list and the folder
 * is picked after the command (`chooseFolder`, as `/launch` does), so it is the union of the
 * folders' environments; with several folders open each is labelled with the folders that
 * declare it.
 */
export async function launchEnvironmentChoices(
  port: ComposerWorkspacePort,
  text: ComposerCommandText,
  report: RegistryReport,
): Promise<ComposerCommandChoice[]> {
  const folders = port.folders();
  const declaredBy = new Map<string, string[]>();
  for (const folder of folders) {
    for (const environment of await folderEnvironments(port, folder, report)) {
      declaredBy.set(environment, [...(declaredBy.get(environment) ?? []), folder.name]);
    }
  }
  return [...declaredBy].map(([value, names]) => (folders.length > 1 ? { value, label: text.launchEnvironmentIn(value, names) } : { value }));
}

export async function workspaceRegistry(
  port: ComposerWorkspacePort,
  text: ComposerCommandText,
  report: RegistryReport,
): Promise<ComposerCommandRegistry> {
  const remote = port.remoteName();
  const entries = buildComposerCommands({
    hasWorkspace: port.folders().length > 0,
    noWorkspaceReason: text.noWorkspace,
    environments: await launchEnvironmentChoices(port, text, report),
    ...(remote ? { launchUnavailableReason: text.launchRemote(remote) } : {}),
    stopLabel: text.launchStopChoice,
    trustLabel: text.launchTrustChoice,
  });
  return createComposerCommandRegistry(entries, text);
}
