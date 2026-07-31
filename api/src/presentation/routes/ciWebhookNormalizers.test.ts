/**
 * GitLab / Bitbucket CI normalizers → RepoCiEvent. Pure; asserts that non-GitHub
 * providers populate the identifiers the auto-fix loop needs (so they are genuinely
 * eligible rather than silently skipped).
 */
import { describe, it, expect } from 'vitest';
import { gitlabNormalizeCiEvent } from './gitlabWebhookRoutes';
import { bitbucketNormalizeCiEvent } from './bitbucketWebhookRoutes';

describe('gitlabNormalizeCiEvent', () => {
  const payload = (attrs: Record<string, unknown>) => ({
    object_kind: 'pipeline',
    project: { web_url: 'https://gl/grp/app', path_with_namespace: 'grp/app' },
    object_attributes: attrs,
  });

  it('maps a failed pipeline on a ticket branch, carrying the pipeline id as runId', () => {
    const evt = gitlabNormalizeCiEvent(payload({ id: 4242, ref: 'builderforce/task-31', sha: 'deadbeef', status: 'failed' }));
    expect(evt).toEqual({
      eventType: 'pipeline', branch: 'builderforce/task-31', sha: 'deadbeef',
      outcome: 'failure', rawState: 'failed',
      targetUrl: 'https://gl/grp/app/-/pipelines/4242', runId: 4242,
    });
    // runId != null is what makes a PRE-MERGE failure auto-fix eligible.
    expect(evt?.runId).not.toBeNull();
  });

  it('prefers an explicit pipeline url when GitLab sends one', () => {
    const evt = gitlabNormalizeCiEvent(payload({ id: 1, ref: 'main', sha: 's', status: 'success', url: 'https://gl/p/1' }));
    expect(evt).toMatchObject({ outcome: 'success', targetUrl: 'https://gl/p/1' });
  });

  it('maps in-flight statuses to pending and non-verdicts to null', () => {
    expect(gitlabNormalizeCiEvent(payload({ id: 1, ref: 'main', status: 'running' }))?.outcome).toBe('pending');
    expect(gitlabNormalizeCiEvent(payload({ id: 1, ref: 'main', status: 'canceled' }))?.outcome).toBeNull();
    expect(gitlabNormalizeCiEvent(payload({ id: 1, ref: 'main', status: 'skipped' }))?.outcome).toBeNull();
  });

  it('returns null without object_attributes, and tolerates a missing id', () => {
    expect(gitlabNormalizeCiEvent({ object_kind: 'pipeline' })).toBeNull();
    const evt = gitlabNormalizeCiEvent(payload({ ref: 'main', status: 'failed' }));
    expect(evt).toMatchObject({ runId: null, targetUrl: null, outcome: 'failure' });
  });
});

describe('bitbucketNormalizeCiEvent', () => {
  const payload = (st: Record<string, unknown>) => ({ repository: { full_name: 'ws/app' }, commit_status: st });

  it('marks a terminal commit status authoritative despite having no runId', () => {
    const evt = bitbucketNormalizeCiEvent(payload({
      key: 'PIPELINE', state: 'FAILED', url: 'https://bb/pipelines/9',
      refname: 'builderforce/task-12', commit: { hash: 'cafe' },
    }));
    expect(evt).toEqual({
      eventType: 'commit_status', branch: 'builderforce/task-12', sha: 'cafe',
      outcome: 'failure', rawState: 'FAILED', targetUrl: 'https://bb/pipelines/9',
      runId: null, authoritative: true, statusKey: 'PIPELINE',
    });
  });

  it('carries the status key so sibling posters de-duplicate onto one build', () => {
    expect(bitbucketNormalizeCiEvent(payload({ key: 'SONAR', state: 'FAILED', commit: { hash: 'cafe' } }))?.statusKey).toBe('SONAR');
    expect(bitbucketNormalizeCiEvent(payload({ state: 'FAILED', commit: { hash: 'cafe' } }))?.statusKey).toBeNull();
  });

  it('is authoritative on success too, but not while in progress', () => {
    expect(bitbucketNormalizeCiEvent(payload({ state: 'SUCCESSFUL', commit: { hash: 'a' } }))).toMatchObject({ outcome: 'success', authoritative: true });
    expect(bitbucketNormalizeCiEvent(payload({ state: 'INPROGRESS', commit: { hash: 'a' } }))).toMatchObject({ outcome: 'pending', authoritative: false });
    expect(bitbucketNormalizeCiEvent(payload({ state: 'STOPPED', commit: { hash: 'a' } }))).toMatchObject({ outcome: null, authoritative: false });
  });

  it('falls back to the self link and accepts the legacy build_status envelope', () => {
    const evt = bitbucketNormalizeCiEvent({ build_status: { state: 'FAILED', commit: { hash: 'b' }, links: { self: { href: 'https://bb/s' } } } });
    expect(evt).toMatchObject({ targetUrl: 'https://bb/s', sha: 'b', authoritative: true });
  });

  // The route then resolves this null branch from the commit hash via the refs API
  // (see bitbucketBranchForCommit) before ingest; unresolved still means post-merge only.
  it('leaves branch null when no refname is posted', () => {
    expect(bitbucketNormalizeCiEvent(payload({ state: 'FAILED', commit: { hash: 'c' } }))?.branch).toBeNull();
  });

  it('returns null without a status object', () => {
    expect(bitbucketNormalizeCiEvent({ repository: { full_name: 'ws/app' } })).toBeNull();
  });
});
