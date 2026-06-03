import type { Stats } from "node:fs";
import { constants as fsConstants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import fs from "node:fs/promises";
import path from "node:path";

export type SafeOpenErrorCode = "invalid-path" | "not-found";

export class SafeOpenError extends Error {
  code: SafeOpenErrorCode;

  constructor(code: SafeOpenErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "SafeOpenError";
  }
}

export type SafeOpenResult = {
  handle: FileHandle;
  realPath: string;
  stat: Stats;
};

const NOT_FOUND_CODES = new Set(["ENOENT", "ENOTDIR"]);

const ensureTrailingSep = (value: string) => (value.endsWith(path.sep) ? value : value + path.sep);

const stripWindowsNamespacePrefix = (value: string): string => {
  if (process.platform !== "win32") {
    return value;
  }
  if (value.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${value.slice("\\\\?\\UNC\\".length)}`;
  }
  if (value.startsWith("\\\\?\\")) {
    return value.slice("\\\\?\\".length);
  }
  return value;
};

const canonicalizeForContainment = (value: string): string =>
  path.normalize(stripWindowsNamespacePrefix(value));

const isPathInsideRoot = (candidatePath: string, rootPath: string): boolean => {
  const normalizedCandidate = canonicalizeForContainment(candidatePath);
  const normalizedRoot = canonicalizeForContainment(rootPath);
  const rootWithSep = ensureTrailingSep(normalizedRoot);
  if (process.platform === "win32") {
    const candidateLower = normalizedCandidate.toLowerCase();
    const rootLower = normalizedRoot.toLowerCase();
    const rootWithSepLower = rootWithSep.toLowerCase();
    return candidateLower === rootLower || candidateLower.startsWith(rootWithSepLower);
  }
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(rootWithSep);
};

const isNodeError = (err: unknown): err is NodeJS.ErrnoException =>
  Boolean(err && typeof err === "object" && "code" in (err as Record<string, unknown>));

const isNotFoundError = (err: unknown) =>
  isNodeError(err) && typeof err.code === "string" && NOT_FOUND_CODES.has(err.code);

const isSymlinkOpenError = (err: unknown) =>
  isNodeError(err) && (err.code === "ELOOP" || err.code === "EINVAL" || err.code === "ENOTSUP");

const statInode = (value: Stats): string => String(value.ino);

const isSameFileIdentity = (left: Stats, right: Stats): boolean => {
  if (statInode(left) !== statInode(right)) {
    return false;
  }
  if (process.platform === "win32") {
    return true;
  }
  return left.dev === right.dev;
};

export async function openFileWithinRoot(params: {
  rootDir: string;
  relativePath: string;
}): Promise<SafeOpenResult> {
  let rootReal: string;
  try {
    rootReal = await fs.realpath(params.rootDir);
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new SafeOpenError("not-found", "root dir not found");
    }
    throw err;
  }
  const rootWithSep = ensureTrailingSep(rootReal);
  const resolved = path.resolve(rootWithSep, params.relativePath);
  if (!isPathInsideRoot(resolved, rootReal)) {
    throw new SafeOpenError("invalid-path", "path escapes root");
  }

  const supportsNoFollow = process.platform !== "win32" && "O_NOFOLLOW" in fsConstants;
  const flags = fsConstants.O_RDONLY | (supportsNoFollow ? fsConstants.O_NOFOLLOW : 0);

  let handle: FileHandle;
  try {
    handle = await fs.open(resolved, flags);
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new SafeOpenError("not-found", "file not found");
    }
    if (isSymlinkOpenError(err)) {
      throw new SafeOpenError("invalid-path", "symlink open blocked");
    }
    throw err;
  }

  try {
    const lstat = await fs.lstat(resolved).catch(() => null);
    if (lstat?.isSymbolicLink()) {
      throw new SafeOpenError("invalid-path", "symlink not allowed");
    }

    const realPath = await fs.realpath(resolved);
    if (!isPathInsideRoot(realPath, rootReal)) {
      throw new SafeOpenError("invalid-path", "path escapes root");
    }

    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new SafeOpenError("invalid-path", "not a file");
    }

    const realStat = await fs.stat(realPath);
    if (!isSameFileIdentity(stat, realStat)) {
      throw new SafeOpenError("invalid-path", "path mismatch");
    }

    return { handle, realPath, stat };
  } catch (err) {
    await handle.close().catch(() => {});
    if (err instanceof SafeOpenError) {
      throw err;
    }
    if (isNotFoundError(err)) {
      throw new SafeOpenError("not-found", "file not found");
    }
    throw err;
  }
}
