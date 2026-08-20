import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The four public catalog readers, at the seam that actually breaks.
 *
 * Every one of these pages resolves its `generateMetadata` from one of these
 * functions, so the failure this guards is specific and silent: a reader that
 * returns `null` because it looked for the wrong envelope renders a page titled
 * "Not Found" with `noindex` on it, and nothing else in the suite notices. The
 * envelopes genuinely differ per catalog — `{ skill }`, `{ personas }`, a BARE
 * object, a BARE array — which is the whole reason one parameterised reader with
 * four descriptors was worth writing, and the reason the descriptors need a test.
 */

const { publicApiGet } = vi.hoisted(() => ({ publicApiGet: vi.fn() }));
vi.mock('./publicApi', () => ({ publicApiGet }));

import {
  getPublicAgent,
  getPublicPersona,
  getPublicPrompt,
  getPublishedSkill,
  listPublicAgentIds,
  listPublicPersonaSlugs,
  listPublicPromptSlugs,
  listPublishedSkillSlugs,
} from './marketplaceSeo';

/** The path the reader asked for on its most recent call. */
const lastPath = (): string => publicApiGet.mock.calls.at(-1)?.[0] as string;

beforeEach(() => {
  publicApiGet.mockReset();
});

describe('marketplaceSeo — skills', () => {
  it('maps a published skill out of its { skill } envelope', async () => {
    publicApiGet.mockResolvedValue({
      skill: {
        id: 's1', name: 'GitHub', slug: 'github', description: 'gh CLI',
        category: 'Development', tags: '["git","ci"]', version: '1.0.0',
        readme: '# GitHub', downloads: 2100, likes: 456,
        author_username: 'octo', author_display_name: 'Octo Cat',
      },
    });

    const skill = await getPublishedSkill('github');

    expect(skill).toMatchObject({
      id: 's1', name: 'GitHub', slug: 'github', category: 'Development',
      version: '1.0.0', downloads: 2100, author_display_name: 'Octo Cat',
    });
    // JSON-encoded tags are a real shape this endpoint returns.
    expect(skill?.tags).toEqual(['git', 'ci']);
  });

  it('reads the no-side-effect ?seo=1 variant so metadata never counts a download', async () => {
    publicApiGet.mockResolvedValue({ skill: { slug: 'github', name: 'GitHub' } });
    await getPublishedSkill('github');
    expect(lastPath()).toBe('/marketplace/skills/github?seo=1');
  });

  it('lists slugs out of the { skills } envelope', async () => {
    publicApiGet.mockResolvedValue({ skills: [{ slug: 'github' }, { slug: 'slack' }, {}] });
    await expect(listPublishedSkillSlugs()).resolves.toEqual(['github', 'slack']);
  });
});

describe('marketplaceSeo — personas', () => {
  it('flattens the NESTED persona behaviour body', async () => {
    // The detail route answers the row bare, not wrapped.
    publicApiGet.mockResolvedValue({
      id: 'p1', slug: 'code-reviewer', name: 'code-reviewer',
      description: 'Reviews code', category: 'Quality', tags: ['review'],
      persona: {
        voice: 'critical yet constructive',
        perspective: 'all code is a future maintenance burden',
        decisionStyle: 'thorough',
        outputPrefix: 'REVIEW:',
        capabilities: ['Code review', 'Security analysis'],
        image: 'https://example.test/p.png',
      },
      authorName: 'Builderforce', installCount: 97, likeCount: 38,
    });

    const persona = await getPublicPersona('code-reviewer');

    expect(persona).toMatchObject({
      slug: 'code-reviewer',
      voice: 'critical yet constructive',
      perspective: 'all code is a future maintenance burden',
      decisionStyle: 'thorough',
      outputPrefix: 'REVIEW:',
      authorName: 'Builderforce',
      installCount: 97,
    });
    expect(persona?.capabilities).toEqual(['Code review', 'Security analysis']);
  });

  it('survives a persona with no behaviour body at all', async () => {
    publicApiGet.mockResolvedValue({ id: 'p2', slug: 'bare', name: 'bare', description: '' });
    const persona = await getPublicPersona('bare');
    expect(persona).toMatchObject({ slug: 'bare', voice: '', capabilities: [] });
  });

  it('lists slugs from /public and clamps the limit the endpoint honours', async () => {
    publicApiGet.mockResolvedValue({ personas: [{ slug: 'code-creator' }, { slug: 'code-reviewer' }] });
    await expect(listPublicPersonaSlugs()).resolves.toEqual(['code-creator', 'code-reviewer']);
    // The server caps `limit` at 100; asking for 500 and being silently clamped
    // would make the sitemap claim a page size it never received.
    expect(lastPath()).toBe('/api/personas/public?limit=100');
  });
});

describe('marketplaceSeo — prompts', () => {
  it('maps the prompt body and its variables', async () => {
    publicApiGet.mockResolvedValue({
      id: 'pr1', slug: 'code-review', title: 'Code review', description: 'Review a diff',
      category: 'Engineering', tags: ['review'], authorName: 'Ada', currentVersion: 3,
      usageCount: 12, starCount: 4, isFeatured: true, model: 'claude-opus-4',
      body: 'Review the following diff: {{diff}}',
      variables: [
        { name: 'diff', description: 'The unified diff', default: '' },
        { description: 'no name — dropped' },
      ],
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    const prompt = await getPublicPrompt('code-review');

    expect(prompt).toMatchObject({
      slug: 'code-review', title: 'Code review', currentVersion: 3,
      usageCount: 12, isFeatured: true, model: 'claude-opus-4',
      body: 'Review the following diff: {{diff}}',
    });
    // A variable with no name cannot be substituted, so it is not a variable.
    expect(prompt?.variables).toEqual([
      { name: 'diff', description: 'The unified diff', default: null },
    ]);
  });

  it('lists slugs out of the { prompts } envelope', async () => {
    publicApiGet.mockResolvedValue({ prompts: [{ slug: 'code-review' }, { slug: 'sql-migration' }] });
    await expect(listPublicPromptSlugs()).resolves.toEqual(['code-review', 'sql-migration']);
  });
});

describe('marketplaceSeo — published agents', () => {
  it('maps the snake_case row off a BARE detail response', async () => {
    publicApiGet.mockResolvedValue({
      id: 'a1', name: 'Reviewer', title: 'Senior reviewer', bio: 'Reviews pull requests',
      skills: ['review', 'typescript'], base_model: 'llama-3', builtin_kind: null,
      hire_count: 7, evalScore: 0.82, price_cents: 2500, pricing_model: 'flat_fee',
      price_unit: null, runtime_support: 'both',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
    });

    const agent = await getPublicAgent('a1');

    expect(agent).toMatchObject({
      id: 'a1', name: 'Reviewer', title: 'Senior reviewer',
      baseModel: 'llama-3', hireCount: 7, evalScore: 0.82,
      priceCents: 2500, pricingModel: 'flat_fee', runtimeSupport: 'both',
    });
    expect(agent?.skills).toEqual(['review', 'typescript']);
  });

  it('lists ids out of a BARE array', async () => {
    publicApiGet.mockResolvedValue([{ id: 'a1' }, { id: 2 }, { name: 'no id' }]);
    await expect(listPublicAgentIds()).resolves.toEqual(['a1', '2']);
    expect(lastPath()).toBe('/api/workforce/agents');
  });
});

describe('marketplaceSeo — degrading to null', () => {
  /** Every reader answers the same two questions, so it is one table, not four. */
  const getters: [string, (key: string) => Promise<unknown>][] = [
    ['skill', getPublishedSkill],
    ['persona', getPublicPersona],
    ['prompt', getPublicPrompt],
    ['agent', getPublicAgent],
  ];
  const listers: [string, () => Promise<string[]>][] = [
    ['skill', listPublishedSkillSlugs],
    ['persona', listPublicPersonaSlugs],
    ['prompt', listPublicPromptSlugs],
    ['agent', listPublicAgentIds],
  ];

  it.each(getters)('%s: an unreachable API is a miss, not a throw', async (_kind, get) => {
    publicApiGet.mockResolvedValue(null);
    await expect(get('anything')).resolves.toBeNull();
  });

  it.each(getters)('%s: a 200 carrying an error envelope is a miss', async (_kind, get) => {
    publicApiGet.mockResolvedValue({ error: 'Not found' });
    await expect(get('anything')).resolves.toBeNull();
  });

  it.each(getters)('%s: an empty key never reaches the network', async (_kind, get) => {
    await expect(get('')).resolves.toBeNull();
    expect(publicApiGet).not.toHaveBeenCalled();
  });

  it.each(listers)('%s: an unreachable API yields an empty array', async (_kind, list) => {
    publicApiGet.mockResolvedValue(null);
    const keys = await list();
    expect(Array.isArray(keys)).toBe(true);
    expect(keys).toEqual([]);
  });

  it.each(listers)('%s: a body that is not a list yields an empty array', async (_kind, list) => {
    publicApiGet.mockResolvedValue({ unexpected: 'shape' });
    await expect(list()).resolves.toEqual([]);
  });
});
