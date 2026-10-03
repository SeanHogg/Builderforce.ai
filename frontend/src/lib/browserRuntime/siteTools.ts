/**
 * Build and type-check a project from its files, in the browser, with no
 * install and no server — what Publish and Check run.
 *
 * Both work on the files handed in, never on the running preview, so a publish
 * or a check leaves the preview (and the overlays mounted into it) untouched.
 * The packages load lazily: an editor that never publishes pays nothing.
 */
import type { BuiltFile } from '@seanhogg/builderforce-webcontainers';
import type { Checker, CheckDiagnostic } from '@seanhogg/builderforce-webcontainers/check';

/** A relative base, so the site works at `<sub>.builderforce.ai/` AND under the `/api/sites/<sub>/` path form. */
const SITE_BASE = './';

/** `npm run build`, in the browser: a deployable static site (`index.html`, hashed `assets/`, `public/`). */
export async function buildSite(files: Record<string, string>): Promise<BuiltFile[]> {
  const { buildProject, createEsbuildWasmBundler, createCdnComponentCompilers } = await import('@seanhogg/builderforce-webcontainers');
  const result = await buildProject({
    files,
    bundler: await createEsbuildWasmBundler(),
    components: createCdnComponentCompilers(),
    base: SITE_BASE,
  });
  return result.files;
}

let checker: Promise<Checker> | null = null;

/** One checker per page: its worker caches TypeScript and dependency types between checks. */
function sharedChecker(): Promise<Checker> {
  checker ??= import('@seanhogg/builderforce-webcontainers/check')
    .then(({ createChecker }) => createChecker())
    .catch((error: unknown) => {
      checker = null;
      throw error;
    });
  return checker;
}

export interface TypecheckOutcome {
  errors: CheckDiagnostic[];
  /** Every diagnostic, one line each, as `tsc` would print them. */
  lines: string[];
}

export async function typecheckFiles(files: Record<string, string>): Promise<TypecheckOutcome> {
  const [{ formatDiagnostic }, check] = await Promise.all([import('@seanhogg/builderforce-webcontainers/check'), sharedChecker()]);
  const result = await check.check(files);
  return {
    errors: result.diagnostics.filter((d) => d.category === 'error'),
    lines: result.diagnostics.map(formatDiagnostic),
  };
}

/** Is there TypeScript to check? A config, or a `.ts`/`.tsx` source. */
export function hasTypeScript(files: Record<string, string>): boolean {
  return Object.keys(files).some((path) => path === 'tsconfig.json' || /\.(ts|tsx|mts|cts)$/.test(path));
}
