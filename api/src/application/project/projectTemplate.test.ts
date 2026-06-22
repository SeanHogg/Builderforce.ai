import { describe, it, expect } from 'vitest';
import {
  VANILLA_TEMPLATE,
  projectWantsVanilla,
  templateLooksUnseeded,
  templateNeedsBackfill,
  ensureProjectTemplate,
  type SeedableProject,
  type TemplateObject,
} from './projectTemplate';

const base: SeedableProject = {
  id: 1,
  template: null,
  modality: 'designer',
  sourceControlRepoFullName: null,
  githubRepoUrl: null,
};

describe('projectWantsVanilla', () => {
  it('seeds an explicit vanilla template regardless of modality/repo', () => {
    expect(projectWantsVanilla({ ...base, template: 'vanilla', modality: 'video' })).toBe(true);
  });

  it('seeds a default designer project with no repo and no template', () => {
    expect(projectWantsVanilla(base)).toBe(true);
  });

  it('defaults a null modality to designer (and seeds)', () => {
    expect(projectWantsVanilla({ ...base, modality: null })).toBe(true);
  });

  it('skips repo-connected projects (files live in the git repo, not R2)', () => {
    expect(projectWantsVanilla({ ...base, sourceControlRepoFullName: 'acme/app' })).toBe(false);
    expect(projectWantsVanilla({ ...base, githubRepoUrl: 'https://github.com/acme/app' })).toBe(false);
  });

  it('skips non-designer modalities that do not run the Vite app', () => {
    expect(projectWantsVanilla({ ...base, modality: 'video' })).toBe(false);
    expect(projectWantsVanilla({ ...base, modality: 'llm' })).toBe(false);
  });
});

describe('templateLooksUnseeded', () => {
  it('is true when there are no objects at all', () => {
    expect(templateLooksUnseeded([])).toBe(true);
  });

  it('is true when template files exist but are all empty (legacy projects)', () => {
    const empties: TemplateObject[] = Object.keys(VANILLA_TEMPLATE).map((path) => ({ path, size: 0 }));
    expect(templateLooksUnseeded(empties)).toBe(true);
  });

  it('is false once any template file has content (project in use)', () => {
    expect(templateLooksUnseeded([{ path: 'package.json', size: 42 }])).toBe(false);
  });

  it('ignores non-template files when judging unseeded', () => {
    expect(templateLooksUnseeded([{ path: 'notes.md', size: 999 }])).toBe(true);
  });
});

describe('templateNeedsBackfill', () => {
  it('is true when there are no objects at all', () => {
    expect(templateNeedsBackfill([])).toBe(true);
  });

  it('is true for a PARTIALLY-empty project (the blank-editor bug)', () => {
    // package.json has content, but the source files are 0-byte placeholders.
    // templateLooksUnseeded would call this "in use" and skip healing — leaving
    // the empty files blank. templateNeedsBackfill must catch it.
    const objects: TemplateObject[] = [
      { path: 'package.json', size: 200 },
      { path: 'index.html', size: 0 },
      { path: 'src/main.jsx', size: 0 },
      { path: 'src/index.css', size: 0 },
      { path: 'vite.config.js', size: 0 },
    ];
    expect(templateLooksUnseeded(objects)).toBe(false); // old gate misses it
    expect(templateNeedsBackfill(objects)).toBe(true); // new gate catches it
  });

  it('is true when a required file is entirely missing', () => {
    const objects: TemplateObject[] = Object.keys(VANILLA_TEMPLATE)
      .filter((p) => p !== 'vite.config.js')
      .map((path) => ({ path, size: 100 }));
    expect(templateNeedsBackfill(objects)).toBe(true);
  });

  it('is false once every required file has content (healthy project pays nothing)', () => {
    const objects: TemplateObject[] = Object.keys(VANILLA_TEMPLATE).map((path) => ({ path, size: 100 }));
    expect(templateNeedsBackfill(objects)).toBe(false);
  });
});

/** Minimal in-memory R2 stand-in covering the surface ensureProjectTemplate uses. */
function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    async put(key: string, value: string) { store.set(key, value); },
    async list({ prefix }: { prefix: string }) {
      return {
        objects: [...store.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([key, v]) => ({ key, size: v.length })),
      };
    },
  };
}

describe('ensureProjectTemplate', () => {
  const prefix = 'ide/projects/1/';

  it('seeds every template file for a fresh designer project', async () => {
    const r2 = fakeStorage();
    const written = await ensureProjectTemplate(r2 as unknown as R2Bucket, base);
    expect(written).toBe(Object.keys(VANILLA_TEMPLATE).length);
    expect(r2.store.get(prefix + 'package.json')).toContain('"my-app"');
  });

  it('backfills only the empty/missing files on a legacy project', async () => {
    // package.json already has real content; the rest are empty placeholders.
    const r2 = fakeStorage({
      [prefix + 'package.json']: '', // empty → should be filled
      [prefix + 'src/main.jsx']: '', // empty → should be filled
    });
    // All present template files are empty → still looks unseeded → backfill all.
    const written = await ensureProjectTemplate(r2 as unknown as R2Bucket, base);
    expect(written).toBe(Object.keys(VANILLA_TEMPLATE).length);
    expect(r2.store.get(prefix + 'vite.config.js')).toContain('defineConfig');
  });

  it('backfills missing files but NEVER overwrites a file that has content', async () => {
    // Partial-empty project: package.json is user-edited (has content), the rest
    // are missing. Must heal the 4 missing files WITHOUT touching package.json.
    const r2 = fakeStorage({ [prefix + 'package.json']: '{ "name": "user-edited" }' });
    const written = await ensureProjectTemplate(r2 as unknown as R2Bucket, base);
    expect(written).toBe(Object.keys(VANILLA_TEMPLATE).length - 1); // all but package.json
    expect(r2.store.get(prefix + 'package.json')).toBe('{ "name": "user-edited" }'); // untouched
    expect(r2.store.get(prefix + 'src/main.jsx')).toContain('Hello World');
    expect(r2.store.get(prefix + 'vite.config.js')).toContain('defineConfig');
  });

  it('does nothing once every required file already has content', async () => {
    const seeded = Object.fromEntries(
      Object.entries(VANILLA_TEMPLATE).map(([path, content]) => [prefix + path, content]),
    );
    const r2 = fakeStorage(seeded);
    const written = await ensureProjectTemplate(r2 as unknown as R2Bucket, base);
    expect(written).toBe(0);
  });

  it('does nothing for a project that does not want the vanilla template', async () => {
    const r2 = fakeStorage();
    const written = await ensureProjectTemplate(r2 as unknown as R2Bucket, { ...base, modality: 'video' });
    expect(written).toBe(0);
    expect(r2.store.size).toBe(0);
  });

  it('uses preListed objects without a redundant list call', async () => {
    const r2 = fakeStorage();
    let listCalls = 0;
    const wrapped = {
      ...r2,
      async list(args: { prefix: string }) { listCalls++; return r2.list(args); },
    };
    await ensureProjectTemplate(wrapped as unknown as R2Bucket, base, []);
    expect(listCalls).toBe(0); // preListed [] provided → no internal list
  });
});
