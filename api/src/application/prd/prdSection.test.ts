/**
 * PRD section surgery — the pure half of the agent-facing `update_prd` section mode.
 *
 * This is the only DESTRUCTIVE thing a run may do to the shared spec, so the boundaries
 * matter more than the happy path. Two of them are load-bearing and easy to get wrong:
 *
 *   • A signed revision block (`### Update — …` under a `---`) sits at the END of an
 *     evolved PRD. Ending a section only at the next `##` would make an edit to the LAST
 *     section swallow every signature on the document.
 *   • An unknown heading must FAIL with the headings that exist, not fuzzy-match onto a
 *     neighbouring requirement — a wrong guess here silently deletes a requirement.
 */
import { describe, expect, it, vi } from 'vitest';

// Only the PURE string surgery is under test here. Stubbing the gateway seam keeps this
// suite off the LLM module graph entirely — it has no business loading a proxy to
// exercise a regex, and a broken neighbour there must not be able to fail these.
vi.mock('../llm/tenantProxy', () => ({ completeForTenant: vi.fn() }));
vi.mock('../llm/LlmProxyService', () => ({ readProxyChoice: vi.fn() }));

import { listPrdSections, replacePrdSection, appendPrdRevision, scaffoldPrdSections, buildPrdWithAttribution } from './taskPrd';

const PRD = [
  '> **PRD** — drafted by Ada · task #7',
  '',
  '## Requirements',
  '',
  'The original requirements.',
  '',
  '## Design',
  '',
  'The original design.',
  '',
  '## Acceptance',
  '',
  'The original acceptance criteria.',
].join('\n');

describe('listPrdSections', () => {
  it('lists the `##` headings in document order and ignores `###` revision blocks', () => {
    const evolved = appendPrdRevision(PRD, { agentLabel: 'Ada', directive: 'a steer', isoTimestamp: 'T' });
    expect(listPrdSections(evolved)).toEqual(['Requirements', 'Design', 'Acceptance']);
  });

  it('finds every role hand-off section the scaffold writes', () => {
    const scaffolded = scaffoldPrdSections(buildPrdWithAttribution('body', 'Ada', 1));
    expect(listPrdSections(scaffolded)).toEqual([
      'Requirements', 'Design', 'Implementation Notes', 'Review', 'Test Evidence', 'Acceptance',
    ]);
  });
});

describe('replacePrdSection', () => {
  it('replaces one section body and leaves its neighbours untouched', () => {
    const r = replacePrdSection(PRD, 'Design', 'A corrected design.');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.section).toBe('Design');
    expect(r.prd).toContain('A corrected design.');
    expect(r.prd).not.toContain('The original design.');
    // The blast radius is exactly one section.
    expect(r.prd).toContain('The original requirements.');
    expect(r.prd).toContain('The original acceptance criteria.');
    expect(listPrdSections(r.prd)).toEqual(['Requirements', 'Design', 'Acceptance']);
  });

  it('matches the heading case-insensitively and tolerates a leading `##`', () => {
    for (const h of ['design', '  DESIGN ', '## Design']) {
      const r = replacePrdSection(PRD, h, 'new');
      expect(r.ok, `heading "${h}"`).toBe(true);
      if (r.ok) expect(r.section).toBe('Design');
    }
  });

  it('editing the LAST section does not swallow the signed revision blocks', () => {
    // THE regression this boundary exists for: revisions live after a `---` rule at the
    // end of the document, past the final `##` heading.
    const evolved = appendPrdRevision(PRD, { agentLabel: 'Grace', directive: 'ship behind a flag', isoTimestamp: '2026-01-01T00:00:00Z', executionId: 42 });
    const r = replacePrdSection(evolved, 'Acceptance', 'Corrected acceptance.');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.prd).toContain('Corrected acceptance.');
    expect(r.prd).not.toContain('The original acceptance criteria.');
    expect(r.prd).toContain('### Update — Grace · 2026-01-01T00:00:00Z · execution #42');
    expect(r.prd).toContain('ship behind a flag');
  });

  it('refuses an unknown heading and returns the headings that DO exist', () => {
    const r = replacePrdSection(PRD, 'Out of scope', 'nothing');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.sections).toEqual(['Requirements', 'Design', 'Acceptance']);
    // Nothing was guessed at: the caller gets a choice, not a silent overwrite.
  });

  it('is idempotent — re-applying the same body changes nothing further', () => {
    const once = replacePrdSection(PRD, 'Design', 'A corrected design.');
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = replacePrdSection(once.prd, 'Design', 'A corrected design.');
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect(twice.prd).toBe(once.prd);
  });
});
