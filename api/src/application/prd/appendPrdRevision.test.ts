import { describe, expect, it } from 'vitest';
import { appendPrdRevision, buildPrdWithAttribution } from './taskPrd';

describe('appendPrdRevision', () => {
  const base = buildPrdWithAttribution('# Goal\n\nShip the thing.', 'Coder Agent V2', 1);

  it('appends a dated, attributed, signed revision section', () => {
    const out = appendPrdRevision(base, {
      agentLabel: 'Coder Agent V2',
      directive: 'Also send a Slack notification on failure.',
      executionId: 55,
      isoTimestamp: '2026-06-12T10:00:00.000Z',
    });
    expect(out.startsWith(base.trimEnd())).toBe(true);
    expect(out).toContain('\n\n---\n\n');
    expect(out).toContain('### Update — Coder Agent V2 · 2026-06-12T10:00:00.000Z · execution #55');
    expect(out).toContain('Also send a Slack notification on failure.');
  });

  it('omits the execution ref when none is given', () => {
    const out = appendPrdRevision(base, { agentLabel: 'A', directive: 'd', executionId: null, isoTimestamp: 'T' });
    expect(out).toContain('### Update — A · T\n');
    expect(out).not.toContain('execution #');
  });

  it('stacks multiple revisions in order', () => {
    const r1 = appendPrdRevision(base, { agentLabel: 'A', directive: 'first', executionId: 1, isoTimestamp: 'T1' });
    const r2 = appendPrdRevision(r1, { agentLabel: 'B', directive: 'second', executionId: 2, isoTimestamp: 'T2' });
    expect(r2.indexOf('first')).toBeLessThan(r2.indexOf('second'));
    expect(r2.match(/### Update —/g)).toHaveLength(2);
  });

  it('trims the directive', () => {
    const out = appendPrdRevision(base, { agentLabel: 'A', directive: '  spaced  ', executionId: null, isoTimestamp: 'T' });
    expect(out).toMatch(/spaced$/);
  });
});
