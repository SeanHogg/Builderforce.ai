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

/**
 * The mobile scaffold's Vite config.
 *
 * Two things make a React Native app run in the browser preview:
 *
 *  1. `react-native` aliases to `react-native-web`, so the SAME source renders
 *     here and still compiles for iOS/Android under Expo.
 *  2. The `jsx-in-js` plugin. React Native convention puts JSX in `.js` files,
 *     but Vite only treats `.jsx` as JSX — its esbuild pass EXCLUDES `.js` by
 *     default, and neither `optimizeDeps` (which only covers dependency
 *     pre-bundling) nor `@vitejs/plugin-react` picks it up. Without this,
 *     `App.js` and `index.js` fail to parse: the dev server logs "Failed to
 *     parse source for import analysis" and serves a blank preview, and `vite
 *     build` dies with "RollupError: Unexpected token". Transforming `.js`
 *     through esbuild's JSX loader per file (rather than forcing a global
 *     `esbuild.loader`) keeps `.jsx`/`.ts`/`.tsx` on Vite's own defaults, so a
 *     TypeScript file added later still compiles.
 */
const MOBILE_VITE_CONFIG = `import { defineConfig, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

// React Native puts JSX in .js files, but Vite only treats .jsx as JSX. Run .js
// sources through esbuild's JSX loader so App.js and friends compile in dev AND
// in \`vite build\`; .jsx/.ts/.tsx keep Vite's own defaults.
const jsxInJs = {
  name: 'jsx-in-js',
  async transform(code, id) {
    const [file] = id.split('?');
    if (!file.endsWith('.js') || file.includes('node_modules')) return null;
    return transformWithEsbuild(code, file, { loader: 'jsx', jsx: 'automatic' });
  },
};

// react-native-web lets the same React Native source render in the browser
// preview. Keep this alias in place so the app stays portable to Expo.
export default defineConfig({
  plugins: [jsxInJs, react()],
  resolve: {
    alias: { 'react-native': 'react-native-web' },
    extensions: ['.web.js', '.web.jsx', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
  },
  define: { global: 'window', __DEV__: 'true' },
  optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
});`;

/**
 * Default files for new Mobile projects — a React Native app rendered through
 * react-native-web so it runs in the IDE's browser preview while staying
 * portable to Expo. Must match MOBILE_DEFAULTS in the frontend's
 * `lib/vanillaDefaults.ts` so a seeded project runs identically to the run-only
 * fallback — `vanillaDefaults.parity.test.ts` fails the build if they drift.
 */
export const MOBILE_TEMPLATE: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'my-mobile-app',
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
      'react-native-web': '^0.19.10',
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>My Mobile App</title>
    <style>
      html, body, #root { height: 100%; margin: 0; }
      body { overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/index.js"></script>
  </body>
</html>`,
  'index.js': `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')).render(<App />);`,
  'App.js': `import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>My Mobile App</Text>
        <Text style={styles.subtitle}>Edit App.js to get started</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>You tapped</Text>
          <Text style={styles.counter}>{count}</Text>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={() => setCount((c) => c + 1)}
          >
            <Text style={styles.buttonText}>Tap me</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f1020' },
  header: { paddingTop: 64, paddingHorizontal: 24, paddingBottom: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#ffffff' },
  subtitle: { fontSize: 14, color: '#9ca3af', marginTop: 4 },
  content: { padding: 24 },
  card: {
    backgroundColor: '#1a1b2e',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  cardLabel: { fontSize: 14, color: '#9ca3af' },
  counter: { fontSize: 48, fontWeight: '700', color: '#ffffff', marginVertical: 8 },
  button: {
    backgroundColor: '#e2654a',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonPressed: { opacity: 0.75 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});`,
  'vite.config.js': MOBILE_VITE_CONFIG,
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

/** Every starter template, keyed by the `template` value that selects it. */
export const TEMPLATES: Record<string, Record<string, string>> = {
  vanilla: VANILLA_TEMPLATE,
  mobile: MOBILE_TEMPLATE,
};

/**
 * Modalities that run code in the WebContainer, mapped to their starter.
 *
 * `webmobile` (Web + Mobile) ships ONE react-native-web codebase that renders
 * full-width as a site and inside the phone simulator, so it takes the mobile
 * scaffold — the same call the frontend's `defaultsForModality` makes. Leaving
 * it out is what left "Web + Mobile" projects with no files at all.
 */
const TEMPLATE_BY_MODALITY: Record<string, string> = {
  designer: 'vanilla',
  mobile: 'mobile',
  webmobile: 'mobile',
};

/**
 * The scaffold for a project's MODALITY (or explicit template), ignoring whether
 * a repo is linked. This is the "what should a runnable Mobile/Designer project
 * contain" answer; the repo-link decision belongs to the callers below.
 */
export function scaffoldForProject(project: SeedableProject): Record<string, string> | null {
  const explicit = project.template ? TEMPLATES[project.template] : undefined;
  if (explicit) return explicit;
  const key = TEMPLATE_BY_MODALITY[project.modality ?? 'designer'];
  return (key && TEMPLATES[key]) || null;
}

/**
 * The starter template this project should be seeded with on creation, or null
 * when it should be left alone.
 *
 * An explicit `template` wins. Otherwise the modality decides: Designer gets the
 * vanilla Vite app, Mobile gets the React Native scaffold, and the generative
 * modalities (video/evermind/finetune/voice) get nothing because they never run
 * the Vite app.
 *
 * Repo-connected projects are skipped HERE — a project the user pointed at an
 * existing repo shouldn't have a Vite scaffold sprayed over it on creation. This
 * is NOT the same as "never seed": {@link ensureRunnableScaffold} still fills a
 * repo-linked project's missing scaffold when its workspace comes up empty (e.g.
 * a freshly auto-created backing repo that only has a README), so a project is
 * never left unrunnable — that gap is exactly what wiped Mobile workspaces.
 *
 * An UNRECOGNISED `template` falls through to the modality instead of returning
 * null. A stale id (from a retired starter set, or one an older create path
 * wrote) used to mean "seed nothing", which left the workspace permanently empty.
 */
export function templateForProject(project: SeedableProject): Record<string, string> | null {
  const explicit = project.template ? TEMPLATES[project.template] : undefined;
  if (explicit) return explicit;
  const hasRepo = !!(project.sourceControlRepoFullName || project.githubRepoUrl);
  if (hasRepo) return null;
  return scaffoldForProject(project);
}

/** Files belonging to any known template, used by the project-less gates below. */
const ALL_TEMPLATE_PATHS = new Set(Object.values(TEMPLATES).flatMap((t) => Object.keys(t)));

/**
 * The project's IDE workspace looks FULLY unseeded when NO template file is
 * present with content — i.e. it is freshly-created (no objects) or legacy (the
 * template paths exist but are empty). Used to decide whether to import a linked
 * repo's files (only worthwhile for a brand-new/empty workspace).
 */
export function templateLooksUnseeded(objects: TemplateObject[]): boolean {
  return !objects.some((o) => o.size > 0 && ALL_TEMPLATE_PATHS.has(o.path));
}

/**
 * Whether NO known template is fully present, so the workspace MIGHT need
 * seeding. A partially-seeded project (e.g. `package.json` has content but
 * `src/main.jsx` is a 0-byte placeholder) must still get its empty files healed,
 * or they open BLANK in the editor — `templateLooksUnseeded` (all-empty) is the
 * strict subset that misses exactly this case, which is why backfill keys off
 * this instead.
 *
 * This is deliberately a cheap, project-less SUPERSET check: it runs on every
 * file-list, before the project lookup, so a healthy workspace pays nothing. It
 * must therefore clear a complete workspace of ANY template — checking only the
 * vanilla paths would flag every healthy Mobile project as needing backfill and
 * charge it a project lookup on every request. The precise per-modality decision
 * belongs to `ensureProjectTemplate`, which knows the project.
 */
export function templateNeedsBackfill(objects: TemplateObject[]): boolean {
  const sizeByPath = new Map(objects.map((o) => [o.path, o.size]));
  const isComplete = (template: Record<string, string>) =>
    Object.keys(template).every((path) => (sizeByPath.get(path) ?? 0) > 0);
  return !Object.values(TEMPLATES).some(isComplete);
}

/** Write the template files that are missing or empty. Returns count written. */
async function writeMissingTemplateFiles(
  storage: R2Bucket,
  projectId: number,
  template: Record<string, string>,
  existing: TemplateObject[],
): Promise<number> {
  const prefix = `${IDE_PREFIX}projects/${projectId}/`;
  const sizeByPath = new Map(existing.map((o) => [o.path, o.size]));
  const toWrite = Object.entries(template).filter(([path]) => {
    const size = sizeByPath.get(path);
    return size === undefined || size === 0;
  });
  if (toWrite.length === 0) return 0;
  await Promise.all(toWrite.map(([path, content]) => storage.put(prefix + path, content)));
  return toWrite.length;
}

/**
 * Ensure the project's starter template exists. Self-contained: picks the
 * template for the project's modality, lists R2, and seeds only the files that
 * are missing or empty. Safe to call on creation AND lazily on open. Returns
 * files written.
 *
 * Callers on a hot read path (file-list) that have ALREADY listed the prefix
 * should pass `preListed` to avoid a redundant R2 list.
 */
export async function ensureProjectTemplate(
  storage: R2Bucket | undefined,
  project: SeedableProject,
  preListed?: TemplateObject[],
): Promise<number> {
  const template = storage ? templateForProject(project) : null;
  if (!storage || !template) return 0;
  let existing = preListed;
  if (!existing) {
    const prefix = `${IDE_PREFIX}projects/${project.id}/`;
    const listed = await storage.list({ prefix });
    existing = (listed.objects ?? []).map((o) => ({ path: o.key.replace(prefix, ''), size: o.size }));
  }
  // Backfill whenever a file of THIS project's template is missing or empty —
  // not only when the whole workspace is unseeded. This heals partial-empty
  // projects (the blank-editor bug) while `writeMissingTemplateFiles` still
  // never clobbers a file that already has content.
  return writeMissingTemplateFiles(storage, project.id, template, existing);
}

/**
 * Guarantee the project is RUNNABLE — seed the modality scaffold's missing/empty
 * files EVEN when a repo is linked. Unlike {@link ensureProjectTemplate} (which
 * deliberately leaves repo-linked projects to git), this exists for the one case
 * that wiped workspaces: a project bound to an effectively-empty backing repo
 * (auto-created with just a README, or a first push that found R2 empty and
 * bailed). It only fires when the workspace has NO real `package.json`, so a
 * genuine imported repo — which brings its own package.json — is never touched,
 * and `writeMissingTemplateFiles` never overwrites a file that has content.
 *
 * Returns files written (0 when the workspace already has a real package.json or
 * the modality has no scaffold).
 */
export async function ensureRunnableScaffold(
  storage: R2Bucket | undefined,
  project: SeedableProject,
  preListed?: TemplateObject[],
): Promise<number> {
  const template = storage ? scaffoldForProject(project) : null;
  if (!storage || !template) return 0;
  let existing = preListed;
  if (!existing) {
    const prefix = `${IDE_PREFIX}projects/${project.id}/`;
    const listed = await storage.list({ prefix });
    existing = (listed.objects ?? []).map((o) => ({ path: o.key.replace(prefix, ''), size: o.size }));
  }
  // A real, non-empty package.json means real code lives here (seeded scaffold OR
  // an imported repo) — leave it alone. Only a workspace WITHOUT one is the
  // "bare/empty backing repo" case this heals.
  const hasRealPackageJson = existing.some((o) => o.path === 'package.json' && o.size > 0);
  if (hasRealPackageJson) return 0;
  return writeMissingTemplateFiles(storage, project.id, template, existing);
}
