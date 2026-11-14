import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createCachedWhich, searchPath, whichOnPathSync } from "./programSearch";

const nodeName = process.platform === "win32" ? "node.exe" : "node";

describe("whichOnPathSync", () => {
  it("finds the program in a search folder and refuses a name with a separator", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-which-sync-"));
    try {
      const file = path.join(dir, nodeName);
      fs.writeFileSync(file, "");
      expect(whichOnPathSync("node", [dir])).toBe(file);
      expect(whichOnPathSync("missing-program", [dir])).toBeUndefined();
      expect(whichOnPathSync("./node", [dir])).toBeUndefined();
      expect(whichOnPathSync("bin\\node", [dir])).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never finds a program inside an excluded repository root", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "bf-which-repo-"));
    try {
      const bin = path.join(repo, "node_modules", ".bin");
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, nodeName), "");
      const root = path.resolve(repo).replace(/\\/g, "/");
      const excluded = [process.platform === "win32" ? root.toLowerCase() : root];
      const dirs = searchPath({ PATH: bin }, excluded);
      expect(dirs).toEqual([]);
      expect(whichOnPathSync("node", dirs)).toBeUndefined();
      expect(whichOnPathSync("node", searchPath({ PATH: bin }, []))).toBe(path.join(bin, nodeName));
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("createCachedWhich", () => {
  it("memoizes a hit per search folders, and a change in the folders (a new exclusion) looks again", () => {
    let dirs = ["C:\\a", "C:\\repo\\bin"];
    const calls: string[][] = [];
    const which = createCachedWhich(() => dirs, (_p, d) => { calls.push([...d]); return d.includes("C:\\repo\\bin") ? "C:\\repo\\bin\\node.exe" : "C:\\a\\node.exe"; });
    expect(which("node")).toBe("C:\\repo\\bin\\node.exe");
    expect(which("node")).toBe("C:\\repo\\bin\\node.exe");
    expect(calls).toHaveLength(1);
    dirs = ["C:\\a"];
    expect(which("node")).toBe("C:\\a\\node.exe");
    expect(calls).toHaveLength(2);
  });

  it("remembers a miss for 60 s only", () => {
    let present = false;
    let calls = 0;
    let clock = 0;
    const which = createCachedWhich(() => ["C:\\a"], () => { calls++; return present ? "C:\\a\\git.exe" : undefined; }, () => clock);
    expect(which("git")).toBeUndefined();
    present = true;
    clock = 59_999;
    expect(which("git")).toBeUndefined();
    expect(calls).toBe(1);
    clock = 60_000;
    expect(which("git")).toBe("C:\\a\\git.exe");
    expect(calls).toBe(2);
  });

  it("invalidate drops the remembered answer for that program only", () => {
    let calls = 0;
    const which = createCachedWhich(() => ["C:\\a"], (p) => { calls++; return `C:\\a\\${p}.exe`; });
    which("git");
    which("node");
    which.invalidate("git");
    which("git");
    which("node");
    expect(calls).toBe(3);
  });
});
