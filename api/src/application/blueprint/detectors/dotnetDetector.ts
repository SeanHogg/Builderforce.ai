/**
 * W2: .NET detector
 *
 * An ASP.NET Core service (`kind: 'dotnet'`) per service root holding a web project: a
 * `*.csproj` on `Microsoft.NET.Sdk.Web` (`Sdk="…"` with or without a version, or an
 * `<Sdk Name="…"/>` element), found directly in the root or listed by a solution
 * (`.sln` / `.slnx`) there. A class library, console, worker or Blazor WebAssembly
 * project is not a service. Commands are the ones the browser runtime's `dotnet` takes:
 *
 * - `dotnet run --urls http://0.0.0.0:8080` — Kestrel's default (5000) would not match
 *   the kind's port, so the URL is named; launch profiles yield to it.
 * - `--project <path>` whenever the root is ambiguous (a solution, several project files)
 *   or the project sits in a subfolder: the runtime builds one project, never a solution.
 *   A path with spaces or shell characters is quoted.
 * - `dotnet restore [<path>]` installs (the runtime checks packages against its bundle).
 *
 * Npgsql (directly or through its EF Core provider) yields the blueprint's Postgres
 * `database`. EF migrations are not run (`dotnet ef` is declined in the browser), so
 * there is no migration step.
 */

import type { AppBlueprint, BlueprintDetector } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';
import {
  detectAcrossServiceRoots,
  devPortOf,
  isPrimaryAt,
  postgresDatabase,
  processService,
  readsUnderServiceRoots,
  SERVICE_ROOTS,
  serviceIdFor,
  serviceRootFiles,
  type RootDetection,
} from './serviceRoots';

const PORT = devPortOf(SERVICE_KINDS.DOTNET);
const URLS = `--urls http://0.0.0.0:${PORT}`;

const PROJECT = /\.csproj$/i;
const SOLUTION = /\.slnx?$/i;
const WEB_SDK = /\b(?:Sdk|Name)\s*=\s*["']Microsoft\.NET\.Sdk\.Web(?:\/[^"']*)?["']/i;
const NPGSQL = /<PackageReference\s+Include\s*=\s*["']Npgsql(?:\.EntityFrameworkCore\.PostgreSQL)?["']/i;
/** `Project("{guid}") = "Api", "src\Api\Api.csproj", "{guid}"` (.sln) and `<Project … Path="src/Api/Api.csproj" />` (.slnx). */
const SLN_PROJECT = /^Project\("[^"]*"\)\s*=\s*"[^"]*"\s*,\s*"([^"]+\.csproj)"/gim;
const SLNX_PROJECT = /<Project\b[^>]*?\bPath\s*=\s*"([^"]+\.csproj)"/gi;
/** A path the command line can take as one bare word. */
const BARE_WORD = /^[\w./-]+$/;

/** `src\Api\Api.csproj` → `src/Api/Api.csproj`. */
function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function solutionProjects(text: string): string[] {
  return [...text.matchAll(SLN_PROJECT), ...text.matchAll(SLNX_PROJECT)].map((m) => normalizeProjectPath(m[1]!));
}

/** The files directly in `root` (relative names), from the paths detection read. */
function directFiles(files: Map<string, string>, root: string): string[] {
  const prefix = root ? `${root}/` : '';
  return [...files.keys()]
    .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
    .map((path) => path.slice(prefix.length))
    .sort();
}

/** Whether a root holds a project or solution file directly — then it detects its own service. */
function holdsDotnetManifest(files: Map<string, string>, root: string): boolean {
  return directFiles(files, root).some((name) => PROJECT.test(name) || SOLUTION.test(name));
}

/**
 * A repo-root solution listing a project inside a backend folder that is a .NET root of
 * its own (`api/Api.csproj`, `api/src/Api/Api.csproj` beside `api/Api.sln`) leaves it to
 * that folder, so one project is never two services.
 */
function ownedByAnotherRoot(files: Map<string, string>, root: string, project: string): boolean {
  const first = project.split('/')[0]!;
  return root === '' && project.includes('/') && first !== '' && SERVICE_ROOTS.includes(first) && holdsDotnetManifest(files, first);
}

const shellWord = (path: string): string => (BARE_WORD.test(path) ? path : `"${path}"`);

/** The service (and database) one root's web project describes, or null when it holds none. */
function detectDotnetRoot(files: Map<string, string>, rootName: string): RootDetection | null {
  const root = serviceRootFiles(files, rootName);
  const direct = directFiles(files, rootName);
  const projectFiles = direct.filter((name) => PROJECT.test(name));
  const solutions = direct.filter((name) => SOLUTION.test(name));
  const candidates = [...new Set([...solutions.flatMap((sln) => solutionProjects(root.get(sln) ?? '')), ...projectFiles])]
    .filter((project) => !ownedByAnotherRoot(files, rootName, project));
  const project = candidates.find((path) => WEB_SDK.test(root.get(path) ?? ''));
  if (!project) return null;

  const ambiguous = project.includes('/') || projectFiles.length + solutions.length > 1;
  const target = ambiguous ? ` ${shellWord(project)}` : '';
  const service = processService({
    id: serviceIdFor(rootName, project.split('/').pop()!.replace(PROJECT, ''), 'dotnet'),
    kind: SERVICE_KINDS.DOTNET,
    rootDir: root.rootDir,
    packageManager: 'dotnet',
    installCommand: `dotnet restore${target}`,
    devCommand: ambiguous ? `dotnet run --project${target} ${URLS}` : `dotnet run ${URLS}`,
    isPrimary: isPrimaryAt(files),
  });
  const database = NPGSQL.test(root.get(project) ?? '') ? postgresDatabase('', '') : null;
  return { service, database };
}

/** Detect every ASP.NET Core service across the service roots. */
export function detectDotnet(files: Map<string, string>): Partial<AppBlueprint> {
  return detectAcrossServiceRoots(files, detectDotnetRoot);
}

export const dotnetDetector: BlueprintDetector = {
  id: 'dotnet',
  name: '.NET Project',
  // Projects directly in a root, and one or two folders down (where a solution keeps them);
  // blueprintSources caps how many files one glob may pull in.
  reads: readsUnderServiceRoots(['*.csproj', '*.sln', '*.slnx', '*/*.csproj', '*/*/*.csproj']),
  detect: detectDotnet,
};
