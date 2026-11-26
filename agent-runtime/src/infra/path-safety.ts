import path from "node:path";

export function resolveSafeBaseDir(rootDir: string): string {
  const resolved = path.resolve(rootDir);
  return resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
}
