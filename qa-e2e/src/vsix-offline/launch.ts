/**
 * VS Code binary resolution + VSIX packaging for the PRD 41 §A6 packaged
 * acceptance scenario. Network-touching steps are done UP FRONT, before the
 * egress-denied instance launches (per the G27 design: "VS Code itself is
 * downloaded before the network is cut").
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VSIX_DIR = path.resolve(HERE, '..', '..', '..', 'clients', 'vscode');

export interface VsCodeInstall {
  /** The Code executable (Code.exe on Windows, Code/bin/code on Linux/mac). */
  readonly executable: string;
  /** The electron binary @vscode/test-electron launched. */
  readonly electron: string;
  readonly version: string;
}

export interface VsixArtifact {
  readonly path: string;
  readonly name: string;
}

function versionFromInstallDir(dir: string): string {
  const m = /-(\d+\.\d+\.\d+)$/.exec(path.basename(dir));
  return m ? m[1] : 'unknown';
}

/**
 * A cached VS Code under clients/vscode/.vscode-test/ (the folder
 * `test-integration/runTests.ts` manages). Downloading must happen before
 * the network is cut, so the scenario calls this FIRST, then packages the
 * VSIX, then starts the egress control and launches.
 */
export function resolveVsCode(): VsCodeInstall {
  const cacheDir = path.join(VSIX_DIR, '.vscode-test');
  if (!existsSync(cacheDir)) {
    throw new Error(
      `no cached VS Code under ${cacheDir}. Run 'pnpm test:integration' in clients/vscode once (with network) so the binary is downloaded, then re-run the A6 scenario.`,
    );
  }
  const installs = readdirSync(cacheDir).filter((e) => /^vscode-[a-z0-9-]+-\d+\.\d+/.test(e));
  if (installs.length === 0) {
    throw new Error(`no vscode-<platform>-<version> install under ${cacheDir} — download it first (see above).`);
  }
  const installDir = path.join(cacheDir, installs.sort().reverse()[0]);
  const version = versionFromInstallDir(installDir);
  const resourcesApp = path.join(installDir, 'resources', 'app');

  if (process.platform === 'win32') {
    const electron = path.join(installDir, 'Code.exe');
    if (!existsSync(electron)) throw new Error(`expected Code.exe at ${electron}`);
    return { executable: electron, electron, version };
  }
  // Linux/mac: the launchable is resources/app/bin/code; the Electron binary
  // is the real egress origin for the firewall rule.
  const code = path.join(resourcesApp, 'bin', 'code');
  const electron = existsSync(path.join(installDir, 'code'))
    ? path.join(installDir, 'code')
    : path.join(resourcesApp, '..', '..', 'code');
  if (!existsSync(code)) throw new Error(`expected code launcher at ${code}`);
  return { executable: code, electron: existsSync(electron) ? electron : code, version };
}

/**
 * Build + package the VSIX with the existing `clients/vscode` scripts. Runs
 * while the network is still up (esbuild/vite/vsce may fetch); the produced
 * .vsix is what the denied instance installs.
 */
export function packageVsix(): VsixArtifact {
  run('node', ['vsce-platform.mjs', 'package'], VSIX_DIR);
  const artifacts = readdirSync(VSIX_DIR).filter((e) => e.endsWith('.vsix'));
  if (artifacts.length === 0) throw new Error(`vsce package produced no .vsix under ${VSIX_DIR}`);
  const name = artifacts.sort().reverse()[0];
  return { path: path.join(VSIX_DIR, name), name };
}

export interface FixtureRepo {
  readonly root: string;
  readonly fileCount: number;
}

/**
 * A fresh fixture repo. A6 step 2 asks for ~2,000 files in 4 languages; that
 * is the full-scale CI fixture. Locally a `--small` fixture (~40 files in 4
 * languages) keeps the run minutes-fast — the assertions are identical.
 */
export function createFixtureRepo(scale: 'small' | 'full'): FixtureRepo {
  const root = mkdtempSync(path.join(tmpdir(), `bf-a6-fixture-${scale}-`));
  const templates = [
    { ext: 'ts', count: scale === 'full' ? 500 : 10, make: (i: number) => tsFile(i) },
    { ext: 'js', count: scale === 'full' ? 500 : 10, make: (i: number) => jsFile(i) },
    { ext: 'py', count: scale === 'full' ? 500 : 10, make: (i: number) => pyFile(i) },
    { ext: 'go', count: scale === 'full' ? 500 : 10, make: (i: number) => goFile(i) },
  ];
  let fileCount = 0;
  for (const lang of templates) {
    const dir = path.join(root, `src-${lang.ext}`);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < lang.count; i++) {
      writeFileSync(path.join(dir, `mod${i}.${lang.ext}`), lang.make(i));
      fileCount++;
    }
  }
  return { root, fileCount };
}

function tsFile(i: number): string {
  return `export function fn${i}(a: number, b: number): number {\n  return a + b + ${i};\n}\n`;
}
function jsFile(i: number): string {
  return `module.exports = function fn${i}(a, b) {\n  return a * b + ${i};\n};\n`;
}
function pyFile(i: number): string {
  return `def fn${i}(a, b):\n    return a - b + ${i}\n`;
}
function goFile(i: number): string {
  return `package mod${i}\n\nfunc Fn${i}(a, b int) int {\n\treturn a + b + ${i}\n}\n`;
}

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}
