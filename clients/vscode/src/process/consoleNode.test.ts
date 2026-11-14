import { describe, expect, it } from "vitest";
import { chooseAnyNode, chooseConsoleNode, needsRunAsNode } from "./consoleNode";

const CODE = "C:\\VSCode\\Code.exe";
const PATH_NODE = "C:\\nodejs\\node.exe";

describe("chooseConsoleNode", () => {
  it("win32: a node execPath is used as-is (nothing is looked up)", () => {
    const find = (): string | undefined => { throw new Error("must not search"); };
    expect(chooseConsoleNode("C:\\Program Files\\nodejs\\node.exe", "win32", find, () => 22)).toEqual({ file: "C:\\Program Files\\nodejs\\node.exe" });
  });

  it("win32: under Code.exe a modern node found on PATH wins", () => {
    const asked: string[] = [];
    const find = (name: string): string | undefined => { asked.push(name); return PATH_NODE; };
    expect(chooseConsoleNode(CODE, "win32", find, () => 22)).toEqual({ file: PATH_NODE });
    expect(asked).toEqual(["node"]);
  });

  it("win32: under Code.exe an old node on PATH (major 16) is refused → execPath", () => {
    expect(chooseConsoleNode(CODE, "win32", () => PATH_NODE, () => 16)).toEqual({ file: CODE, fallback: "node-too-old" });
  });

  it("win32: under Code.exe a node whose version probe failed is refused → execPath", () => {
    expect(chooseConsoleNode(CODE, "win32", () => PATH_NODE, () => undefined)).toEqual({ file: CODE, fallback: "node-probe-failed" });
  });

  it("win32: under Code.exe with no node on PATH falls back to execPath", () => {
    expect(chooseConsoleNode(CODE, "win32", () => undefined, () => 22)).toEqual({ file: CODE, fallback: "no-node-on-path" });
  });

  it("not win32: execPath unchanged, nothing is looked up", () => {
    const find = (): string | undefined => { throw new Error("must not search"); };
    expect(chooseConsoleNode("/Applications/Code.app/Contents/MacOS/Electron", "darwin", find, () => 22)).toEqual({ file: "/Applications/Code.app/Contents/MacOS/Electron" });
    expect(chooseConsoleNode("/usr/share/code/code", "linux", find, () => 22)).toEqual({ file: "/usr/share/code/code" });
  });
});

describe("chooseAnyNode", () => {
  it("win32 under Code.exe: any PATH node, whatever its version; execPath only when none is found", () => {
    expect(chooseAnyNode(CODE, "win32", () => PATH_NODE)).toBe(PATH_NODE);
    expect(chooseAnyNode(CODE, "win32", () => undefined)).toBe(CODE);
  });

  it("a node execPath, or any non-Windows host, is used as-is", () => {
    const find = (): string | undefined => { throw new Error("must not search"); };
    expect(chooseAnyNode(PATH_NODE, "win32", find)).toBe(PATH_NODE);
    expect(chooseAnyNode("/usr/share/code/code", "linux", find)).toBe("/usr/share/code/code");
  });
});

describe("needsRunAsNode", () => {
  it("the host's own Electron executable must be told to run as Node", () => {
    expect(needsRunAsNode(CODE, CODE, "win32")).toBe(true);
    expect(needsRunAsNode("/usr/share/code/code", "/usr/share/code/code", "linux")).toBe(true);
  });

  it("a real node — or any other program — is left alone", () => {
    expect(needsRunAsNode(PATH_NODE, PATH_NODE, "win32")).toBe(false);
    expect(needsRunAsNode(PATH_NODE, CODE, "win32")).toBe(false);
    expect(needsRunAsNode("/usr/bin/node", "/usr/bin/node", "linux")).toBe(false);
  });
});
