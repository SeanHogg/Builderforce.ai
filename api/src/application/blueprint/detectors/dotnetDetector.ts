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
 *   A path with spaces or shell characters is single-quoted.
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
  pathUnder,
  postgresDatabase,
  processService,
  readsUnderServiceRoots,
  SERVICE_ROOTS,
  serviceIdFor,
  serviceRootFiles,
  type RootDetection,
} from './serviceRoots';
import { repoRelativePath } from '../pathGlob';

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

/** `src\Api\Api.csproj` → `src/Api/Api.csproj`; `..` resolved within the root; a path leaving it (or absolute) → null. */
function normalizeProjectPath(path: string): string | null {
  return repoRelativePath(path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, ''));
}

function solutionProjects(text: string): string[] {
  return [...text.matchAll(SLN_PROJECT), ...text.matchAll(SLNX_PROJECT)]
    .map((m) => normalizeProjectPath(m[1]!))
    .filter((path): path is string => path !== null);
}

/** The files directly in `root` (relative names), from the paths detection read. */
function directFiles(files: Map<string, string>, root: string): string[] {
  const prefix = root ? `${root}/` : '';
  return [...files.keys()]
    .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
    .map((path) => path.slice(prefix.length))
    .sort();
}

/** A root's project and solution files (directly in it), and the projects it can run (relative to it). */
function rootProjects(files: Map<string, string>, rootName: string) {
  const direct = directFiles(files, rootName);
  const projectFiles = direct.filter((name) => PROJECT.test(name));
  const solutions = direct.filter((name) => SOLUTION.test(name));
  const listed = solutions.flatMap((sln) => solutionProjects(files.get(pathUnder(rootName, sln)) ?? ''));
  return { projectFiles, solutions, candidates: [...new Set([...listed, ...projectFiles])] };
}

/** The web project a root runs (relative to it): the first web project among its candidates. */
function pickedProject(files: Map<string, string>, rootName: string, candidates: readonly string[]): string | undefined {
  return candidates.find((path) => WEB_SDK.test(files.get(pathUnder(rootName, path)) ?? ''));
}

/**
 * A repo-root solution listing the project a backend folder's own root RUNS (`api/Api.csproj`,
 * or `api/src/Api/Api.csproj` picked from `api/Api.sln`) leaves it to that folder, so one
 * project is never two services. (Backend roots never defer, so their pick is final.)
 */
function ownedByAnotherRoot(files: Map<string, string>, root: string, project: string): boolean {
  const slash = project.indexOf('/');
  if (root !== '' || slash === -1) return false;
  const first = project.slice(0, slash);
  return SERVICE_ROOTS.includes(first) && pickedProject(files, first, rootProjects(files, first).candidates) === project.slice(slash + 1);
}

/** One shell word: as is when bare, else single-quoted (an embedded `'` as `'\''`). */
const shellWord = (path: string): string => (BARE_WORD.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`);

/** The projects every root's solutions name, as repo paths — read in a second pass, within the follow-read reserve. */
function solutionListedProjects(files: Map<string, string>): string[] {
  return SERVICE_ROOTS.flatMap((root) => rootProjects(files, root).candidates.map((project) => pathUnder(root, project)));
}

/** The service (and database) one root's web project describes, or null when it holds none. */
function detectDotnetRoot(files: Map<string, string>, rootName: string): RootDetection | null {
  const root = serviceRootFiles(files, rootName);
  const { projectFiles, solutions, candidates: offered } = rootProjects(files, rootName);
  const candidates = offered.filter((project) => !ownedByAnotherRoot(files, rootName, project));
  const project = pickedProject(files, rootName, candidates);
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
  // Glob matches share blueprintSources' read budget; the projects a solution
  // names are read in a second pass (followReads), within blueprintSources' read budget.
  // Solutions first: glob reads share a budget in this order.
  reads: readsUnderServiceRoots(['*.sln', '*.slnx', '*.csproj', '*/*.csproj', '*/*/*.csproj']),
  followReads: solutionListedProjects,
  detect: detectDotnet,
};
