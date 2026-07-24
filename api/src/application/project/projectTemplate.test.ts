import { describe, it, expect } from 'vitest';
import {
  VANILLA_TEMPLATE,
  MOBILE_TEMPLATE,
  templateForProject,
  scaffoldForProject,
  templateLooksUnseeded,
  templateNeedsBackfill,
  ensureProjectTemplate,
  ensureRunnableScaffold,
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

describe('templateForProject', () => {
  it('honours an explicit template regardless of modality/repo', () => {
    expect(templateForProject({ ...base, template: 'vanilla', modality: 'video' })).toBe(VANILLA_TEMPLATE);
    expect(templateForProject({ ...base, template: 'mobile', modality: 'designer' })).toBe(MOBILE_TEMPLATE);
  });

  // A stale/unknown template id used to mean "seed nothing", which left the
  // workspace permanently empty — and since this same function gates the lazy
  // self-heal on file-list, no later open could repair it either. It must fall
  // through to the modality instead.
  it('falls back to the modality when the explicit template is unknown', () => {
    expect(templateForProject({ ...base, template: 'nope' })).toBe(VANILLA_TEMPLATE);
    expect(templateForProject({ ...base, template: 'nope', modality: 'mobile' })).toBe(MOBILE_TEMPLATE);
  });

  it('still seeds nothing for a modality that never runs the Vite app', () => {
    expect(templateForProject({ ...base, template: 'nope', modality: 'video' })).toBeNull();
  });

  // Web + Mobile is one react-native-web codebase rendered both full-width and
  // in the phone simulator, so it takes the mobile scaffold. Missing from the
  // registry, it seeded nothing at all.
  it('gives a Web + Mobile project the React Native scaffold', () => {
    expect(templateForProject({ ...base, modality: 'webmobile' })).toBe(MOBILE_TEMPLATE);
  });

  it('seeds a default designer project with no repo and no template', () => {
    expect(templateForProject(base)).toBe(VANILLA_TEMPLATE);
  });

  it('defaults a null modality to designer (and seeds)', () => {
    expect(templateForProject({ ...base, modality: null })).toBe(VANILLA_TEMPLATE);
  });

  // The React Native scaffold, not the vanilla Vite app — seeding a mobile
  // project with src/main.jsx would leave it unable to run.
  it('gives a mobile project the React Native scaffold', () => {
    const template = templateForProject({ ...base, modality: 'mobile' });
    expect(template).toBe(MOBILE_TEMPLATE);
    expect(Object.keys(template!)).toContain('App.js');
    expect(Object.keys(template!)).not.toContain('src/main.jsx');
  });

  it('skips repo-connected projects (files live in the git repo, not R2)', () => {
    expect(templateForProject({ ...base, sourceControlRepoFullName: 'acme/app' })).toBeNull();
    expect(templateForProject({ ...base, githubRepoUrl: 'https://github.com/acme/app' })).toBeNull();
  });

  it('skips modalities that do not run the Vite app', () => {
    expect(templateForProject({ ...base, modality: 'video' })).toBeNull();
    expect(templateForProject({ ...base, modality: 'llm' })).toBeNull();
    expect(templateForProject({ ...base, modality: 'voice' })).toBeNull();
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

  // This gate runs on EVERY file-list, before the project is loaded, so it can't
  // know the modality. If it only cleared vanilla workspaces, every healthy
  // Mobile project would be flagged on every request and pay a project lookup
  // forever. A complete workspace of ANY template has to clear it.
  it('is false for a complete mobile workspace (no vanilla files present)', () => {
    const objects: TemplateObject[] = Object.keys(MOBILE_TEMPLATE).map((path) => ({ path, size: 100 }));
    expect(objects.some((o) => o.path === 'src/main.jsx')).toBe(false);
    expect(templateNeedsBackfill(objects)).toBe(false);
  });

  it('is true for a partially-empty mobile workspace', () => {
    const objects: TemplateObject[] = Object.keys(MOBILE_TEMPLATE).map((path) => ({
      path,
      size: path === 'App.js' ? 0 : 100,
    }));
    expect(templateNeedsBackfill(objects)).toBe(true);
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

  it('seeds the React Native scaffold for a fresh mobile project', async () => {
    const r2 = fakeStorage();
    const written = await ensureProjectTemplate(r2 as unknown as R2Bucket, { ...base, modality: 'mobile' });
    expect(written).toBe(Object.keys(MOBILE_TEMPLATE).length);
    expect(r2.store.get(prefix + 'App.js')).toContain("from 'react-native'");
    expect(r2.store.get(prefix + 'vite.config.js')).toContain('react-native-web');
    // The vanilla entry point must NOT be written into a mobile workspace.
    expect(r2.store.has(prefix + 'src/main.jsx')).toBe(false);
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

describe('scaffoldForProject (ignores repo-link)', () => {
  it('returns the modality scaffold even for a repo-connected project', () => {
    // This is the difference from templateForProject: a repo-linked mobile project
    // still HAS a runnable scaffold; whether to seed it is the caller's call.
    expect(scaffoldForProject({ ...base, modality: 'mobile', githubRepoUrl: 'https://github.com/acme/app' }))
      .toBe(MOBILE_TEMPLATE);
  });

  it('is null for a modality with no scaffold', () => {
    expect(scaffoldForProject({ ...base, modality: 'video' })).toBeNull();
  });
});

describe('ensureRunnableScaffold (heals a bare/empty backing repo)', () => {
  const prefix = 'ide/projects/1/';
  const repoLinked: SeedableProject = { ...base, modality: 'mobile', githubRepoUrl: 'https://github.com/acme/app' };

  // THE WIPE: a project bound to an auto-created repo that only has a README
  // imports that near-empty tree, and because seeding is skipped for repo-linked
  // projects it is left with nothing runnable. ensureRunnableScaffold must fill it.
  it('seeds the scaffold into a repo-linked project that came up README-only', async () => {
    const r2 = fakeStorage({ [prefix + 'README.md']: '# my-mobile-app' });
    const written = await ensureRunnableScaffold(r2 as unknown as R2Bucket, repoLinked);
    expect(written).toBe(Object.keys(MOBILE_TEMPLATE).length);
    expect(r2.store.get(prefix + 'App.js')).toContain("from 'react-native'");
    expect(r2.store.get(prefix + 'README.md')).toBe('# my-mobile-app'); // untouched
  });

  it('seeds a totally empty repo-linked workspace', async () => {
    const r2 = fakeStorage();
    const written = await ensureRunnableScaffold(r2 as unknown as R2Bucket, repoLinked);
    expect(written).toBe(Object.keys(MOBILE_TEMPLATE).length);
  });

  // A genuine imported repo brings its own package.json — never inject a scaffold
  // over real code.
  it('does NOTHING when the workspace already has a real package.json', async () => {
    const r2 = fakeStorage({
      [prefix + 'package.json']: '{ "name": "real-nextjs-app" }',
      [prefix + 'next.config.js']: 'module.exports = {}',
    });
    const written = await ensureRunnableScaffold(r2 as unknown as R2Bucket, repoLinked);
    expect(written).toBe(0);
    expect(r2.store.get(prefix + 'package.json')).toBe('{ "name": "real-nextjs-app" }');
    expect(r2.store.has(prefix + 'App.js')).toBe(false);
  });

  it('is a no-op for a modality with no scaffold (video/voice/etc)', async () => {
    const r2 = fakeStorage();
    const written = await ensureRunnableScaffold(r2 as unknown as R2Bucket, { ...base, modality: 'video', githubRepoUrl: 'https://github.com/acme/x' });
    expect(written).toBe(0);
  });
});
