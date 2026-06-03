import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import * as tar from "tar";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectSingleNpmInstallIgnoreScriptsCall,
  expectSingleNpmPackIgnoreScriptsCall,
} from "../test-utils/exec-assertions.js";
import { isAddressInUseError } from "./gmail-watcher.js";

const fixtureRoot = path.join(os.tmpdir(), `builderforce-hook-install-${randomUUID()}`);
let tempDirIndex = 0;

type HookPackFixture = {
  packageName: string;
  hookDirName: string;
  hookName: string;
};

const fixturesDir = path.resolve(process.cwd(), "test", "fixtures", "hooks-install");
const zipTraversalBuffer = fs.readFileSync(path.join(fixturesDir, "zip-traversal.zip"));
const tarTraversalBuffer = fs.readFileSync(path.join(fixturesDir, "tar-traversal.tar"));

function buildPackageJson(params: HookPackFixture): string {
  return JSON.stringify(
    {
      name: params.packageName,
      version: "0.0.1",
      builderforce: { hooks: [`./hooks/${params.hookDirName}`] },
    },
    null,
    2,
  );
}

function buildHookMd(params: HookPackFixture): string {
  return [
    "---",
    `name: ${params.hookName}`,
    `description: ${params.hookName}`,
    'metadata: {"builderforce":{"events":["command:new"]}}',
    "---",
    "",
    `# ${params.hookName}`,
  ].join("\n");
}

async function createZipHookPackBuffer(params: HookPackFixture): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("package/package.json", buildPackageJson(params));
  zip.file(`package/hooks/${params.hookDirName}/HOOK.md`, buildHookMd(params));
  zip.file(`package/hooks/${params.hookDirName}/handler.ts`, "export default async () => {};\n");
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

async function createTarHookPackBuffer(
  params: HookPackFixture,
  options?: { gzip?: boolean },
): Promise<Buffer> {
  const workDir = makeTempDir();
  const pkgRoot = path.join(workDir, "package");
  const hookRoot = path.join(pkgRoot, "hooks", params.hookDirName);
  fs.mkdirSync(hookRoot, { recursive: true });
  fs.writeFileSync(path.join(pkgRoot, "package.json"), buildPackageJson(params), "utf-8");
  fs.writeFileSync(path.join(hookRoot, "HOOK.md"), buildHookMd(params), "utf-8");
  fs.writeFileSync(path.join(hookRoot, "handler.ts"), "export default async () => {};\n", "utf-8");

  const archiveName = options?.gzip ? "pack.tgz" : "pack.tar";
  const archivePath = path.join(workDir, archiveName);
  await tar.c({ cwd: workDir, gzip: options?.gzip === true, file: archivePath }, ["package"]);
  return fs.readFileSync(archivePath);
}

const zipHooksBuffer = await createZipHookPackBuffer({
  packageName: "@builderforce/zip-hooks",
  hookDirName: "zip-hook",
  hookName: "zip-hook",
});
const tarHooksBuffer = await createTarHookPackBuffer({
  packageName: "@builderforce/tar-hooks",
  hookDirName: "tar-hook",
  hookName: "tar-hook",
});
const tarEvilIdBuffer = await createTarHookPackBuffer({
  packageName: "@evil/..",
  hookDirName: "evil-hook",
  hookName: "evil-hook",
});
const tarReservedIdBuffer = await createTarHookPackBuffer({
  packageName: "@evil/.",
  hookDirName: "reserved-hook",
  hookName: "reserved-hook",
});
const npmPackHooksBuffer = await createTarHookPackBuffer(
  {
    packageName: "@builderforce/test-hooks",
    hookDirName: "one-hook",
    hookName: "one-hook",
  },
  { gzip: true },
);

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: vi.fn(),
}));

function makeTempDir() {
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const dir = path.join(fixtureRoot, `case-${tempDirIndex++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const { runCommandWithTimeout } = await import("../process/exec.js");
const { installHooksFromArchive, installHooksFromNpmSpec, installHooksFromPath } =
  await import("./install.js");

afterAll(() => {
  try {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

function writeArchiveFixture(params: { fileName: string; contents: Buffer }) {
  const stateDir = makeTempDir();
  const workDir = makeTempDir();
  const archivePath = path.join(workDir, params.fileName);
  fs.writeFileSync(archivePath, params.contents);
  return {
    stateDir,
    archivePath,
    hooksDir: path.join(stateDir, "hooks"),
  };
}

describe("installHooksFromArchive", () => {
  it.each([
    {
      name: "zip",
      fileName: "hooks.zip",
      contents: zipHooksBuffer,
      expectedPackId: "zip-hooks",
      expectedHook: "zip-hook",
    },
    {
      name: "tar",
      fileName: "hooks.tar",
      contents: tarHooksBuffer,
      expectedPackId: "tar-hooks",
      expectedHook: "tar-hook",
    },
  ])("installs hook packs from $name archives", async (tc) => {
    const fixture = writeArchiveFixture({ fileName: tc.fileName, contents: tc.contents });
    const result = await installHooksFromArchive({
      archivePath: fixture.archivePath,
      hooksDir: fixture.hooksDir,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.hookPackId).toBe(tc.expectedPackId);
    expect(result.hooks).toContain(tc.expectedHook);
    expect(result.targetDir).toBe(path.join(fixture.stateDir, "hooks", tc.expectedPackId));
    expect(fs.existsSync(path.join(result.targetDir, "hooks", tc.expectedHook, "HOOK.md"))).toBe(
      true,
    );
  });

  it.each([
    {
      name: "zip",
      fileName: "traversal.zip",
      contents: zipTraversalBuffer,
      expectedDetail: "archive entry",
    },
    {
      name: "tar",
      fileName: "traversal.tar",
      contents: tarTraversalBuffer,
      expectedDetail: "escapes destination",
    },
  ])("rejects $name archives with traversal entries", async (tc) => {
    const fixture = writeArchiveFixture({ fileName: tc.fileName, contents: tc.contents });
    const result = await installHooksFromArchive({
      archivePath: fixture.archivePath,
      hooksDir: fixture.hooksDir,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("failed to extract archive");
    expect(result.error).toContain(tc.expectedDetail);
  });

  it.each([
    {
      name: "traversal-like ids",
      contents: tarEvilIdBuffer,
    },
    {
      name: "reserved ids",
      contents: tarReservedIdBuffer,
    },
  ])("rejects hook packs with $name", async (tc) => {
    const fixture = writeArchiveFixture({ fileName: "hooks.tar", contents: tc.contents });
    const result = await installHooksFromArchive({
      archivePath: fixture.archivePath,
      hooksDir: fixture.hooksDir,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("reserved path segment");
  });
});

describe("installHooksFromPath", () => {
  it("uses --ignore-scripts for dependency install", async () => {
    const workDir = makeTempDir();
    const stateDir = makeTempDir();
    const pkgDir = path.join(workDir, "package");
    fs.mkdirSync(path.join(pkgDir, "hooks", "one-hook"), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@builderforce/test-hooks",
        version: "0.0.1",
        builderforce: { hooks: ["./hooks/one-hook"] },
        dependencies: { "left-pad": "1.3.0" },
      }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(pkgDir, "hooks", "one-hook", "HOOK.md"),
      [
        "---",
        "name: one-hook",
        "description: One hook",
        'metadata: {"builderforce":{"events":["command:new"]}}',
        "---",
        "",
        "# One Hook",
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(pkgDir, "hooks", "one-hook", "handler.ts"),
      "export default async () => {};\n",
      "utf-8",
    );

    const run = vi.mocked(runCommandWithTimeout);
    run.mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
      signal: null,
      killed: false,
      termination: "exit",
    });

    const res = await installHooksFromPath({
      path: pkgDir,
      hooksDir: path.join(stateDir, "hooks"),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expectSingleNpmInstallIgnoreScriptsCall({
      calls: run.mock.calls as Array<[unknown, { cwd?: string } | undefined]>,
      expectedCwd: res.targetDir,
    });
  });

  it("installs a single hook directory", async () => {
    const stateDir = makeTempDir();
    const workDir = makeTempDir();
    const hookDir = path.join(workDir, "my-hook");
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(
      path.join(hookDir, "HOOK.md"),
      [
        "---",
        "name: my-hook",
        "description: My hook",
        'metadata: {"builderforce":{"events":["command:new"]}}',
        "---",
        "",
        "# My Hook",
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(path.join(hookDir, "handler.ts"), "export default async () => {};\n");

    const hooksDir = path.join(stateDir, "hooks");
    const result = await installHooksFromPath({ path: hookDir, hooksDir });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.hookPackId).toBe("my-hook");
    expect(result.hooks).toEqual(["my-hook"]);
    expect(result.targetDir).toBe(path.join(stateDir, "hooks", "my-hook"));
    expect(fs.existsSync(path.join(result.targetDir, "HOOK.md"))).toBe(true);
  });
});

describe("installHooksFromNpmSpec", () => {
  it("uses --ignore-scripts for npm pack and cleans up temp dir", async () => {
    const stateDir = makeTempDir();

    const run = vi.mocked(runCommandWithTimeout);
    let packTmpDir = "";
    const packedName = "test-hooks-0.0.1.tgz";
    run.mockImplementation(async (argv, opts) => {
      if (argv[0] === "npm" && argv[1] === "pack") {
        packTmpDir = String(typeof opts === "number" ? "" : (opts.cwd ?? ""));
        fs.writeFileSync(path.join(packTmpDir, packedName), npmPackHooksBuffer);
        return {
          code: 0,
          stdout: `${packedName}\n`,
          stderr: "",
          signal: null,
          killed: false,
          termination: "exit",
        };
      }
      throw new Error(`unexpected command: ${argv.join(" ")}`);
    });

    const hooksDir = path.join(stateDir, "hooks");
    const result = await installHooksFromNpmSpec({
      spec: "@builderforce/test-hooks@0.0.1",
      hooksDir,
      logger: { info: () => {}, warn: () => {} },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.hookPackId).toBe("test-hooks");
    expect(fs.existsSync(path.join(result.targetDir, "hooks", "one-hook", "HOOK.md"))).toBe(true);

    expectSingleNpmPackIgnoreScriptsCall({
      calls: run.mock.calls,
      expectedSpec: "@builderforce/test-hooks@0.0.1",
    });

    expect(packTmpDir).not.toBe("");
    expect(fs.existsSync(packTmpDir)).toBe(false);
  });

  it("rejects non-registry npm specs", async () => {
    const result = await installHooksFromNpmSpec({ spec: "github:evil/evil" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("unsupported npm spec");
  });
});

describe("gmail watcher", () => {
  it("detects address already in use errors", () => {
    expect(isAddressInUseError("listen tcp 127.0.0.1:8788: bind: address already in use")).toBe(
      true,
    );
    expect(isAddressInUseError("EADDRINUSE: address already in use")).toBe(true);
    expect(isAddressInUseError("some other error")).toBe(false);
  });
});
