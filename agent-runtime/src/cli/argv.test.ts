import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "builderforce", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "builderforce", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "builderforce", "help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "builderforce", "status"])).toBe(false);
    expect(hasHelpOrVersion(["node", "builderforce", "agent", "--message", "help", "--deliver"])).toBe(
      false,
    );
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "builderforce", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "builderforce", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "builderforce", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "builderforce", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "builderforce"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "builderforce", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "builderforce", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "builderforce", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "builderforce", "status", "--timeout=2500"], "--timeout")).toBe(
      "2500",
    );
    expect(getFlagValue(["node", "builderforce", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "builderforce", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "builderforce", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "builderforce", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "builderforce", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "builderforce", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "builderforce", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "builderforce", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "builderforce", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "builderforce", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "builderforce",
      rawArgs: ["node", "builderforce", "status"],
    });
    expect(nodeArgv).toEqual(["node", "builderforce", "status"]);

    const versionedNodeArgv = buildParseArgv({
      programName: "builderforce",
      rawArgs: ["node-22", "builderforce", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "builderforce", "status"]);

    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "builderforce",
      rawArgs: ["node-22.2.0.exe", "builderforce", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "builderforce", "status"]);

    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "builderforce",
      rawArgs: ["node-22.2", "builderforce", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "builderforce", "status"]);

    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "builderforce",
      rawArgs: ["node-22.2.exe", "builderforce", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "builderforce", "status"]);

    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "builderforce",
      rawArgs: ["/usr/bin/node-22.2.0", "builderforce", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "builderforce", "status"]);

    const nodejsArgv = buildParseArgv({
      programName: "builderforce",
      rawArgs: ["nodejs", "builderforce", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "builderforce", "status"]);

    const nonVersionedNodeArgv = buildParseArgv({
      programName: "builderforce",
      rawArgs: ["node-dev", "builderforce", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "builderforce", "node-dev", "builderforce", "status"]);

    const directArgv = buildParseArgv({
      programName: "builderforce",
      rawArgs: ["builderforce", "status"],
    });
    expect(directArgv).toEqual(["node", "builderforce", "status"]);

    const bunArgv = buildParseArgv({
      programName: "builderforce",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "builderforce",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "builderforce", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "builderforce", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "builderforce", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "builderforce", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "builderforce", "config", "get", "update"])).toBe(false);
    expect(shouldMigrateState(["node", "builderforce", "config", "unset", "update"])).toBe(false);
    expect(shouldMigrateState(["node", "builderforce", "models", "list"])).toBe(false);
    expect(shouldMigrateState(["node", "builderforce", "models", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "builderforce", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "builderforce", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "builderforce", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "builderforce", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["config", "get"])).toBe(false);
    expect(shouldMigrateStateFromPath(["models", "status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
