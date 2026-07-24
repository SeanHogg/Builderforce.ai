import { describe, it, expect } from 'vitest';
import { repairScaffold } from './scaffoldRepair';
import { MOBILE_DEFAULTS, VANILLA_DEFAULTS } from './vanillaDefaults';

/**
 * These tests pin the exact failures seen in the live Mobile project:
 *   - package.json restored (terminal: "package.json was corrupt — restored")
 *   - vite.config.js's source rendered as the preview (it was written into index.html)
 * plus the empty-file and cross-wire variants, and the guarantee that a real,
 * edited app is NEVER clobbered.
 */
describe('repairScaffold', () => {
  const clean = (modality: string) =>
    ({ ...(modality === 'mobile' ? MOBILE_DEFAULTS : VANILLA_DEFAULTS) });

  it('leaves a clean mobile scaffold completely untouched', () => {
    const files = clean('mobile');
    const { repaired, restored } = repairScaffold(files, 'mobile');
    expect(restored).toEqual([]);
    expect(repaired).toEqual(files);
  });

  it('leaves a clean vanilla scaffold untouched', () => {
    const files = clean('designer');
    const { restored } = repairScaffold(files, 'designer');
    expect(restored).toEqual([]);
  });

  it('fills empty scaffold files (fresh/unseeded workspace)', () => {
    const files: Record<string, string> = {
      'package.json': '',
      'index.html': '   ',
      'index.js': '',
      'App.js': '',
      'vite.config.js': '',
    };
    const { repaired, restored } = repairScaffold(files, 'mobile');
    expect(restored.map((r) => r.path).sort()).toEqual(
      Object.keys(MOBILE_DEFAULTS).sort(),
    );
    expect(restored.every((r) => r.reason === 'empty')).toBe(true);
    expect(repaired['App.js']).toContain("from 'react-native'");
    expect(repaired['vite.config.js']).toContain('react-native-web');
  });

  // The terminal's "package.json was corrupt — restored" case.
  it('restores package.json when it holds another file’s (non-JSON) content', () => {
    const files = { ...MOBILE_DEFAULTS, 'package.json': "import { defineConfig } from 'vite';" };
    const { repaired, restored } = repairScaffold(files, 'mobile');
    expect(restored).toEqual([{ path: 'package.json', reason: 'corrupt' }]);
    expect(JSON.parse(repaired['package.json']!).name).toBe('my-mobile-app');
  });

  // The screenshot bug: vite.config.js's source written into index.html →
  // the browser renders raw source. repairScaffold must restore index.html.
  it('restores index.html when it holds JS/config source (the blank-preview bug)', () => {
    const files = { ...MOBILE_DEFAULTS, 'index.html': MOBILE_DEFAULTS['vite.config.js']! };
    const { repaired, restored } = repairScaffold(files, 'mobile');
    expect(restored).toEqual([{ path: 'index.html', reason: 'corrupt' }]);
    expect(repaired['index.html']).toContain('<!DOCTYPE html>');
    expect(repaired['index.html']).toContain('id="root"');
  });

  // vite.config.js holding package.json's JSON — the earlier "Expected ; but found :" crash.
  it('restores vite.config.js when it holds package.json JSON', () => {
    const files = { ...MOBILE_DEFAULTS, 'vite.config.js': MOBILE_DEFAULTS['package.json']! };
    const { repaired, restored } = repairScaffold(files, 'mobile');
    expect(restored).toEqual([{ path: 'vite.config.js', reason: 'corrupt' }]);
    expect(repaired['vite.config.js']).toContain('defineConfig');
  });

  it('repairs several cross-wired files at once', () => {
    const files = {
      ...MOBILE_DEFAULTS,
      'package.json': "import x from 'y';",           // JS in package.json
      'index.html': MOBILE_DEFAULTS['index.js']!,      // JS in index.html
      'index.js': '',                                  // empty
    };
    const { repaired, restored } = repairScaffold(files, 'mobile');
    expect(restored.map((r) => r.path).sort()).toEqual(['index.html', 'index.js', 'package.json']);
    expect(JSON.parse(repaired['package.json']!).name).toBe('my-mobile-app');
    expect(repaired['index.html']).toContain('<!DOCTYPE html>');
    expect(repaired['index.js']).toContain('createRoot');
  });

  it('NEVER clobbers a real, edited app (valid content for each path)', () => {
    const edited = {
      'package.json': JSON.stringify({ name: 'my-mobile-app', version: '2.0.0', dependencies: {} }, null, 2),
      'index.html': '<!DOCTYPE html><html><head><title>Mine</title></head><body><div id="root"></div><script type="module" src="/index.js"></script></body></html>',
      'index.js': "import { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root'));",
      'App.js': "import { View } from 'react-native';\nexport default function App(){ return <View/>; }",
      'vite.config.js': "import { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [] });",
    };
    const { repaired, restored } = repairScaffold(edited, 'mobile');
    expect(restored).toEqual([]);
    expect(repaired).toEqual(edited);
  });

  it('passes through the user’s own extra files untouched', () => {
    const files = {
      ...MOBILE_DEFAULTS,
      'src/screens/Home.js': "import { View } from 'react-native';\nexport default () => <View/>;",
      'assets/logo.svg': '<svg></svg>',
    };
    const { repaired, restored } = repairScaffold(files, 'mobile');
    expect(restored).toEqual([]);
    expect(repaired['src/screens/Home.js']).toBe(files['src/screens/Home.js']);
    expect(repaired['assets/logo.svg']).toBe(files['assets/logo.svg']);
  });

  it('adds missing scaffold files that are absent from the map entirely', () => {
    // Only package.json present (with content); the other 4 are missing keys.
    const files = { 'package.json': MOBILE_DEFAULTS['package.json']! };
    const { repaired, restored } = repairScaffold(files, 'mobile');
    expect(restored.map((r) => r.path).sort()).toEqual(['App.js', 'index.html', 'index.js', 'vite.config.js']);
    expect(restored.every((r) => r.reason === 'empty')).toBe(true);
    expect(Object.keys(repaired).sort()).toEqual(Object.keys(MOBILE_DEFAULTS).sort());
  });

  it('uses the mobile scaffold for webmobile projects', () => {
    const { repaired } = repairScaffold({}, 'webmobile');
    expect(repaired['App.js']).toContain("from 'react-native'");
    expect(repaired['vite.config.js']).toContain('react-native-web');
  });
});
