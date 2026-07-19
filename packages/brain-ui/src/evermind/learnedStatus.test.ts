import { describe, it, expect } from 'vitest';
import { evermindLearnedStatus } from './learnedStatus';

const TASK = 'describe the fundamentals of social media advertising and SEO with GEO';

describe('evermindLearnedStatus', () => {
  it('reports a delta as having no text provenance', () => {
    expect(evermindLearnedStatus({ kind: 'delta' })).toEqual({ state: 'delta' });
  });

  it('reports a distilled entry with the teacher that produced it', () => {
    expect(evermindLearnedStatus({
      kind: 'text', prompt: TASK, text: 'An expert answer about SEO and GEO.',
      distilled: true, teacherModel: 'claude-opus-4-8',
    })).toEqual({ state: 'distilled', teacherModel: 'claude-opus-4-8' });
  });

  it('treats an unpinned teacher as self-learning, NOT a fault', () => {
    // Self-learning from real run output is a legitimate mode — flagging it would cry
    // wolf on every project that never pinned a teacher.
    expect(evermindLearnedStatus({
      kind: 'text', text: 'Some real run output that the model adapted on.',
      distilled: false, skipReason: 'not_pinned',
    })).toEqual({ state: 'self' });
  });

  it.each([
    ['budget_exhausted'],
    ['gateway_error'],
    ['empty_output'],
    ['exception'],
    ['input_too_short'],
  ])('reports %s as an actionable fault naming the model that failed', (reason) => {
    expect(evermindLearnedStatus({
      kind: 'text', prompt: TASK, distilled: false,
      skipReason: reason, attemptedTeacherModel: 'claude-opus-4-8', skipDetail: 'HTTP 503',
    })).toEqual({ state: 'fault', reason, teacherModel: 'claude-opus-4-8', detail: 'HTTP 503' });
  });

  it('flags a LEGACY row whose text merely echoes the task as a fault', () => {
    // Rows merged before the outcome was recorded carry no provenance. The one case we
    // can prove is text === prompt: that is the echo a failed teacher leaves behind, and
    // showing it as "Learned" presents the user's question as the model's own answer.
    expect(evermindLearnedStatus({ kind: 'text', prompt: TASK, text: TASK }))
      .toEqual({ state: 'fault', reason: 'unknown' });
    expect(evermindLearnedStatus({ kind: 'text', prompt: `  ${TASK}  `, text: TASK }))
      .toEqual({ state: 'fault', reason: 'unknown' });
  });

  it('leaves a legacy row with a genuinely different answer alone', () => {
    expect(evermindLearnedStatus({ kind: 'text', prompt: TASK, text: 'A real, distinct answer.' }))
      .toEqual({ state: 'self' });
  });
});
