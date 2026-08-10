import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The linked local packages (`link:../../packages/brain-ui`, …) are installed
 * SEPARATELY — pnpm symlinks the directory and installs nothing inside it. When a
 * linked package has no `node_modules`, every bare import in its shipped `dist`
 * (`react`, `@seanhogg/builderforce-brain-embedded`) is unresolvable FROM THERE,
 * and because `skipLibCheck` swallows the unresolved import inside its `.d.ts`,
 * the only symptom is our own source failing to type-check against members that
 * plainly exist. That shape only occurs on a clean checkout — i.e. only in CI.
 *
 * `scripts/ensure-linked-deps.mjs` (wired as `postinstall`) restores it. This test
 * is the ratchet: it fails loudly in the environment the type-checker fails
 * silently in.
 */
const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(here, '..');

function manifest(dir: string): { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

function linkedTargets(dir: string): string[] {
  const { dependencies, devDependencies } = manifest(dir);
  return Object.values({ ...dependencies, ...devDependencies })
    .filter((spec) => spec.startsWith('link:'))
    .map((spec) => resolve(dir, spec.slice('link:'.length)))
    // A package with no manifest is not installable at all — see the separate
    // assertion below, which holds every linked target to having one.
    .filter((target) => existsSync(join(target, 'package.json')));
}

describe('linked local packages', () => {
  const targets = linkedTargets(clientRoot);

  it('declares no link: dependency that has no package to install', () => {
    const { dependencies, devDependencies } = manifest(clientRoot);
    const declared = Object.values({ ...dependencies, ...devDependencies })
      .filter((spec) => spec.startsWith('link:'))
      .map((spec) => resolve(clientRoot, spec.slice('link:'.length)));
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((target) => !existsSync(join(target, 'package.json')))).toEqual([]);
  });

  it.each(targets)('%s can resolve its own dependencies', (target) => {
    const { dependencies, devDependencies } = manifest(target);
    const required = Object.keys({ ...dependencies, ...devDependencies });
    const missing = required.filter((name) => !existsSync(join(target, 'node_modules', name)));
    expect(missing, `run scripts/ensure-linked-deps.mjs — ${target} is missing ${missing.join(', ')}`).toEqual([]);
  });

  it('resolves the Brain core FROM inside the shared UI package, the way tsc and vite do', () => {
    const brainUi = targets.find((t) => t.endsWith(join('packages', 'brain-ui')));
    expect(brainUi).toBeDefined();
    const requireFromBrainUi = createRequire(join(brainUi as string, 'package.json'));
    expect(() => requireFromBrainUi.resolve('@seanhogg/builderforce-brain-embedded')).not.toThrow();
    expect(() => requireFromBrainUi.resolve('react')).not.toThrow();
  });
});
