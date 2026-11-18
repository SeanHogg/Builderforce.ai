/**
 * W2: Rust detector
 *
 * A Rust HTTP service (`kind: 'rust'`) per service root holding a `Cargo.toml` whose
 * crate serves HTTP (it depends on bfwc-wasi or a web framework). Nothing is compiled
 * in the browser (the in-browser rustc gate has not passed): the browser runtime runs
 * PREBUILT wasm32-wasip1 modules only, so the service's command is the module path —
 * `./target/wasm32-wasip1/release/<name>.wasm` — and the module reads `PORT`. The build
 * is `cargo build --release --target wasm32-wasip1`, run outside the browser; there is
 * nothing to install.
 *
 * The module's name: a reactor (`[lib] crate-type = ["cdylib"]`, how a bfwc-wasi service
 * is built) is named after its lib (`-` → `_`); a binary after its first `[[bin]]`, else
 * the package (hyphens kept, as cargo names it). A crate that is a member of a repo-root
 * workspace builds into the workspace's `target/`. A virtual workspace manifest (no
 * `[package]`) is not a service. tokio-postgres (or a `.env.example` Postgres
 * `DATABASE_URL`) yields the blueprint's Postgres `database`, with no migration step.
 */

import type { AppBlueprint, BlueprintDetector } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';
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
export const RUST_BUILD_COMMAND = `cargo build --release --target ${RUST_TARGET}`;

/** Crates that make a package an HTTP service. */
const WEB_CRATES = ['bfwc-wasi', 'axum', 'actix-web', 'warp', 'rocket', 'poem', 'hyper', 'salvo', 'tide'];
const POSTGRES_CRATES = ['tokio-postgres', 'deadpool-postgres', 'postgres'];

/** Cargo.toml as `section → key → raw value` (`[[bin]]` keeps its first table). Enough for the keys read here. */
type Manifest = Map<string, Map<string, string>>;

function parseManifest(text: string): Manifest {
  const manifest: Manifest = new Map();
  let section = new Map<string, string>();
  manifest.set('', section);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header) {
      const name = header[1]!;
      section = manifest.get(name) ?? new Map();
      if (!manifest.has(name)) manifest.set(name, section);
      continue;
    }
    const entry = /^("?[\w.-]+"?)\s*=\s*(.*)$/.exec(line);
    if (entry && !section.has(entry[1]!.replace(/"/g, ''))) section.set(entry[1]!.replace(/"/g, ''), entry[2]!);
  }
  return manifest;
}

const unquote = (value: string | undefined) => value?.match(/^["']([^"']*)["']/)?.[1];

function dependsOn(manifest: Manifest, crates: readonly string[]): boolean {
  const deps = manifest.get('dependencies');
  // `axum = "0.8"`, or a `[dependencies.axum]` table.
  return crates.some((crate) => deps?.has(crate) || manifest.has(`dependencies.${crate}`));
}

/** The module cargo writes: a reactor's lib name (`-` → `_`), else the binary's name. */
function moduleName(manifest: Manifest, packageName: string): string {
  const lib = manifest.get('lib');
  if (lib?.get('crate-type')?.includes('cdylib')) return (unquote(lib.get('name')) ?? packageName).replace(/-/g, '_');
  return unquote(manifest.get('bin')?.get('name')) ?? packageName;
}

/** Whether the repo-root Cargo.toml is a workspace this sub-root crate belongs to. */
function inRootWorkspace(files: Map<string, string>, rootName: string): boolean {
  if (!rootName) return false;
  const members = parseManifest(files.get('Cargo.toml') ?? '').get('workspace')?.get('members');
  return members !== undefined && (members.includes(`"${rootName}"`) || members.includes('"*"'));
}

/** The service (and database) one root's Cargo.toml describes, or null when it serves nothing. */
function detectRustRoot(files: Map<string, string>, rootName: string): RootDetection | null {
  const root = serviceRootFiles(files, rootName);
  const text = root.get('Cargo.toml');
  if (text === undefined) return null;
  const manifest = parseManifest(text);
  const packageName = unquote(manifest.get('package')?.get('name'));
  if (!packageName || !dependsOn(manifest, WEB_CRATES)) return null;

  const targetDir = inRootWorkspace(files, rootName) ? '../target' : './target';
  const command = `${targetDir}/${RUST_TARGET}/release/${moduleName(manifest, packageName)}.wasm`;
  const service = {
    ...processService({
      id: serviceIdFor(rootName, packageName, 'rust'),
      kind: SERVICE_KINDS.RUST,
      rootDir: root.rootDir,
      packageManager: 'cargo',
      installCommand: '',
      devCommand: command,
      isPrimary: isPrimaryAt(files),
    }),
    buildCommand: RUST_BUILD_COMMAND,
  };
  const postgres = dependsOn(manifest, POSTGRES_CRATES) || POSTGRES_DATABASE_URL.test(root.get('.env.example') ?? '');
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
