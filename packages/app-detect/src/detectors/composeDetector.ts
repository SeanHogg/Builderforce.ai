/**
 * W11: docker-compose detector (`compose.yaml` / `docker-compose.yml`).
 *
 * - A service with `build:` is an app service rooted at its build context. Its kind comes
 *   from the context's files when they were read (`package.json` → the Node detector's own
 *   reading; `requirements.txt` / `pyproject.toml` → python; `composer.json` → php;
 *   `Cargo.toml` → rust), else `node`. A build context at the repo root that another detector
 *   already reads (a root `package.json`, …) adds no service: that detector names it.
 * - A service on a known image is a resource: `postgres*` / `postgis*` / `pgvector*` → postgres,
 *   `redis*` / `valkey*` → redis, `minio*` → object storage, `mailpit*` / `mailhog*` → mail.
 *   `AppBlueprint` has no field for these, so they are returned as `composeResources` (which
 *   `emitManifest` declares) and named in the detection warnings.
 * - Any other image is a warning naming it: the browser runtime does not run arbitrary images.
 *
 * Its reads are the four compose file names; `followReads` asks for each build context's
 * manifests so the kind can be told.
 */

import type { AppService, ServiceKind } from '@builderforce/creation-canvas-contract';
import { SERVICE_KIND_DEV_PORTS, SERVICE_KINDS } from '@builderforce/creation-canvas-contract';
import { detectionNote, errorText, warningFindings, type DetectionNote } from '../notes';
import type { AppDetector, ComposeResource, ComposeResourceType, DetectorFindings } from '../types';
import { parseYaml, yamlMap, type YamlValue } from './minimalYaml';
import { detectFromPackageJson } from './packageJsonDetector';
import { repoRelativePath } from '../pathGlob';

/** Compose's own file-name precedence. */
export const COMPOSE_FILES: readonly string[] = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];

/** The manifests a build context is told apart by, in priority order. */
const CONTEXT_MANIFESTS: readonly { file: string; kind: ServiceKind }[] = [
  { file: 'package.json', kind: SERVICE_KINDS.NODE },
  { file: 'requirements.txt', kind: SERVICE_KINDS.PYTHON },
  { file: 'pyproject.toml', kind: SERVICE_KINDS.PYTHON },
  { file: 'composer.json', kind: SERVICE_KINDS.PHP },
  { file: 'Cargo.toml', kind: SERVICE_KINDS.RUST },
];

/** Known images, by the image's name (registry, owner and tag dropped). */
const IMAGE_RESOURCES: readonly { pattern: RegExp; type: ComposeResourceType; extensions?: string[] }[] = [
  { pattern: /^pgvector/, type: 'postgres', extensions: ['vector'] },
  { pattern: /^(postgres|postgis)/, type: 'postgres' },
  { pattern: /^(redis|valkey)/, type: 'redis' },
  { pattern: /^minio/, type: 'object-storage' },
  { pattern: /^(mailpit|mailhog)/, type: 'mail' },
];

/** The dev command and package manager a context of each kind gets when nothing better is known. */
const KIND_DEFAULTS: Partial<Record<ServiceKind, Pick<AppService, 'packageManager' | 'installCommand' | 'devCommand'>>> = {
  node: { packageManager: 'npm', installCommand: 'npm install', devCommand: 'npm run dev' },
  python: { packageManager: 'pip', installCommand: 'pip install -r requirements.txt', devCommand: 'python main.py' },
  php: { packageManager: 'composer', installCommand: 'composer install', devCommand: 'php -S 0.0.0.0:8000 -t public' },
  rust: { packageManager: 'cargo', installCommand: '', devCommand: 'cargo run' },
};

export function composeFileOf(files: Map<string, string>): { name: string; content: string } | null {
  for (const name of COMPOSE_FILES) {
    const content = files.get(name);
    if (content !== undefined) return { name, content };
  }
  return null;
}

/** `postgres:16-alpine`, `docker.io/bitnami/redis@sha256:…` → `postgres`, `redis`. */
export function imageName(image: string): string {
  const last = image.trim().toLowerCase().split('/').pop() ?? '';
  return last.split('@')[0]!.split(':')[0]!;
}

/** A build context as a repo-relative dir (`''` = root), or null when it leaves the repo or is a URL. */
function contextDir(build: YamlValue): string | null {
  const raw = typeof build === 'string' ? build : typeof yamlMap(build)?.context === 'string' ? (yamlMap(build)!.context as string) : '.';
  if (/^[a-z]+:\/\//i.test(raw) || raw.startsWith('git@')) return null;
  const trimmed = raw.trim().replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (trimmed === '' || trimmed === '.') return '';
  return repoRelativePath(trimmed);
}

const under = (dir: string, file: string): string => (dir ? `${dir}/${file}` : file);

/** The container side of each `ports` entry (`"8080:80"` → 80, `{ target: 80 }` → 80). */
function containerPorts(ports: YamlValue | undefined): number[] {
  if (!Array.isArray(ports)) return [];
  const found: number[] = [];
  for (const entry of ports) {
    const raw = typeof entry === 'string' ? entry.split(':').pop() : yamlMap(entry)?.target;
    const port = typeof raw === 'string' ? Number.parseInt(raw.split('/')[0]!.split('-')[0]!, 10) : NaN;
    if (Number.isInteger(port) && port > 0 && port <= 65535) found.push(port);
  }
  return found;
}

/** `depends_on` as a list or a map, as service names. */
function dependsOnNames(value: YamlValue | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  const map = yamlMap(value);
  return map ? Object.keys(map) : [];
}

function commandLine(value: YamlValue | undefined): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')) return (value as string[]).join(' ');
  return null;
}

/** The Node detector's reading of a context's `package.json`; an unreadable one is a warning and the `node` defaults. */
function nodeService(content: string, warnings: DetectionNote[], path: string): AppService | undefined {
  try {
    return detectFromPackageJson(content).services?.[0];
  } catch (error) {
    warnings.push(detectionNote('compose-package-unreadable', { path, error: errorText(error) }));
    return undefined;
  }
}

/** The service a build context runs, or null when another detector reads that root already. */
function appService(
  files: Map<string, string>,
  name: string,
  dir: string,
  entry: { [key: string]: YamlValue },
  warnings: DetectionNote[],
): AppService | null {
  const manifest = CONTEXT_MANIFESTS.find((m) => files.has(under(dir, m.file)));
  if (dir === '' && manifest) return null;
  const declaredPorts = containerPorts(entry.ports);
  const command = commandLine(entry.command);
  // A context's folder is its id (`api`), as the language detectors name a service root — so the two merge.
  const id = dir ? dir.replace(/\//g, '-') : name;
  if (manifest?.file === 'package.json') {
    const node = nodeService(files.get(under(dir, 'package.json'))!, warnings, under(dir, 'package.json'));
    if (node) {
      return {
        ...node, id, rootDir: dir, isPrimary: false,
        ...(command ? { devCommand: command } : {}),
        ...(declaredPorts.length > 0 ? { ports: declaredPorts } : {}),
      };
    }
  }
  const kind = manifest?.kind ?? SERVICE_KINDS.NODE;
  const defaults = KIND_DEFAULTS[kind]!;
  const devCommand = command ?? defaults.devCommand;
  const kindPort = SERVICE_KIND_DEV_PORTS[kind];
  return {
    id,
    kind,
    rootDir: dir || '.',
    packageManager: defaults.packageManager,
    installCommand: defaults.installCommand,
    devCommand,
    buildCommand: '',
    startCommand: devCommand,
    verifyCommand: null,
    outputDir: null,
    ports: declaredPorts.length > 0 ? declaredPorts : kindPort === null ? [] : [kindPort],
    envVars: [],
    isPrimary: false,
  };
}

/** Detect from a compose file's content. */
export function detectFromCompose(files: Map<string, string>, fileName: string, content: string): DetectorFindings {
  const services = yamlMap(yamlMap(parseYaml(content))?.services);
  if (!services) return warningFindings([detectionNote('compose-no-services', { file: fileName })]);

  const warnings: DetectionNote[] = [];
  const resources: ComposeResource[] = [];
  const apps = new Map<string, AppService>();
  const appDepends = new Map<string, string[]>();
  for (const [name, value] of Object.entries(services)) {
    const entry = yamlMap(value);
    if (!entry) continue;
    if (entry.build !== undefined && entry.build !== null) {
      const dir = contextDir(entry.build);
      if (dir === null) {
        warnings.push(detectionNote('compose-context-outside', { file: fileName, service: name }));
        continue;
      }
      const service = appService(files, name, dir, entry, warnings);
      if (service) apps.set(name, service);
      appDepends.set(name, dependsOnNames(entry.depends_on));
      continue;
    }
    const image = typeof entry.image === 'string' ? entry.image : null;
    if (!image) {
      warnings.push(detectionNote('compose-no-image', { file: fileName, service: name }));
      continue;
    }
    const known = IMAGE_RESOURCES.find((r) => r.pattern.test(imageName(image)));
    if (!known) {
      warnings.push(detectionNote('compose-image-unsupported', { file: fileName, service: name, image }));
      continue;
    }
    resources.push({ id: name, type: known.type, image, ...(known.extensions ? { extensions: known.extensions } : {}), usedBy: [] });
    warnings.push(detectionNote('compose-image-resource', { file: fileName, service: name, image, type: known.type }));
  }

  // Edges: an app's `depends_on` names another app (→ `dependsOn`) or a resource (→ `usedBy`).
  // A root service another detector names keeps the compose name, so its resource edges still land on that name.
  for (const [name, deps] of appDepends) {
    const serviceId = apps.get(name)?.id ?? name;
    const app = apps.get(name);
    const appDeps = deps.filter((dep) => apps.has(dep)).map((dep) => apps.get(dep)!.id);
    if (app && appDeps.length > 0) app.dependsOn = appDeps;
    for (const resource of resources) if (deps.includes(resource.id)) resource.usedBy.push(serviceId);
  }

  return {
    ...(apps.size > 0 ? { services: [...apps.values()] } : {}),
    ...(resources.length > 0 ? { composeResources: resources } : {}),
    ...warningFindings(warnings),
  };
}

export const composeDetector: AppDetector = {
  id: 'docker-compose',
  name: 'Docker Compose',
  reads: [...COMPOSE_FILES],
  followReads: (files) => {
    const compose = composeFileOf(files);
    if (!compose) return [];
    const services = yamlMap(yamlMap(parseYaml(compose.content))?.services) ?? {};
    const dirs = Object.values(services)
      .map((value) => yamlMap(value)?.build)
      .filter((build): build is YamlValue => build !== undefined && build !== null)
      .map(contextDir)
      .filter((dir): dir is string => dir !== null && dir !== '');
    return [...new Set(dirs)].flatMap((dir) => CONTEXT_MANIFESTS.map((m) => under(dir, m.file)));
  },
  detect: (files) => {
    const compose = composeFileOf(files);
    return compose ? detectFromCompose(files, compose.name, compose.content) : {};
  },
};
