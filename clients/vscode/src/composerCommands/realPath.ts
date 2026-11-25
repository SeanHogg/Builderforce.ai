/** The real path of a file or directory (links followed), or the path as given when nothing is there. The ONE place a composer path is made canonical. */
import { realpath } from "node:fs/promises";
import { isMissingPath } from "./writeContainment";

export async function realPathOrSelf(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch (error) {
    if (isMissingPath(error)) return file;
    throw error;
  }
}

/** The key a real path is compared and held under: lowercased where the file system ignores case (Windows, macOS). The ONE such rule. */
export const canonicalKey = (real: string): string => (process.platform === "win32" || process.platform === "darwin" ? real.toLowerCase() : real);
