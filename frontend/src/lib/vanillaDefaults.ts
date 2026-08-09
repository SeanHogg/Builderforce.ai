/**
 * Run-only fallback files for a missing/empty scaffold. Single source of truth
 * for both Run and the publish build (previously duplicated inline in each), and
 * matched to the server-side templates so a seeded project runs identically.
 *
 * This is generated PROJECT source code (the user's app files), not product UI —
 * it is intentionally not localized. Kept in a `.ts` module so it lives outside
 * the component's JSX.
 */
export const VANILLA_DEFAULTS: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'my-app',
    version: '1.0.0',
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
    devDependencies: { '@vitejs/plugin-react': '^4.0.0', vite: '^4.3.9' },
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
 * Mobile scaffold — a React Native app rendered through react-native-web.
 *
 * The IDE's preview is a browser iframe, so a Mobile project has to be runnable
 * on the web; but writing it against `react-native` primitives (rather than
 * divs) is what keeps it a real mobile app that ports to Expo unchanged. Vite
 * aliases `react-native` to `react-native-web`, so the SAME source that renders
 * in the device simulator here compiles for iOS and Android there.
 *
 * Must stay byte-identical to MOBILE_TEMPLATE in the api's
 * `application/project/projectTemplate.ts` — the two runtimes can't share a
 * module, so `vanillaDefaults.parity.test.ts` fails the build if they drift.
 */
export const MOBILE_DEFAULTS: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'my-mobile-app',
    version: '1.0.0',
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: {
      react: '^18.2.0',
      'react-dom': '^18.2.0',
      'react-native-web': '^0.19.10',
    },
    devDependencies: { '@vitejs/plugin-react': '^4.0.0', vite: '^4.3.9' },
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

/**
 * The run-only fallback files for a modality. Mobile — and the combined
 * Web + Mobile — projects need the React Native (react-native-web) scaffold so
 * ONE source renders as both a responsive website and a handset app; every other
 * modality that runs code uses the vanilla one.
 */
export function defaultsForModality(modality: string): Record<string, string> {
  return modality === 'mobile' || modality === 'webmobile' ? MOBILE_DEFAULTS : VANILLA_DEFAULTS;
}
