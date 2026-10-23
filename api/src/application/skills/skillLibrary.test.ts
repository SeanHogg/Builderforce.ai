import { beforeEach, describe, expect, it } from 'vitest';
import { SKILL_READ_TOOL_NAME } from '@builderforce/agent-skills';
import { fakeDb } from '../../../test/fakeDb';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import { rankSkillsForTask, readLibrarySkill, renderSkillCatalogBlock, workspaceSkillSummaries } from './skillLibrary';
import { describeSkillReadTool, SKILLS_READ_TOOL } from '../llm/skillLibraryToolCatalog';
import { advertisedName } from '../llm/toolNaming';
import type { TenantSkill } from './tenantSkillService';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const env = {} as Env;
beforeEach(() => __clearL1CacheForTests());

const skill = (slug: string, name: string, description: string, body = 'Steps.') =>
  ({ id: `id-${slug}`, slug, name, description, body, manifest: null } as TenantSkill);

describe('the catalog a run is shown (level one)', () => {
  it('is empty with no approved skills, so callers inject unconditionally', () => {
    expect(renderSkillCatalogBlock([])).toBe('');
  });

  it('lists names and descriptions only and tells the run how to load one', () => {
    const block = renderSkillCatalogBlock(workspaceSkillSummaries([skill('ship-it', 'Ship it', 'When shipping.', 'SECRET STEPS')]));
    expect(block).toContain('<available_skills>');
    expect(block).toContain('<name>ship-it</name>');
    expect(block).toContain(SKILL_READ_TOOL_NAME);
    // Progressive disclosure: the body is NOT inlined.
    expect(block).not.toContain('SECRET STEPS');
  });
});

describe('rankSkillsForTask (E1)', () => {
  const skills = [
    skill('ship-schema-change', 'Ship a schema change', 'When a change needs a new database column or migration.'),
    skill('write-release-notes', 'Write release notes', 'When a release ships.'),
    skill('rotate-api-keys', 'Rotate API keys', 'When a credential leaks.'),
  ];

  it('keeps only the skills relevant to the task, best first', () => {
    expect(rankSkillsForTask(skills, 'Add a migration for the new invoice column').map((s) => s.slug)).toEqual(['ship-schema-change']);
  });

  it('caps the result at the limit (default 5)', () => {
    const many = Array.from({ length: 8 }, (_, i) => skill(`deploy-${i}`, `Deploy step ${i}`, 'When deploying.'));
    expect(rankSkillsForTask(many, 'deploy the service')).toHaveLength(5);
    expect(rankSkillsForTask(many, 'deploy the service', 2)).toHaveLength(2);
  });

  it('returns nothing when no skill matches', () => {
    expect(rankSkillsForTask(skills, 'Refactor the canvas toolbar')).toEqual([]);
  });
});

describe('skills.read (levels two and three)', () => {
  it('is advertised under the name the Brain pins', () => {
    expect(advertisedName(SKILLS_READ_TOOL)).toBe(SKILL_READ_TOOL_NAME);
  });

  it('carries the workspace catalog in its description', () => {
    const d = describeSkillReadTool([{ name: 'ship-it', description: 'When shipping.', source: 'workspace' }]);
    expect(d).toContain('- ship-it: When shipping.');
  });

  it('loads an approved workspace skill with its folder listing', async () => {
    const row = {
      id: 'abc', projectId: null, status: 'approved', slug: 'ship-it', name: 'Ship it', description: 'When shipping.', body: '1. Ship.',
      authorKind: 'human', authorLabel: null, evidence: null, originExecutionId: null, originTaskId: null,
      reviewedAt: new Date(), reviewNote: null, updatedAt: new Date(), manifest: { license: 'MIT', extensions: {} },
    };
    const db = fakeDb([[row], [{ path: 'scripts/ship.sh', sizeBytes: 12 }]]);
    const r = await readLibrarySkill(env, db as unknown as Db, 7, 'ship-it');
    expect(r).toMatchObject({ ok: true, name: 'ship-it', source: 'workspace', instructions: '1. Ship.', license: 'MIT', files: [{ path: 'scripts/ship.sh', sizeBytes: 12 }] });
  });

  it('loads one bundled file, and refuses a path that climbs out of the folder', async () => {
    const row = { id: 'abc', slug: 'ship-it', name: 'Ship it', description: 'd', body: 'b', status: 'approved', projectId: null, authorKind: 'human', authorLabel: null, evidence: null, originExecutionId: null, originTaskId: null, reviewedAt: null, reviewNote: null, updatedAt: new Date(), manifest: null };
    const ok = await readLibrarySkill(env, fakeDb([[row], [{ content: 'echo ship' }]]) as unknown as Db, 7, 'ship-it', 'scripts/ship.sh');
    expect(ok).toEqual({ ok: true, name: 'ship-it', path: 'scripts/ship.sh', content: 'echo ship' });
    const bad = await readLibrarySkill(env, fakeDb([[row], []]) as unknown as Db, 7, 'ship-it', '../../etc/passwd');
    expect(bad).toMatchObject({ ok: false });
  });

  it('falls back to a builtin skill when neither store has the name', async () => {
    const r = await readLibrarySkill(env, fakeDb([[], []]) as unknown as Db, 7, 'github');
    expect(r).toMatchObject({ ok: true, name: 'github', source: 'builtin' });
  });
});
