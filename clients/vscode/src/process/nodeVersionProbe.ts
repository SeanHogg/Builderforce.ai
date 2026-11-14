/**
 * The major version of a `node` executable, probed by running it (`node -p process.versions.node`).
 *
 * Cached per FILE IDENTITY — the realpath plus that file's mtime — never per PATH name: an nvm-windows PATH
 * folder is a symlink to the active version, so `nvm use 18` after a probed 22 changes the identity and is
 * probed again. A failed or timed-out probe is cached only for {@link FAILED_PROBE_TTL_MS}: long enough that a
 * hanging `node.exe` cannot block the extension host for the probe budget on every launch, short enough that a
 * slow first launch (antivirus scanning a fresh binary) does not pin the fallback for the whole session.
 */

import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";

/** The major of a Node version string (`"22.3.0\n"`, `"v20.1.0"` → 22 / 20); undefined for anything else. */
export function parseNodeMajor(text: string): number | undefined {
  const m = /^v?(\d+)\.\d+/.exec(text.trim());
  return m ? Number(m[1]) : undefined;
}

export interface ProbeDeps {
  /** The file's real path; throws when it cannot be resolved. */
  realpath: (file: string) => string;
  /** The file's mtime in ms; throws when it cannot be read. */
  mtimeMs: (file: string) => number;
  /** Runs the probe and returns its stdout; throws on failure or timeout. */
  run: (file: string) => string;
  /** The clock (ms); defaults to `Date.now`. */
  now?: () => number;
}

/** How long a failed probe of one file identity is remembered before it is tried again. */
export const FAILED_PROBE_TTL_MS = 60_000;

/** A probe returning the major version of `file`, or undefined when it could not be determined. */
export function createMajorProbe(deps: ProbeDeps): (file: string) => number | undefined {
  const now = deps.now ?? Date.now;
  const known = new Map<string, number>();
  const failedUntil = new Map<string, number>();
  return (file) => {
    let real: string;
    let key: string;
    try {
      real = deps.realpath(file);
      key = `${real}\0${deps.mtimeMs(real)}`;
    } catch {
      return undefined;
    }
    const hit = known.get(key);
    if (hit !== undefined) return hit;
    const until = failedUntil.get(key);
    if (until !== undefined && now() < until) return undefined;
    let major: number | undefined;
    try {
      major = parseNodeMajor(deps.run(real));
    } catch {
      major = undefined;
    }
    if (major === undefined) failedUntil.set(key, now() + FAILED_PROBE_TTL_MS);
    else {
      failedUntil.delete(key);
      known.set(key, major);
    }
    return major;
  };
}

/** The real probe: realpath + stat + `node -p process.versions.node` (hidden, 5 s budget). */
export const probeNodeMajor = createMajorProbe({
  realpath: (file) => realpathSync(file),
  mtimeMs: (file) => statSync(file).mtimeMs,
  run: (file) => String(execFileSync(file, ["-p", "process.versions.node"], { windowsHide: true, timeout: 5000, encoding: "utf8" })),
});
