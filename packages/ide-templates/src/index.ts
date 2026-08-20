/**
 * The IDE starter scaffolds — ONE definition, two runtimes.
 *
 * ── WHY THIS IS A PACKAGE ────────────────────────────────────────────────────────
 * The same files are needed in two places that cannot import each other's source:
 * the API (a Cloudflare Worker) SEEDS them into R2 at project creation, and the
 * frontend (a Next app) mounts them as the fallback the WebContainer runs when a
 * workspace file is missing or empty.
 *
 * They used to be two byte-identical copies held together by a parity test. That is
 * a guard, not a fix, and it only worked for the files it compared: the two DID
 * drift on the part the test could not see — the frontend knew about the `webmobile`
 * modality and the API's registry did not — and "Web + Mobile" projects shipped with
 * no files at all.
 *
 * Source-only, aliased straight at `src/index.ts` by both consumers, exactly like
 * `@builderforce/creation-canvas-contract` (which the Worker and the Next app have
 * shared in production for some time — so this is a proven wiring, not a new risk to
 * the deploy path).
 *
 * These are generated PROJECT source files (the user's app), not product UI, so they
 * are deliberately not localized.
 */

/** Default files for new (vanilla) projects. Must match the Run-flow defaults in
 *  `BuilderWorkspace.tsx` (the component `IDENew.tsx` became when the standalone
 *  IDE destination was folded into the canvas) so seeded projects run identically
 *  to the run-only fallback. */
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
  screen: { flex: 1, backgroundColor: '#050810' },
  header: { paddingTop: 64, paddingHorizontal: 24, paddingBottom: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#f0f4ff' },
  subtitle: { fontSize: 14, color: '#8892b0', marginTop: 4 },
  content: { padding: 24 },
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  cardLabel: { fontSize: 14, color: '#8892b0' },
  counter: { fontSize: 48, fontWeight: '700', color: '#f0f4ff', marginVertical: 8 },
  button: {
    backgroundColor: '#4d9eff',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonPressed: { opacity: 0.75 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});`,
  'vite.config.js': MOBILE_VITE_CONFIG,
};

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
export const TEMPLATE_BY_MODALITY: Record<string, string> = {
  designer: 'vanilla',
  mobile: 'mobile',
  webmobile: 'mobile',
};

/**
 * The scaffold a MODALITY runs, or null when that modality never runs the Vite app
 * (the generative ones — video / evermind / finetune / voice).
 *
 * Both runtimes ask this ONE function now. Previously each made the call itself —
 * the API through `TEMPLATE_BY_MODALITY`, the frontend through `defaultsForModality`
 * — and a modality added to one map and not the other is precisely how `webmobile`
 * came to be seeded with nothing.
 */
export function templateForModality(modality: string | null | undefined): Record<string, string> | null {
  const key = TEMPLATE_BY_MODALITY[modality ?? 'designer'];
  return (key && TEMPLATES[key]) || null;
}
