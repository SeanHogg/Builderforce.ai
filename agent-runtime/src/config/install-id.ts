/**
 * Resolve a stable "install id" from the installation path so that different
 * versions/installs of BuilderForceAgents (e.g. different npm global roots, different
 * versions) get separate state dirs and gateways when run side by side.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | null | undefined = undefined;
let _testOverride: ((fromModuleUrl: string) => string | null) | null = null;

/**
 * Find the package root (directory containing package.json with name "builderforce")
 * by walking up from the given module URL. Returns null if not found.
 */
function findPackageRoot(fromModuleUrl: string): string | null {
  try {
    const fromPath = fileURLToPath(fromModuleUrl);
    let dir = path.dirname(fromPath);
    for (let i = 0; i < 12; i++) {
      const pkgPath = path.join(dir, "package.json");
      try {
        if (fs.existsSync(pkgPath)) {
          const raw = fs.readFileSync(pkgPath, "utf-8");
          const name = (raw.match(/"name"\s*:\s*"([^"]+)"/) ?? [])[1];
          if (name === "builderforce" || name === "@seanhogg/builderforce-agents") {
            return dir;
          }
        }
      } catch {
        // continue
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Return a stable 8-character id for this installation (hash of canonical
 * package root path). Different install paths (e.g. different node version
 * globals, pnpm vs npm) get different ids so state dirs don't collide.
 * Returns null if package root cannot be determined (e.g. bundled).
 */
/** For tests: override the value returned by getInstallId. Pass null to remove override. */
export function setInstallIdForTests(
  override: ((fromModuleUrl: string) => string | null) | null,
): void {
  _testOverride = override;
}

export function getInstallId(fromModuleUrl: string): string | null {
  if (_testOverride !== null) {
    return _testOverride(fromModuleUrl);
  }
  if (cached !== undefined) {
    return cached;
  }
  const root = findPackageRoot(fromModuleUrl);
  if (!root) {
    cached = null;
    return null;
  }
  try {
    const canonical = fs.realpathSync(root);
    const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 8);
    cached = hash;
    return hash;
  } catch {
    const hash = createHash("sha256").update(root).digest("hex").slice(0, 8);
    cached = hash;
    return hash;
  }
}

/** For tests: reset cached install id so it is recomputed (e.g. after mocking). */
export function resetInstallIdCache(): void {
  cached = undefined;
}
