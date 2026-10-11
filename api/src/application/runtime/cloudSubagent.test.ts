import { describe, expect, it, vi } from 'vitest';
import type { Capability, RepoWriteCapability } from '@builderforce/agent-tools';
import {
  childCapabilities,
  DELEGATION_CAPABILITIES,
  MUTATING_CAPABILITIES,
  NON_DELEGABLE_CAPABILITIES,
  resolveDelegatePersona,
  scopedRepoWrite,
  TREE_WIDE_CAPABILITIES,
} from './cloudSubagent';

/**
 * What a child may TOUCH and WHO it runs as — a security boundary and a staffing rule, so
 * both are tested directly (a set-difference bug here is silent). The run itself is an
 * ordinary durable run (`cloudChildRuns.test.ts`).
 */

const ALL_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  'repo.read', 'repo.search', 'repo.write', 'repo.edit', 'repo.delete', 'shell', 'process', 'git.write',
  'human', 'memory', 'memory.forget', 'coordinate', 'prd.write', 'web', 'web.search',
  'skill.author', 'orchestrate', 'orchestrate.fanout', 'orchestrate.live',
]);

describe('childCapabilities', () => {
  it('lets a child spawn only while it is above the depth cap — the editor\'s recursion rule', () => {
    for (const c of DELEGATION_CAPABILITIES) {
      expect([...childCapabilities(ALL_CAPS, false, false, true)]).toContain(c);
      expect([...childCapabilities(ALL_CAPS, false, false, false)]).not.toContain(c);
    }
  });

  it('never lets a child pause the run for a human or author a skill', () => {
    for (const c of NON_DELEGABLE_CAPABILITIES) expect([...childCapabilities(ALL_CAPS, false, false, true)]).not.toContain(c);
  });

  it('withholds every mutating capability from the default read-only child', () => {
    const caps = childCapabilities(ALL_CAPS, true);
    for (const c of MUTATING_CAPABILITIES) expect([...caps]).not.toContain(c);
    // …while leaving it everything it needs to investigate.
    expect([...caps]).toEqual(expect.arrayContaining(['repo.read', 'repo.search', 'memory', 'web.search']));
  });

  it('keeps the file writers for a scoped child and withholds the tree-wide ones', () => {
    const caps = childCapabilities(ALL_CAPS, false, true);
    expect([...caps]).toEqual(expect.arrayContaining(['repo.write', 'repo.edit', 'repo.delete']));
    for (const c of TREE_WIDE_CAPABILITIES) expect([...caps]).not.toContain(c);
  });

  it('is a subset of the owner — a child can never gain what the surface lacks', () => {
    const narrow: ReadonlySet<Capability> = new Set<Capability>(['repo.read']);
    expect([...childCapabilities(narrow, false, false, true)]).toEqual(['repo.read']);
  });
});

describe('resolveDelegatePersona', () => {
  const ada = { name: 'Ada', brief: 'You are the data engineer.' };
  const roster = async (agent: string) => (agent.toLowerCase() === 'ada' ? ada : null);

  it('runs the child as the resolved agent, attributed to a real teammate', async () => {
    expect(await resolveDelegatePersona(roster, 'Ada', 'explore')).toEqual({ ok: true, persona: ada, echo: { asAgent: { ref: 'Ada', name: 'Ada' } } });
  });

  it('refuses an unknown agent instead of running an anonymous child in its name', async () => {
    expect(await resolveDelegatePersona(roster, 'Kevin', 'explore')).toEqual({ ok: false, error: 'no agent named "Kevin" in this workspace' });
  });

  it('runs a code slice for an agent with no developer role as an on-demand Developer, unattributed', async () => {
    const who = await resolveDelegatePersona(async () => ({ ...ada, roleKeys: ['qa-tester'] }), 'Ada', 'code');
    expect(who.ok && who.echo.asAgent).toBeFalsy();
    expect(who.ok && who.echo.staffing).toContain('on-demand Developer');
  });

  it('refuses when the surface has no roster at all, rather than ignoring the name', async () => {
    expect(await resolveDelegatePersona(undefined, 'Ada', 'code')).toMatchObject({ ok: false });
  });

  it('is an ordinary anonymous delegation when no agent is named', async () => {
    expect(await resolveDelegatePersona(roster, '', 'code')).toEqual({ ok: true, echo: {} });
  });
});

describe('scopedRepoWrite', () => {
  it('refuses a write outside the child\'s paths before anything is sent', async () => {
    const writeFile = vi.fn(async () => ({ ok: true as const }));
    const write = { writeFile, editFile: vi.fn(), deleteFile: vi.fn() } as unknown as RepoWriteCapability;
    const scoped = scopedRepoWrite(write, ['src/auth']);
    expect(await scoped.writeFile('src/auth/a.ts', 'x')).toMatchObject({ ok: true });
    expect(await scoped.writeFile('src/billing/b.ts', 'x')).toMatchObject({ ok: false });
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});
