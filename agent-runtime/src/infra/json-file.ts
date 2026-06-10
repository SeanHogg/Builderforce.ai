import fs from "node:fs/promises";
import path from "node:path";

export async function loadJsonFile(pathname: string): Promise<unknown | undefined> {
  try {
    if (!(await fs.stat(pathname).catch(() => null))) {
      return undefined;
    }
    const raw = await fs.readFile(pathname, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export async function saveJsonFile(pathname: string, data: unknown) {
  const dir = path.dirname(pathname);
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  } catch (err: any) {
    // Ignore if directory already exists
    if (err.code !== "EEXIST") {
      throw err;
    }
  }
  await fs.writeFile(pathname, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.chmod(pathname, 0o600);
}
