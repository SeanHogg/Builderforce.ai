import { describe, expect, it } from 'vitest';
import {
  buildPrDispatchMessage,
  buildBranchName,
  buildPrBody,
  slugifyBranchSegment,
} from './prDispatch';

const repo = {
  provider: 'github',
  host: 'github.com',
  owner: 'acme',
  repo: 'web',
  defaultBranch: 'develop',
};

describe('slugifyBranchSegment', () => {
  it('lower-cases and hyphenates', () => {
    expect(slugifyBranchSegment('Add Login Flow!')).toBe('add-login-flow');
  });
  it('strips leading/trailing hyphens and collapses runs', () => {
    expect(slugifyBranchSegment('  --Foo___Bar--  ')).toBe('foo-bar');
  });
  it('returns empty string for non-alphanumeric input', () => {
    expect(slugifyBranchSegment('!!!')).toBe('');
  });
  it('caps to maxLength with no trailing hyphen', () => {
    const out = slugifyBranchSegment('a'.repeat(10) + ' ' + 'b'.repeat(60), 12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out.endsWith('-')).toBe(false);
  });
});

describe('buildBranchName', () => {
  it('uses id + title slug by default', () => {
    expect(buildBranchName({ id: 42, title: 'Add login flow' })).toBe('task/42-add-login-flow');
  });
  it('prefers ticketRef when present', () => {
    expect(buildBranchName({ id: 42, title: 'Add login', ticketRef: 'JIRA-9' })).toBe('task/jira-9-add-login');
  });
  it('honors an explicit branchName (slugified)', () => {
    expect(buildBranchName({ id: 1, title: 'x', branchName: 'feature/My Cool Branch' })).toBe('feature-my-cool-branch');
  });
  it('falls back to task/change when title is unsluggable and no id-ish info', () => {
    expect(buildBranchName({ id: '', title: '!!!' })).toBe('task/change');
  });
});

describe('buildPrBody', () => {
  it('includes PRD body + traceability footer', () => {
    const body = buildPrBody(
      { id: 7, title: 'Do thing', ticketRef: 'JIRA-7' },
      { specId: 'spec-1', body: 'PRD content here' },
    );
    expect(body).toContain('PRD content here');
    expect(body).toContain('Task: #7 — Do thing');
    expect(body).toContain('Ticket: JIRA-7');
    expect(body).toContain('Spec: spec-1');
  });
  it('falls back to task description when no PRD body', () => {
    const body = buildPrBody({ id: 7, title: 'Do thing', description: 'task desc' });
    expect(body).toContain('task desc');
    expect(body).not.toContain('Spec:');
    expect(body).not.toContain('Ticket:');
  });
});

describe('buildPrDispatchMessage', () => {
  it('produces a fully-formed create_pr envelope', () => {
    const msg = buildPrDispatchMessage(
      repo,
      { id: 12, title: 'Add metrics', ticketRef: 'OPS-3' },
      { specId: 'spec-x', body: 'why' },
    );
    expect(msg.type).toBe('create_pr');
    expect(msg.repo).toEqual({
      provider: 'github',
      host: 'github.com',
      owner: 'acme',
      repo: 'web',
      defaultBranch: 'develop',
    });
    expect(msg.base).toBe('develop');
    expect(msg.branchName).toBe('task/ops-3-add-metrics');
    expect(msg.title).toBe('Add metrics');
    expect(msg.ticketRef).toBe('OPS-3');
    expect(msg.specId).toBe('spec-x');
    expect(msg.body).toContain('why');
  });

  it('defaults base branch to main when repo.defaultBranch is empty', () => {
    const msg = buildPrDispatchMessage({ ...repo, defaultBranch: null }, { id: 1, title: 'x' });
    expect(msg.base).toBe('main');
    expect(msg.repo.defaultBranch).toBe('main');
  });

  it('null ticketRef/specId when not provided', () => {
    const msg = buildPrDispatchMessage(repo, { id: 1, title: 'x' });
    expect(msg.ticketRef).toBeNull();
    expect(msg.specId).toBeNull();
  });
});
