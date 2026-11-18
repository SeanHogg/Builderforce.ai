/**
 * W2: Rust detector
 *
 * A Rust HTTP service (`kind: 'rust'`) per service root holding a `Cargo.toml` whose
 * package serves HTTP (it depends on bfwc-wasi or a web framework, in `[dependencies]`
 * or a `[target.*.dependencies]` table). Two shapes, by what can run where:
 *
 * - **bfwc-wasi** (the browser's service ABI): nothing is compiled in the browser (the
 *   in-browser rustc gate has not passed) — the browser runtime runs PREBUILT
 *   wasm32-wasip1 modules, so the command is the module path,
 *   `./target/wasm32-wasip1/release/<name>.wasm` (the module reads `PORT`), built outside
 *   the browser by `cargo build --release --target wasm32-wasip1`. A reactor
 *   (`[lib] crate-type = ["cdylib"]`) is named after its lib (`-` → `_`); a binary after
 *   its first `[[bin]]`, else the package (hyphens kept, as cargo names it).
 * - **Any other web framework** (actix-web, rocket, a tokio-run axum): `cargo run
 *   --release`, a native server. The browser declines it (`cargo` needs a compiler), so it
 *   goes to the container target — the honest answer.
 *
 * A crate that is a member of the repo-root workspace (`members`, globs such as
 * `crates/*` included) builds into the workspace's `target/`. A virtual workspace
 * manifest (no `[package]`) is not a service. tokio-postgres (or a `.env.example`
 * Postgres `DATABASE_URL`) yields the blueprint's Postgres `database`, with no migration step.
 */

import type { AppBlueprint, AppService, BlueprintDetector } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';
import { pathGlobRegExp } from '../pathGlob';
import { tomlString, tomlStringArrays, tomlTables, type TomlTables } from './minimalToml';
import {
  detectAcrossServiceRoots,
  isPrimaryAt,
  POSTGRES_DATABASE_URL,
  postgresDatabase,
  processService,
  readsUnderServiceRoots,
  serviceIdFor,
  serviceRootFiles,
  type RootDetection,
} from './serviceRoots';

export const RUST_TARGET = 'wasm32-wasip1';
const BFWC_CRATE = 'bfwc-wasi';

/** Crates that make a package an HTTP service (bfwc-wasi included). */
const WEB_CRATES = [BFWC_CRATE, 'axum', 'actix-web', 'warp', 'rocket', 'poem', 'hyper', 'salvo', 'tide'];
const POSTGRES_CRATES = ['tokio-postgres', 'deadpool-postgres', 'postgres'];

/** `[dependencies]` and every `[target.<cfg>.dependencies]` table. */
const DEPENDENCY_TABLE = /^(?:target\..+\.)?dependencies$/;
/** A dependency given as its own table: `[dependencies.axum]`, `[target.x.dependencies.axum]`. */
const DEPENDENCY_SUBTABLE = /^(?:target\..+\.)?dependencies\.([^.]+)$/;

/** Every dependency the manifest names: `axum = "0.8"`, `axum.workspace = true`, `[dependencies.axum]`. */
function dependenciesOf(tables: TomlTables): Set<string> {
  const deps = new Set<string>();
  for (const [name, entries] of tables) {
    if (DEPENDENCY_TABLE.test(name)) for (const key of entries.keys()) deps.add(key.split('.')[0]!);
    const sub = DEPENDENCY_SUBTABLE.exec(name)?.[1];
    if (sub) deps.add(sub);
  }
  return deps;
}

/** The module cargo writes: a reactor's lib name (`-` → `_`), else the binary's name. */
function moduleName(tables: TomlTables, packageName: string): string {
  const lib = tables.get('lib');
  if (lib?.get('crate-type')?.includes('cdylib')) return (tomlString(lib.get('name')) ?? packageName).replace(/-/g, '_');
  return tomlString(tables.get('bin')?.get('name')) ?? packageName;
}

/** `crates/*` matches `crates/api` (a whole-segment `*` is one folder name; `pathGlob`'s one semantic). */
function memberMatches(member: string, dir: string): boolean {
  return pathGlobRegExp(member.replace(/^\.\//, '').replace(/\/$/, '')).test(dir);
}

/** Whether the repo-root Cargo.toml is a workspace this sub-root crate belongs to. */
function inRootWorkspace(files: Map<string, string>, rootName: string): boolean {
  const text = files.get('Cargo.toml');
  if (!rootName || text === undefined) return false;
  return tomlStringArrays(text, 'members', 'workspace').some((member) => memberMatches(member, rootName));
}

type RustCommands = Pick<AppService, 'devCommand' | 'buildCommand'>;

function prebuiltModule(files: Map<string, string>, rootName: string, tables: TomlTables, packageName: string): RustCommands {
  const targetDir = inRootWorkspace(files, rootName) ? '../target' : './target';
  return {
    devCommand: `${targetDir}/${RUST_TARGET}/release/${moduleName(tables, packageName)}.wasm`,
    buildCommand: `cargo build --release --target ${RUST_TARGET}`,
  };
}

const NATIVE_SERVER: RustCommands = { devCommand: 'cargo run --release', buildCommand: 'cargo build --release' };

/** The service (and database) one root's Cargo.toml describes, or null when it serves nothing. */
function detectRustRoot(files: Map<string, string>, rootName: string): RootDetection | null {
  const root = serviceRootFiles(files, rootName);
  const text = root.get('Cargo.toml');
  if (text === undefined) return null;
  const tables = tomlTables(text);
  const packageName = tomlString(tables.get('package')?.get('name'));
  const deps = dependenciesOf(tables);
  if (!packageName || !WEB_CRATES.some((crate) => deps.has(crate))) return null;

  const commands = deps.has(BFWC_CRATE) ? prebuiltModule(files, rootName, tables, packageName) : NATIVE_SERVER;
  const service = {
    ...processService({
      id: serviceIdFor(rootName, packageName, 'rust'),
      kind: SERVICE_KINDS.RUST,
      rootDir: root.rootDir,
      packageManager: 'cargo',
      installCommand: '',
      devCommand: commands.devCommand,
      isPrimary: isPrimaryAt(files),
    }),
    buildCommand: commands.buildCommand,
  };
  const postgres = POSTGRES_CRATES.some((crate) => deps.has(crate)) || POSTGRES_DATABASE_URL.test(root.get('.env.example') ?? '');
  return { service, database: postgres ? postgresDatabase('', '') : null };
}

/** Detect every Rust service across the service roots. */
export function detectRust(files: Map<string, string>): Partial<AppBlueprint> {
  return detectAcrossServiceRoots(files, detectRustRoot);
}

export const rustDetector: BlueprintDetector = {
  id: 'rust',
  name: 'Rust Project',
  reads: readsUnderServiceRoots(['Cargo.toml', '.env.example']),
  detect: detectRust,
};
