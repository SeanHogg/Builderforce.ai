import { describe, expect, it } from 'vitest';
import { auditsKind } from './accessibility';
import { assessmentGate, liveAssessmentMode } from './assessment';
import { normalizeTexDelimiters, texRenderMode } from './mathTex';

/**
 * The engine additions the room stations and the composer gate stand on: which
 * assessments are LIVE, how authored prose with maths is drawn, and what the
 * accessibility audit has rules for.
 */

const NOW = Date.parse('2026-09-12T10:00:00Z');
const exam = (fields: Record<string, unknown>) => ({ kind: 'assignment', assessmentMode: 'closed', ...fields });

describe('liveAssessmentMode', () => {
  it('leaves the assistant on while a closed-book paper has no release date — it is still being written', () => {
    expect(liveAssessmentMode([exam({})], NOW)).toBe('open');
  });

  it('closes it between release and the deadline', () => {
    expect(liveAssessmentMode([exam({ releaseAt: '2026-09-12T09:00:00Z', dueAt: '2026-09-12T12:00:00Z' })], NOW)).toBe('closed');
  });

  it('opens it again before release and after the deadline', () => {
    expect(liveAssessmentMode([exam({ releaseAt: '2026-09-12T11:00:00Z' })], NOW)).toBe('open');
    expect(liveAssessmentMode([exam({ releaseAt: '2026-09-12T07:00:00Z', dueAt: '2026-09-12T09:00:00Z' })], NOW)).toBe('open');
  });

  it('takes the strictest LIVE mode, so an assisted task cannot reopen a closed exam', () => {
    const assisted = { kind: 'assignment', assessmentMode: 'assisted', releaseAt: '2026-09-12T08:00:00Z' };
    expect(liveAssessmentMode([assisted], NOW)).toBe('assisted');
    expect(liveAssessmentMode([assisted, exam({ releaseAt: '2026-09-12T09:00:00Z' })], NOW)).toBe('closed');
  });

  it('feeds the one evaluator every composer asks', () => {
    const gate = assessmentGate(liveAssessmentMode([exam({ releaseAt: '2026-09-12T09:00:00Z' })], NOW));
    expect(gate).toMatchObject({ assistantAllowed: false, recordsAssistance: true, refusalCode: 'closedBook' });
  });
});

describe('texRenderMode', () => {
  it('leaves ordinary prose plain — the common case pays nothing', () => {
    expect(texRenderMode('Critique one paper from the reading list.')).toBe('plain');
    expect(texRenderMode('')).toBe('plain');
    expect(texRenderMode(undefined)).toBe('plain');
  });

  it('sends delimited maths in prose through the markdown pipeline', () => {
    expect(texRenderMode('The heat flux is $q = -k\\nabla T$ in steady state.')).toBe('markdown');
    expect(texRenderMode('Show that \\(\\frac{a}{b}\\) is rational.')).toBe('markdown');
  });

  it('draws a bare expression as maths', () => {
    expect(texRenderMode('\\frac{dQ}{dt} = -kA\\frac{dT}{dx}')).toBe('expression');
  });

  it('never renders undelimited PROSE as one expression', () => {
    expect(texRenderMode('Use \\frac to divide the numerator by the denominator')).toBe('plain');
  });
});

describe('normalizeTexDelimiters', () => {
  it('rewrites \\( \\) and \\[ \\] to the dollar spelling the pipeline parses', () => {
    expect(normalizeTexDelimiters('a \\(x^2\\) b \\[y\\]')).toBe('a $x^2$ b $$y$$');
  });
});

describe('auditsKind', () => {
  it('is true exactly for the kinds the audit has a rule for', () => {
    for (const kind of ['image', 'diagram', 'chart', 'report', 'video', 'lecture', 'podcast', 'equation']) expect(auditsKind(kind)).toBe(true);
    for (const kind of ['note', 'assignment', 'bibliography']) expect(auditsKind(kind)).toBe(false);
  });
});
