import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getComponent } from '@/lib/components/registry';

/**
 * THE SEAM TEST: every widget id the SERVER can name must resolve in THIS registry.
 *
 * The widget registry is a registry of React components, so it can only live in
 * the frontend. But the server decides which cards a composed answer shows and
 * which cards a dashboard preset is made of, which means it holds a list of
 * frontend ids as plain strings — on the far side of a network boundary, where
 * nothing typechecks them together.
 *
 * The failure that arrangement produces is silent. Rename or delete a widget here
 * and the server keeps returning the old id; `WidgetGrid` skips ids it cannot
 * resolve (deliberately — a stale pin must not break a dashboard), so the answer
 * simply comes back one chart short. No error, no warning, nothing in a log.
 *
 * So the test lives HERE, where the person doing the renaming is looking, and it
 * reads the SERVER's declaration directly rather than a copy of it — a copy would
 * be one more thing to keep in sync, which is the entire problem.
 */

/**
 * Locate the sibling API package by walking up from the working directory.
 *
 * Not `import.meta.url`: under the jsdom environment that is an `http://` URL, and
 * `fileURLToPath` rejects it. Walking up from `process.cwd()` works from the
 * frontend root and from the repo root alike, which is both places this suite is
 * launched from.
 */
const API_DIR = (() => {
  for (let dir = process.cwd(), prev = ''; dir !== prev; prev = dir, dir = dirname(dir)) {
    const candidate = resolve(dir, 'api/src/application/dashboards');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('could not locate api/src/application/dashboards from ' + process.cwd());
})();

function read(file: string): string {
  return readFileSync(resolve(API_DIR, file), 'utf8');
}

/** Pull the string literals out of `export const COMPOSABLE_WIDGET_IDS = [ … ] as const;`. */
function declaredWidgetIds(): string[] {
  const source = read('widgetIds.ts');
  const block = source.match(/export const COMPOSABLE_WIDGET_IDS = \[([\s\S]*?)\] as const;/);
  // A parse failure must FAIL, never silently assert over an empty list: an empty
  // list passes every assertion below and proves nothing.
  expect(block, 'COMPOSABLE_WIDGET_IDS not found in api/src/application/dashboards/widgetIds.ts').not.toBeNull();
  const ids = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  expect(ids.length).toBeGreaterThan(0);
  return ids;
}

/** Pull every `widgetKey: '…'` out of the preset table. */
function presetWidgetKeys(): string[] {
  const source = read('dashboardPresets.ts');
  const table = source.match(/export const DASHBOARD_PRESETS = \{([\s\S]*?)\n\} satisfies/);
  expect(table, 'DASHBOARD_PRESETS not found in api/src/application/dashboards/dashboardPresets.ts').not.toBeNull();
  const keys = [...table![1].matchAll(/widgetKey: '([^']+)'/g)].map((m) => m[1]);
  expect(keys.length).toBeGreaterThan(0);
  return keys;
}

describe('server-declared widget ids', () => {
  it('every id the server can return resolves in the widget registry', () => {
    for (const id of declaredWidgetIds()) {
      expect(getComponent(id), `COMPOSABLE_WIDGET_IDS names '${id}', which no widget module registers`).toBeDefined();
    }
  });

  it('every widget the Executive preset materialises resolves too', () => {
    // A preset tile whose id does not resolve becomes a saved `dashboard_widgets`
    // ROW that renders nothing — worse than a missing chart, because it persists.
    for (const id of presetWidgetKeys()) {
      expect(getComponent(id), `the Executive preset names '${id}', which no widget module registers`).toBeDefined();
    }
  });

  it('confines the preset to ids the composable list already covers', () => {
    // One list to keep honest, not two.
    const declared = new Set(declaredWidgetIds());
    for (const id of presetWidgetKeys()) expect(declared.has(id), id).toBe(true);
  });

  it('declares no id twice', () => {
    const ids = declaredWidgetIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes the workforce-health card the Ask box answers with', () => {
    // The one widget this pass ADDED — asserted by id so deleting the module
    // fails here rather than emptying the workforce.health answer.
    expect(declaredWidgetIds()).toContain('workforce.health');
    expect(getComponent('workforce.health')).toBeDefined();
  });
});
