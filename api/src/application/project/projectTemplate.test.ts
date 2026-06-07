import { describe, it, expect } from 'vitest';
import {
  VANILLA_TEMPLATE,
  projectWantsVanilla,
  templateLooksUnseeded,
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

  it('never overwrites a project that is in use', async () => {
    const r2 = fakeStorage({ [prefix + 'package.json']: '{ "name": "user-edited" }' });
    const written = await ensureProjectTemplate(r2 as unknown as R2Bucket, base);
    expect(written).toBe(0);
    expect(r2.store.get(prefix + 'package.json')).toBe('{ "name": "user-edited" }');
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
