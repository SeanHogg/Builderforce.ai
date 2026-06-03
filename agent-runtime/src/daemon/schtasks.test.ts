import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseSchtasksQuery,
  readScheduledTaskCommand,
  resolveTaskScriptPath,
  resolveTaskLauncherPath,
  buildTaskLauncher,
} from "./schtasks.js";

describe("schtasks runtime parsing", () => {
  it("parses status and last run info", () => {
    const output = [
      "TaskName: \\BuilderForceAgents Gateway",
      "Status: Ready",
      "Last Run Time: 1/8/2026 1:23:45 AM",
      "Last Run Result: 0x0",
    ].join("\r\n");
    expect(parseSchtasksQuery(output)).toEqual({
      status: "Ready",
      lastRunTime: "1/8/2026 1:23:45 AM",
      lastRunResult: "0x0",
    });
  });

  it("parses running status", () => {
    const output = [
      "TaskName: \\BuilderForceAgents Gateway",
      "Status: Running",
      "Last Run Time: 1/8/2026 1:23:45 AM",
      "Last Run Result: 0x0",
    ].join("\r\n");
    expect(parseSchtasksQuery(output)).toEqual({
      status: "Running",
      lastRunTime: "1/8/2026 1:23:45 AM",
      lastRunResult: "0x0",
    });
  });
});

describe("resolveTaskScriptPath", () => {
  it("uses default path when BUILDERFORCE_AGENTS_PROFILE is unset", () => {
    const env = { USERPROFILE: "C:\\Users\\test" };
    expect(resolveTaskScriptPath(env)).toBe(
      path.join("C:\\Users\\test", ".builderforce", "gateway.cmd"),
    );
  });

  it("uses profile-specific path when BUILDERFORCE_AGENTS_PROFILE is set to a custom value", () => {
    const env = { USERPROFILE: "C:\\Users\\test", BUILDERFORCE_AGENTS_PROFILE: "jbphoenix" };
    expect(resolveTaskScriptPath(env)).toBe(
      path.join("C:\\Users\\test", ".builderforce-jbphoenix", "gateway.cmd"),
    );
  });

  it("prefers BUILDERFORCE_AGENTS_STATE_DIR over profile-derived defaults", () => {
    const env = {
      USERPROFILE: "C:\\Users\\test",
      BUILDERFORCE_AGENTS_PROFILE: "rescue",
      BUILDERFORCE_AGENTS_STATE_DIR: "C:\\State\\builderforce",
    };
    expect(resolveTaskScriptPath(env)).toBe(path.join("C:\\State\\builderforce", "gateway.cmd"));
  });

  it("falls back to HOME when USERPROFILE is not set", () => {
    const env = { HOME: "/home/test", BUILDERFORCE_AGENTS_PROFILE: "default" };
    expect(resolveTaskScriptPath(env)).toBe(path.join("/home/test", ".builderforce", "gateway.cmd"));
  });
});

describe("readScheduledTaskCommand", () => {
  async function withScheduledTaskScript(
    options: {
      scriptLines?: string[];
      env?:
        | Record<string, string | undefined>
        | ((tmpDir: string) => Record<string, string | undefined>);
    },
    run: (env: Record<string, string | undefined>) => Promise<void>,
  ) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-schtasks-test-"));
    try {
      const extraEnv = typeof options.env === "function" ? options.env(tmpDir) : options.env;
      const env = {
        USERPROFILE: tmpDir,
        BUILDERFORCE_AGENTS_PROFILE: "default",
        ...extraEnv,
      };
      if (options.scriptLines) {
        const scriptPath = resolveTaskScriptPath(env);
        await fs.mkdir(path.dirname(scriptPath), { recursive: true });
        await fs.writeFile(scriptPath, options.scriptLines.join("\r\n"), "utf8");
      }
      await run(env);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  it("parses script with quoted arguments containing spaces", async () => {
    await withScheduledTaskScript(
      {
        // Use forward slashes which work in Windows cmd and avoid escape parsing issues.
        scriptLines: ["@echo off", '"C:/Program Files/Node/node.exe" gateway.js'],
      },
      async (env) => {
        const result = await readScheduledTaskCommand(env);
        expect(result).toEqual({
          programArguments: ["C:/Program Files/Node/node.exe", "gateway.js"],
        });
      },
    );
  });

  it("returns null when script does not exist", async () => {
    await withScheduledTaskScript({}, async (env) => {
      const result = await readScheduledTaskCommand(env);
      expect(result).toBeNull();
    });
  });

  it("returns null when script has no command", async () => {
    await withScheduledTaskScript(
      { scriptLines: ["@echo off", "rem This is just a comment"] },
      async (env) => {
        const result = await readScheduledTaskCommand(env);
        expect(result).toBeNull();
      },
    );
  });

  it("parses full script with all components", async () => {
    await withScheduledTaskScript(
      {
        scriptLines: [
          "@echo off",
          "rem BuilderForceAgents Gateway",
          "cd /d C:\\Projects\\builderforce",
          "set NODE_ENV=production",
          "set BUILDERFORCE_AGENTS_PORT=18789",
          "node gateway.js --verbose",
        ],
      },
      async (env) => {
        const result = await readScheduledTaskCommand(env);
        expect(result).toEqual({
          programArguments: ["node", "gateway.js", "--verbose"],
          workingDirectory: "C:\\Projects\\builderforce",
          environment: {
            NODE_ENV: "production",
            BUILDERFORCE_AGENTS_PORT: "18789",
          },
        });
      },
    );
  });

  it("parses command with Windows backslash paths", async () => {
    await withScheduledTaskScript(
      {
        scriptLines: [
          "@echo off",
          '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\builderforce\\dist\\index.js gateway --port 18789',
        ],
      },
      async (env) => {
        const result = await readScheduledTaskCommand(env);
        expect(result).toEqual({
          programArguments: [
            "C:\\Program Files\\nodejs\\node.exe",
            "C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\builderforce\\dist\\index.js",
            "gateway",
            "--port",
            "18789",
          ],
        });
      },
    );
  });

  it("preserves UNC paths in command arguments", async () => {
    await withScheduledTaskScript(
      {
        scriptLines: [
          "@echo off",
          '"\\\\fileserver\\BuilderForceAgents Share\\node.exe" "\\\\fileserver\\BuilderForceAgents Share\\dist\\index.js" gateway --port 18789',
        ],
      },
      async (env) => {
        const result = await readScheduledTaskCommand(env);
        expect(result).toEqual({
          programArguments: [
            "\\\\fileserver\\BuilderForceAgents Share\\node.exe",
            "\\\\fileserver\\BuilderForceAgents Share\\dist\\index.js",
            "gateway",
            "--port",
            "18789",
          ],
        });
      },
    );
  });

  it("reads script from BUILDERFORCE_AGENTS_STATE_DIR override", async () => {
    await withScheduledTaskScript(
      {
        env: (tmpDir) => ({ BUILDERFORCE_AGENTS_STATE_DIR: path.join(tmpDir, "custom-state") }),
        scriptLines: ["@echo off", "node gateway.js --from-state-dir"],
      },
      async (env) => {
        const result = await readScheduledTaskCommand(env);
        expect(result).toEqual({
          programArguments: ["node", "gateway.js", "--from-state-dir"],
        });
      },
    );
  });
});

describe("resolveTaskLauncherPath", () => {
  it("returns gateway-launcher.ps1 in the state directory", () => {
    const env = { USERPROFILE: "C:\\Users\\test" };
    expect(resolveTaskLauncherPath(env)).toBe(
      path.join("C:\\Users\\test", ".builderforce", "gateway-launcher.ps1"),
    );
  });
});

describe("buildTaskLauncher", () => {
  it("embeds the cmd script path", () => {
    const launcher = buildTaskLauncher("C:\\Users\\test\\.builderforce\\gateway.cmd");
    expect(launcher).toContain("$cmdScript = 'C:\\Users\\test\\.builderforce\\gateway.cmd'");
  });

  it("includes crash-loop protection logic", () => {
    const launcher = buildTaskLauncher("C:\\gateway.cmd");
    expect(launcher).toContain("gateway.crashlog");
    expect(launcher).toContain("$maxCrashes = 5");
    expect(launcher).toContain("crash-loop detected");
  });

  it("runs the cmd script hidden and records crashes", () => {
    const launcher = buildTaskLauncher("C:\\gateway.cmd");
    expect(launcher).toContain("Start-Process");
    expect(launcher).toContain("-WindowStyle Hidden");
    expect(launcher).toContain("Add-Content $crashFile");
  });

  it("escapes single quotes in paths", () => {
    const launcher = buildTaskLauncher("C:\\It's a test\\gateway.cmd");
    expect(launcher).toContain("$cmdScript = 'C:\\It''s a test\\gateway.cmd'");
  });
});
