import { describe, expect, it } from 'vitest';
import { ALIGN_LIST_CAP, alignTicketsToRoadmap, type AlignTicket } from './alignTicketsToRoadmap';

const ROADMAP = [
  '## Consolidated Gap Register',
  '',
  '## 🔨 Make — Build',
  '',
  '- **[agents] Desktop index search is still brute force,** port the graph index. [make.md › Index](./docs/specs/make.md#knowledge-index)',
  '- **[agents] Golden path cloud agent E2E is missing,** add the run. [make.md › PRD 09](./docs/specs/make.md#5-golden-path)',
  '- **[agents] Nobody covers this gap,** body. [make.md › Gone](./docs/specs/make.md#no-such-heading)',
  '',
  '## 📣 Reach — sell',
  '',
  '- **[growth] Pricing page copy,** body. [reach.md › Pricing](./docs/specs/reach.md#pricing)',
].join('\n');

const SPECS = {
  'docs/specs/make.md': '# Make\n## Knowledge index\n## 5. Golden path\n',
};

const ticket = (id: number, title: string, extra: Partial<AlignTicket> = {}): AlignTicket => ({
  id, title, description: null, status: 'backlog', parentTaskId: null, ...extra,
});

const run = (openTickets: AlignTicket[]) =>
  alignTicketsToRoadmap({ tenantId: 7, projectId: 11, roadmapMarkdown: ROADMAP, specs: SPECS, openTickets });

describe('alignTicketsToRoadmap', () => {
  it('matches a ticket by the gap\'s exact spec link in its description', () => {
    const res = run([ticket(1, 'Unrelated wording', { description: 'See ./docs/specs/make.md#knowledge-index for scope.' })]);
    expect(res.matched.items).toEqual([{ gapId: 'make/desktop-index-search-is-still-brute-force', taskIds: [1], childTaskIds: [] }]);
    expect(res.ticketsWithoutGap.total).toBe(0);
  });

  it('matches a ticket by the gap id in its title', () => {
    const res = run([ticket(2, 'Roadmap reach/pricing-page-copy')]);
    expect(res.matched.items.map((m) => m.gapId)).toEqual(['reach/pricing-page-copy']);
  });

  it('matches a ticket by title similarity to the gap summary (the near-duplicate rule)', () => {
    const res = run([ticket(3, 'Golden-path cloud agent E2E missing')]);
    expect(res.matched.items).toEqual([{ gapId: 'make/golden-path-cloud-agent-e2e-is-missing', taskIds: [3], childTaskIds: [] }]);
    // A one-word substitution is different work.
    expect(run([ticket(4, 'Desktop index search is still slow')]).matched.total).toBe(0);
  });

  it('excludes fan-out copies entirely', () => {
    const res = run([ticket(5, 'Pricing page copy', { isFanoutCopy: true }), ticket(6, 'Something else')]);
    expect(res.tickets).toBe(1);
    expect(res.matched.total).toBe(0);
    expect(res.ticketsWithoutGap.items).toEqual([{ id: 6, title: 'Something else' }]);
  });

  it('counts a child of a matched ticket under the parent, never as unbacked', () => {
    const res = run([
      ticket(10, 'Pricing page copy'),
      ticket(11, 'Write the hero headline', { parentTaskId: 10 }),
      ticket(12, 'Proofread', { parentTaskId: 11 }),
      ticket(13, 'Orphan child', { parentTaskId: 999 }),
    ]);
    expect(res.matched.items).toEqual([{ gapId: 'reach/pricing-page-copy', taskIds: [10], childTaskIds: [11, 12] }]);
    expect(res.ticketsWithoutGap.items).toEqual([{ id: 13, title: 'Orphan child' }]);
  });

  it('covers a gap matched only by a child of a matched parent', () => {
    const res = run([
      ticket(20, 'Pricing page copy'),
      ticket(21, 'Golden path cloud agent E2E is missing', { parentTaskId: 20 }),
    ]);
    expect(res.matched.items).toEqual([
      { gapId: 'make/golden-path-cloud-agent-e2e-is-missing', taskIds: [], childTaskIds: [21] },
      { gapId: 'reach/pricing-page-copy', taskIds: [20], childTaskIds: [21] },
    ]);
    expect(res.gapsWithoutTicket.items.map((g) => g.gapId)).not.toContain('make/golden-path-cloud-agent-e2e-is-missing');
  });

  it('matches a gap id only on a token boundary', () => {
    const roadmap = [
      '## Consolidated Gap Register',
      '## 🔨 Make — Build',
      '- **Foo,** first.',
      '- **Foo,** second.',
    ].join('\n');
    const align = (title: string) => alignTicketsToRoadmap({
      tenantId: 7, projectId: 11, roadmapMarkdown: roadmap, specs: {}, openTickets: [ticket(30, title)],
    }).matched.items.map((m) => m.gapId);
    expect(align('Tracks make/foo-2 only')).toEqual(['make/foo-2']);
    expect(align('Tracks make/foo.')).toEqual(['make/foo']);
    expect(align('Tracks remake/foo and x/make/foo')).toEqual([]);
  });

  it('reports links into an existing-but-unreadable spec under neither missing nor dangling', () => {
    const res = alignTicketsToRoadmap({
      tenantId: 7, projectId: 11, roadmapMarkdown: ROADMAP, specs: SPECS, openTickets: [], unreadableSpecFiles: ['docs/specs/reach.md'],
    });
    expect(res.specFilesMissing.total).toBe(0);
  });

  it('reports a dangling anchor and a missing spec file, and every unmatched gap', () => {
    const res = run([]);
    expect(res.danglingSpecLinks.items).toEqual([{ gapId: 'make/nobody-covers-this-gap', file: 'docs/specs/make.md', anchor: 'no-such-heading' }]);
    expect(res.specFilesMissing.items).toEqual(['docs/specs/reach.md']);
    expect(res.gapsWithoutTicket.total).toBe(4);
    expect(res.gapsWithoutTicket.items[0]).toEqual({
      gapId: 'make/desktop-index-search-is-still-brute-force', stage: 'make', summary: 'Desktop index search is still brute force', line: 5,
    });
    expect(res.gapsByStage).toEqual({ make: 3, reach: 1 });
  });

  it('caps each list and flags the cut', () => {
    const many = Array.from({ length: ALIGN_LIST_CAP + 3 }, (_, i) => ticket(100 + i, `Unrelated ticket ${i}`));
    const res = run(many);
    expect(res.ticketsWithoutGap.items).toHaveLength(ALIGN_LIST_CAP);
    expect(res.ticketsWithoutGap).toMatchObject({ total: ALIGN_LIST_CAP + 3, truncated: true });
  });
});
