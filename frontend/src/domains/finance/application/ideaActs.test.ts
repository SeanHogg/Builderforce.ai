import { describe, expect, it } from 'vitest';
import type { CardActBoard, CardActContext } from '@/domains/canvas/application/CardAct';
import type { CanvasObject, CanvasObjectData } from '@/domains/canvas/domain/canvasObject';
import { ideaActs } from './ideaActs';

const t = ((key: string, values?: Record<string, unknown>) => {
  if (key === 'noticeIdeaInterviewTitle') return `Interview: ${values?.idea}`;
  if (key === 'noticeIdeaFormTitle') return `Ask: ${values?.idea}`;
  if (key === 'noticeIdeaUntitled') return 'Untitled idea';
  if (key === 'noticeIdeaInterviewPlanned') return `planned ${values?.idea}`;
  if (key === 'noticeIdeaFormCreated') return `form ${values?.idea}`;
  return key;
}) as CardActContext['t'];

// `overrides` is typed as the object's OWN data rather than `Record<string, unknown>`:
// spreading an index signature widened `title` to `unknown`, which left the literal with
// no overlap against `CanvasObjectData` and made the cast a TS2352 error. Naming the type
// also means a typo in an override is caught here instead of silently testing nothing.
function idea(overrides: Partial<CanvasObjectData> = {}): CanvasObject {
  return {
    id: 'idea-1',
    type: 'creation',
    position: { x: 10, y: 20 },
    data: { kind: 'idea', title: 'Scheduler', stage: 'captured', problem: 'Lost Fridays', ...overrides },
  };
}

function boardWith(created: CanvasObject): CardActBoard {
  return {
    objects: [],
    create: (kind) => {
      created.data = { ...created.data, kind };
      return created;
    },
  };
}

describe('ideaActs', () => {
  it('explore plans an interview, names it on the idea, and moves captured → validating', async () => {
    const created = { id: 'iv-1', position: { x: 0, y: 0 }, data: { kind: 'customerInterview' } } as CanvasObject;
    const result = await ideaActs.run({
      object: idea(),
      action: 'explore',
      board: boardWith(created),
      t,
    });
    expect(created.data.title).toBe('Interview: Scheduler');
    expect(result.patch).toMatchObject({ stage: 'validating' });
    expect((result.patch as { testedBy: string[] }).testedBy).toContain('Interview: Scheduler');
    expect(result.add?.nodes).toEqual([created]);
    expect(result.notice).toContain('Scheduler');
  });

  it('test authors a form from the idea and does not pull a later stage back', async () => {
    const created = { id: 'form-1', position: { x: 0, y: 0 }, data: { kind: 'form' } } as CanvasObject;
    const result = await ideaActs.run({
      object: idea({ stage: 'validated', riskiestAssumptions: ['They will pay'] }),
      action: 'test',
      board: boardWith(created),
      t,
    });
    expect(created.data.title).toBe('Ask: Scheduler');
    expect(result.patch).not.toHaveProperty('stage');
    const questions = created.data.questions as Array<{ id: string }>;
    expect(questions.map((q) => q.id)).toContain('wouldPay');
    expect(questions.map((q) => q.id)).toContain('assumption-1');
    expect(result.notice).toContain('form');
  });
});
