import { describe, it, expect } from 'vitest';
import {
  collapseBitbucketBuildStates,
  encodePathSegments,
  normalizeBitbucketPrState,
  parseBitbucketServerBrowse,
  resolveRepoApiTarget,
} from './repoApiTarget';

const cloud = { provider: 'bitbucket', host: 'bitbucket.org', owner: 'acme', repo: 'app' };
const server = { provider: 'bitbucket', host: 'bb.acme.internal', owner: 'ACME', repo: 'app' };

describe('resolveRepoApiTarget — the two Bitbucket editions are NOT path-compatible', () => {
  it('Cloud addresses a repo by workspace, Server by project key', () => {
    expect(resolveRepoApiTarget(cloud).repoBase)
      .toBe('https://api.bitbucket.org/2.0/repositories/acme/app');
    expect(resolveRepoApiTarget(server).repoBase)
      .toBe('https://bb.acme.internal/rest/api/1.0/projects/ACME/repos/app');
  });

  it('pull requests: /pullrequests (Cloud) vs /pull-requests (Server)', () => {
    expect(resolveRepoApiTarget(cloud).pullRequest(7))
      .toBe('https://api.bitbucket.org/2.0/repositories/acme/app/pullrequests/7');
    expect(resolveRepoApiTarget(server).pullRequest(7))
      .toBe('https://bb.acme.internal/rest/api/1.0/projects/ACME/repos/app/pull-requests/7');
  });

  it('file READ: Cloud puts the ref in the path, Server in an `at` query', () => {
    expect(resolveRepoApiTarget(cloud).fileContent('src/a b.ts', 'main'))
      .toBe('https://api.bitbucket.org/2.0/repositories/acme/app/src/main/src/a%20b.ts');
    // `/raw`, not `/browse` — browse returns paginated LINES, not bytes.
    expect(resolveRepoApiTarget(server).fileContent('src/a b.ts', 'main'))
      .toBe('https://bb.acme.internal/rest/api/1.0/projects/ACME/repos/app/raw/src/a%20b.ts?at=main');
  });

  it('file WRITE: Cloud posts the whole commit to /src, Server puts one file to /browse', () => {
    expect(resolveRepoApiTarget(cloud).fileWrite('docs/PRD.md'))
      .toBe('https://api.bitbucket.org/2.0/repositories/acme/app/src');
    expect(resolveRepoApiTarget(server).fileWrite('docs/PRD.md'))
      .toBe('https://bb.acme.internal/rest/api/1.0/projects/ACME/repos/app/browse/docs/PRD.md');
  });

  it('build status: Server uses its own plugin root, NOT /rest/api/1.0', () => {
    expect(resolveRepoApiTarget(server).buildStatus('deadbeef'))
      .toBe('https://bb.acme.internal/rest/build-status/1.0/commits/deadbeef');
    expect(resolveRepoApiTarget(cloud).buildStatus('deadbeef'))
      .toBe('https://api.bitbucket.org/2.0/repositories/acme/app/commit/deadbeef/statuses');
  });

  it('branch-utils exists only on Server; every other dialect refuses out loud', () => {
    expect(resolveRepoApiTarget(server).branchUtilsBase())
      .toBe('https://bb.acme.internal/rest/branch-utils/1.0/projects/ACME/repos/app');
    expect(() => resolveRepoApiTarget(cloud).branchUtilsBase()).toThrow(/Bitbucket Server/);
  });

  it('GitHub (cloud + Enterprise) and GitLab keep their own shapes', () => {
    const gh = resolveRepoApiTarget({ provider: 'github', host: null, owner: 'acme', repo: 'app' });
    expect(gh.repoBase).toBe('https://api.github.com/repos/acme/app');
    expect(gh.pullRequest(3)).toBe('https://api.github.com/repos/acme/app/pulls/3');

    const ghe = resolveRepoApiTarget({ provider: 'github', host: 'ghe.acme.com', owner: 'acme', repo: 'app' });
    expect(ghe.repoBase).toBe('https://ghe.acme.com/api/v3/repos/acme/app');

    const gl = resolveRepoApiTarget({ provider: 'gitlab', host: null, owner: 'acme', repo: 'app' });
    expect(gl.repoBase).toBe('https://gitlab.com/api/v4/projects/acme%2Fapp');
    expect(gl.pullRequest(3)).toBe('https://gitlab.com/api/v4/projects/acme%2Fapp/merge_requests/3');
  });

  it('still throws for a provider with no mapped REST dialect', () => {
    expect(() => resolveRepoApiTarget({ provider: 'gitea', host: null, owner: 'a', repo: 'b' }))
      .toThrow(/gitea/);
  });
});

describe('encodePathSegments', () => {
  it('preserves slashes (a ticket branch is builderforce/task-12)', () => {
    expect(encodePathSegments('builderforce/task-12')).toBe('builderforce/task-12');
  });
  it('still encodes everything else, per segment', () => {
    expect(encodePathSegments('src/a b/c#d.ts')).toBe('src/a%20b/c%23d.ts');
  });
});

describe('parseBitbucketServerBrowse — the line-pagination difference is normalised, not leaked', () => {
  it('rejoins a page of LINES into text (Server strips each trailing newline)', () => {
    const page = parseBitbucketServerBrowse({
      lines: [{ text: 'const a = 1;' }, { text: '' }, { text: 'export default a;' }],
      start: 0, size: 3, isLastPage: true,
    });
    expect(page.text).toBe('const a = 1;\n\nexport default a;');
    expect(page.children).toEqual([]);
    expect(page.isLastPage).toBe(true);
    expect(page.nextPageStart).toBeNull();
  });

  it('reports where the NEXT page starts when a file spans pages', () => {
    const page = parseBitbucketServerBrowse({
      lines: [{ text: 'line 1' }], isLastPage: false, nextPageStart: 1,
    });
    expect(page.text).toBe('line 1');
    expect(page.isLastPage).toBe(false);
    expect(page.nextPageStart).toBe(1);
  });

  it('never reports a next page once the envelope says last, even if the field lingers', () => {
    const page = parseBitbucketServerBrowse({ lines: [{ text: 'x' }], isLastPage: true, nextPageStart: 99 });
    expect(page.nextPageStart).toBeNull();
  });

  it('normalises the DIRECTORY shape to typed children (FILE/DIRECTORY are dropped case)', () => {
    const page = parseBitbucketServerBrowse({
      children: {
        values: [
          { path: { toString: 'src/index.ts' }, type: 'FILE' },
          { path: { toString: 'src/lib' }, type: 'DIRECTORY' },
          { path: { toString: 'vendored' }, type: 'SUBMODULE' },
        ],
        isLastPage: true,
      },
    });
    expect(page.text).toBeNull();
    expect(page.children).toEqual([
      { path: 'src/index.ts', type: 'file' },
      { path: 'src/lib', type: 'dir' },
    ]);
  });

  it('falls back to path components when Server omits `toString`', () => {
    const page = parseBitbucketServerBrowse({
      children: { values: [{ path: { components: ['src', 'a.ts'] }, type: 'FILE' }], isLastPage: true },
    });
    expect(page.children).toEqual([{ path: 'src/a.ts', type: 'file' }]);
  });

  it('a malformed or empty body is an empty LAST page, never a throw', () => {
    for (const body of [null, undefined, {}, { lines: 'nope' }]) {
      const page = parseBitbucketServerBrowse(body);
      expect(page).toEqual({ text: null, children: [], isLastPage: true, nextPageStart: null });
    }
  });
});

describe('Bitbucket response vocabulary (shared by both editions)', () => {
  it('maps PR states onto the product vocabulary', () => {
    expect(normalizeBitbucketPrState('OPEN')).toBe('open');
    expect(normalizeBitbucketPrState('MERGED')).toBe('merged');
    expect(normalizeBitbucketPrState('DECLINED')).toBe('closed');
    expect(normalizeBitbucketPrState(null)).toBeNull();
    expect(normalizeBitbucketPrState('SUPERSEDED')).toBe('SUPERSEDED');
  });

  it('collapses build states with failure winning, then in-progress', () => {
    expect(collapseBitbucketBuildStates([])).toBeNull();
    expect(collapseBitbucketBuildStates(['SUCCESSFUL'])).toBe('success');
    expect(collapseBitbucketBuildStates(['SUCCESSFUL', 'INPROGRESS'])).toBe('pending');
    expect(collapseBitbucketBuildStates(['SUCCESSFUL', 'INPROGRESS', 'FAILED'])).toBe('failure');
    // Cloud-only state that Server never sends — still a failure.
    expect(collapseBitbucketBuildStates(['ERROR'])).toBe('failure');
    expect(collapseBitbucketBuildStates(['STOPPED'])).toBeNull();
  });
});
