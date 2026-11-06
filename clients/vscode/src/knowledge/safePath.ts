/**
 * The ONE test for "a root-relative name with no way out", shared by the fix flow's file
 * operations, the root-id resolver and the symbols read. Pure: no fs, no vscode.
 */

/** A root-relative path with no way out: not absolute (POSIX, drive, UNC, leading backslash) and no `..` segment. */
export function isSafeRelative(p: string): boolean {
  if (p === "" || p.includes("\0")) return false;
  if (p.startsWith("/") || p.startsWith("\\") || /^[a-zA-Z]:/.test(p)) return false;
  return !p.split(/[\\/]/).includes("..");
}
