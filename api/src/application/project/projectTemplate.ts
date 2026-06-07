/**
 * IDE starter-template seeding — single source of truth.
 *
 * The in-browser IDE stores a project's files in R2 under
 * `ide/projects/{projectId}/`. A freshly-created project must open with a
 * runnable scaffold, not empty files (empty files forced the Run pipeline onto
 * run-only defaults that were never persisted). This module owns BOTH the
 * template content and the decision of when to seed it, so the creation routes
 * ([projectRoutes]) and the lazy self-heal on file-list ([ideRoutes]) share one
 * implementation instead of duplicating the template + gate logic.
 *
 * Seeding is NON-DESTRUCTIVE: it only writes when the project's IDE workspace
 * looks unseeded (no template file present with content), so it can run safely
 * on every file-list without ever clobbering a user's real work.
 */

export const IDE_PREFIX = 'ide/';

/** Default files for new (vanilla) projects. Must match the Run-flow defaults
 *  in IDENew.tsx so seeded projects run identically to the run-only fallback. */
export const VANILLA_TEMPLATE: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'my-app',
    version: '1.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
    },
    dependencies: {
      react: '^18.2.0',
      'react-dom': '^18.2.0',
    },
    devDependencies: {
      '@vitejs/plugin-react': '^4.0.0',
      vite: '^4.3.9',
    },
  }, null, 2),
  'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`,
  'src/main.jsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

function App() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Hello World! 🚀</h1>
      <p>Edit src/main.jsx to get started.</p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);`,
  'src/index.css': `body {
  margin: 0;
  padding: 0;
  font-family: system-ui, -apple-system, sans-serif;
}`,
  'vite.config.js': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});`,
};

/** The project fields the seeding decision needs. A `Project` domain instance
 *  satisfies this structurally (its getters expose these names). */
export interface SeedableProject {
  id: number;
  template: string | null;
  modality: string | null;
  sourceControlRepoFullName: string | null;
  githubRepoUrl: string | null;
}

/** A template-relative R2 object with its byte size. */
export interface TemplateObject {
  path: string;
  size: number;
}

/**
 * Whether this project should get the vanilla starter:
 *   - explicit `template === 'vanilla'`, OR
 *   - no template on a default 'designer' project with no connected repo.
 * Repo-connected projects are skipped (their files live in the git repo, not
 * R2); video/llm modalities are skipped (they don't run the Vite app).
 */
export function projectWantsVanilla(project: SeedableProject): boolean {
  const hasRepo = !!(project.sourceControlRepoFullName || project.githubRepoUrl);
  const isDesigner = (project.modality ?? 'designer') === 'designer';
  return project.template === 'vanilla' || (!project.template && isDesigner && !hasRepo);
}

/**
 * The project's IDE workspace looks unseeded when NO template file is present
 * with content — i.e. it is freshly-created (no objects) or legacy (the template
 * paths exist but are empty). If even one template file has content we treat the
 * project as in-use and never touch it.
 */
export function templateLooksUnseeded(objects: TemplateObject[]): boolean {
  return !objects.some((o) => o.size > 0 && o.path in VANILLA_TEMPLATE);
}

/** Write the template files that are missing or empty. Returns count written. */
async function writeMissingTemplateFiles(
  storage: R2Bucket,
  projectId: number,
  existing: TemplateObject[],
): Promise<number> {
  const prefix = `${IDE_PREFIX}projects/${projectId}/`;
  const sizeByPath = new Map(existing.map((o) => [o.path, o.size]));
  const toWrite = Object.entries(VANILLA_TEMPLATE).filter(([path]) => {
    const size = sizeByPath.get(path);
    return size === undefined || size === 0;
  });
  if (toWrite.length === 0) return 0;
  await Promise.all(toWrite.map(([path, content]) => storage.put(prefix + path, content)));
  return toWrite.length;
}

/**
 * Ensure the vanilla starter exists for a project. Self-contained: checks the
 * gate, lists R2, and seeds missing/empty files only when the workspace looks
 * unseeded. Safe to call on creation AND lazily on open. Returns files written.
 *
 * Callers on a hot read path (file-list) that have ALREADY listed the prefix
 * should pass `preListed` to avoid a redundant R2 list.
 */
export async function ensureProjectTemplate(
  storage: R2Bucket | undefined,
  project: SeedableProject,
  preListed?: TemplateObject[],
): Promise<number> {
  if (!storage || !projectWantsVanilla(project)) return 0;
  let existing = preListed;
  if (!existing) {
    const prefix = `${IDE_PREFIX}projects/${project.id}/`;
    const listed = await storage.list({ prefix });
    existing = (listed.objects ?? []).map((o) => ({ path: o.key.replace(prefix, ''), size: o.size }));
  }
  if (!templateLooksUnseeded(existing)) return 0;
  return writeMissingTemplateFiles(storage, project.id, existing);
}
