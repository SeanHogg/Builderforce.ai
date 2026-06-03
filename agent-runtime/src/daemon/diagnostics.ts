import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_LOG_DIR } from "../logging/file.js";
import { resolveGatewayLogPaths } from "./launchd.js";

const GATEWAY_LOG_ERROR_PATTERNS = [
  /refusing to bind gateway/i,
  /gateway auth mode/i,
  /gateway start blocked/i,
  /failed to bind gateway socket/i,
  /tailscale .* requires/i,
];

async function readLastLogLine(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/).map((line) => line.trim());
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i]) {
        return lines[i];
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function readLastGatewayErrorLine(env: NodeJS.ProcessEnv): Promise<string | null> {
  const { stdoutPath, stderrPath } = resolveGatewayLogPaths(env);
  const stderrRaw = await fs.readFile(stderrPath, "utf8").catch(() => "");
  const stdoutRaw = await fs.readFile(stdoutPath, "utf8").catch(() => "");
  const lines = [...stderrRaw.split(/\r?\n/), ...stdoutRaw.split(/\r?\n/)].map((line) =>
    line.trim(),
  );
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    if (GATEWAY_LOG_ERROR_PATTERNS.some((pattern) => pattern.test(line))) {
      return line;
    }
  }
  return (await readLastLogLine(stderrPath)) ?? (await readLastLogLine(stdoutPath));
}

function rollingLogPathForToday(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return path.join(DEFAULT_LOG_DIR, `builderforce-${year}-${month}-${day}.log`);
}

/**
 * Read ERROR-level entries from the rolling JSON log file written after
 * {@link since}.  Returns human-readable error messages in chronological order.
 *
 * This is the primary way to surface gateway startup failures when the process
 * runs in a hidden window (e.g. Windows Scheduled Task) and stderr is not
 * visible to the caller.
 */
export async function readRecentGatewayLogErrors(
  since: Date,
  opts?: { maxEntries?: number },
): Promise<string[]> {
  const maxEntries = opts?.maxEntries ?? 20;
  const logPath = rollingLogPathForToday();
  try {
    const raw = await fs.readFile(logPath, "utf8");
    const lines = raw.split(/\r?\n/);
    const errors: string[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) {
        continue;
      }
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const meta = entry._meta as Record<string, unknown> | undefined;
        const timeStr = (entry.time as string) || (meta?.date as string);
        if (!timeStr) {
          continue;
        }
        const entryTime = new Date(timeStr);
        if (entryTime < since) {
          break;
        }
        if (meta?.logLevelName !== "ERROR") {
          continue;
        }
        const message = entry["0"] as string | undefined;
        if (message) {
          errors.unshift(String(message).replace(/^- /, ""));
        }
      } catch {
        // skip malformed JSON lines
      }
    }
    return errors.slice(0, maxEntries);
  } catch {
    return [];
  }
}
