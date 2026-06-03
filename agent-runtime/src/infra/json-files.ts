import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function shouldUseCopyFallback(err: unknown): boolean {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : null;
  return code === "EPERM" || code === "EEXIST" || code === "EACCES" || code === "EBUSY";
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  options?: { mode?: number },
) {
  const mode = options?.mode ?? 0o600;
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  try {
    await fs.chmod(tmp, mode);
  } catch {
    // best-effort; ignore on platforms without chmod
  }
  try {
    await fs.rename(tmp, filePath);
  } catch (err) {
    // Windows can reject atomic replacement when the destination already exists
    // or is momentarily observed by another process. Fall back to copy+unlink.
    if (!shouldUseCopyFallback(err)) {
      await fs.unlink(tmp).catch(() => {
        // best-effort cleanup
      });
      throw err;
    }
    await fs.copyFile(tmp, filePath);
    await fs.unlink(tmp).catch(() => {
      // best-effort cleanup
    });
  }
  try {
    await fs.chmod(filePath, mode);
  } catch {
    // best-effort; ignore on platforms without chmod
  }
}

export function createAsyncLock() {
  let lock: Promise<void> = Promise.resolve();
  return async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = lock;
    let release: (() => void) | undefined;
    lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release?.();
    }
  };
}
