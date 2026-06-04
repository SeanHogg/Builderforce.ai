import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveBuilderForceAgentsDir } from "./project-dir.js";
import type { SessionHandoff } from "./types.js";

/**
 * Save a session handoff document to .builderforce/sessions/.
 * Agents call this at the end of a session so the next one can resume
 * instantly without replaying history.
 */
export async function saveSessionHandoff(
  projectRoot: string,
  handoff: SessionHandoff,
): Promise<string> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  await fs.mkdir(dir.sessionsDir, { recursive: true });
  const filename = `${handoff.sessionId}.yaml`;
  const filePath = path.join(dir.sessionsDir, filename);
  await fs.writeFile(filePath, stringifyYaml(handoff), "utf-8");
  return filePath;
}

/**
 * Load the most recent session handoff, giving the next session its starting context.
 * Returns null when no handoff exists (fresh project).
 */
export async function loadLatestSessionHandoff(
  projectRoot: string,
): Promise<SessionHandoff | null> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  try {
    const files = (await fs.readdir(dir.sessionsDir))
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .toSorted() // ISO timestamps sort lexicographically, newest last
      .toReversed();

    if (files.length === 0) {
      return null;
    }

    const content = await fs.readFile(path.join(dir.sessionsDir, files[0]), "utf-8");
    return parseYaml(content) as SessionHandoff;
  } catch {
    return null;
  }
}

/**
 * List all saved session handoffs, newest first.
 */
export async function listSessionHandoffs(projectRoot: string): Promise<SessionHandoff[]> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  const handoffs: SessionHandoff[] = [];

  try {
    const files = (await fs.readdir(dir.sessionsDir))
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .toSorted()
      .toReversed();

    for (const file of files) {
      const content = await fs.readFile(path.join(dir.sessionsDir, file), "utf-8");
      handoffs.push(parseYaml(content) as SessionHandoff);
    }
  } catch {
    // Directory doesn't exist or is empty
  }

  return handoffs;
}
