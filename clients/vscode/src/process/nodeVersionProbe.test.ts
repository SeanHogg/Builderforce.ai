import { describe, expect, it } from "vitest";
import { createMajorProbe, parseNodeMajor } from "./nodeVersionProbe";

describe("parseNodeMajor", () => {
  it("reads the major of a version string", () => {
    expect(parseNodeMajor("22.3.0\n")).toBe(22);
    expect(parseNodeMajor("v20.11.1")).toBe(20);
  });

  it("anything else is undefined", () => {
    expect(parseNodeMajor("")).toBeUndefined();
    expect(parseNodeMajor("garbage")).toBeUndefined();
    expect(parseNodeMajor("Error: cannot find module")).toBeUndefined();
  });
});

describe("createMajorProbe", () => {
  it("caches per file identity and re-probes when the file's mtime changes (nvm use)", () => {
    let mtime = 1;
    let version = "22.1.0";
    let runs = 0;
    const probe = createMajorProbe({ realpath: (f) => f, mtimeMs: () => mtime, run: () => { runs++; return version; } });
    expect(probe("C:\\nvm\\nodejs\\node.exe")).toBe(22);
    expect(probe("C:\\nvm\\nodejs\\node.exe")).toBe(22);
    expect(runs).toBe(1);
    mtime = 2;
    version = "18.0.0";
    expect(probe("C:\\nvm\\nodejs\\node.exe")).toBe(18);
    expect(runs).toBe(2);
  });

  it("keys on the realpath: a symlinked folder switched to another version is probed again", () => {
    let target = "C:\\nvm\\v22\\node.exe";
    let runs = 0;
    const probe = createMajorProbe({ realpath: () => target, mtimeMs: () => 1, run: (f) => { runs++; return f.includes("v22") ? "22.0.0" : "18.0.0"; } });
    expect(probe("C:\\nodejs\\node.exe")).toBe(22);
    target = "C:\\nvm\\v18\\node.exe";
    expect(probe("C:\\nodejs\\node.exe")).toBe(18);
    expect(runs).toBe(2);
  });

  it("remembers a failed probe for 60 s only, then probes again", () => {
    let fail = true;
    let runs = 0;
    let clock = 0;
    const probe = createMajorProbe({
      realpath: (f) => f, mtimeMs: () => 1, now: () => clock,
      run: () => { runs++; if (fail) throw new Error("ETIMEDOUT"); return "22.0.0"; },
    });
    expect(probe("C:\\nodejs\\node.exe")).toBeUndefined();
    fail = false;
    clock = 59_999;
    expect(probe("C:\\nodejs\\node.exe")).toBeUndefined();
    expect(runs).toBe(1);
    clock = 60_000;
    expect(probe("C:\\nodejs\\node.exe")).toBe(22);
    expect(runs).toBe(2);
  });

  it("a failed probe is tried again at once when the file changes", () => {
    let mtime = 1;
    let runs = 0;
    const probe = createMajorProbe({
      realpath: (f) => f, mtimeMs: () => mtime, now: () => 0,
      run: () => { runs++; if (mtime === 1) throw new Error("hang"); return "22.0.0"; },
    });
    expect(probe("C:\\nodejs\\node.exe")).toBeUndefined();
    mtime = 2;
    expect(probe("C:\\nodejs\\node.exe")).toBe(22);
    expect(runs).toBe(2);
  });

  it("an unreadable file is undefined without probing", () => {
    let runs = 0;
    const probe = createMajorProbe({ realpath: () => { throw new Error("ENOENT"); }, mtimeMs: () => 1, run: () => { runs++; return "22.0.0"; } });
    expect(probe("C:\\missing\\node.exe")).toBeUndefined();
    expect(runs).toBe(0);
  });
});
