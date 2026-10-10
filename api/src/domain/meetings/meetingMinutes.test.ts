import { describe, expect, it } from 'vitest';
import { actionItemTitle, parseMeetingMinutes } from './meetingMinutes';

const MINUTES = [
  'The team reviewed the release and agreed to slip the beta by a week.',
  '',
  '**Decisions**',
  '- Beta moves to the 14th',
  '',
  '**Action items**',
  '- [ ] Ana — Update the release notes',
  '- [x] Ben — Book the demo room',
  '- [ ] Write up the retro.',
].join('\n');

describe('parseMeetingMinutes', () => {
  it('reads the recap, the decisions and the checklist the prompt asks for', () => {
    const minutes = parseMeetingMinutes(MINUTES);
    expect(minutes.summary).toBe('The team reviewed the release and agreed to slip the beta by a week.');
    expect(minutes.decisions).toEqual(['Beta moves to the 14th']);
    expect(minutes.actionItems).toEqual([
      { owner: 'Ana', task: 'Update the release notes', done: false },
      { owner: 'Ben', task: 'Book the demo room', done: true },
      // A line with no separator names no owner; the whole text is the task.
      { owner: null, task: 'Write up the retro.', done: false },
    ]);
  });

  it('tolerates heading variants a model reaches for', () => {
    const minutes = parseMeetingMinutes('### Summary\nShort.\n### Action Items\n* Cy: ship it');
    expect(minutes.summary).toBe('Short.');
    expect(minutes.actionItems).toEqual([{ owner: 'Cy', task: 'ship it', done: false }]);
  });

  it('answers empty for no minutes rather than throwing', () => {
    expect(parseMeetingMinutes(null)).toEqual({ summary: '', decisions: [], actionItems: [] });
    expect(parseMeetingMinutes('   ')).toEqual({ summary: '', decisions: [], actionItems: [] });
  });
});

describe('actionItemTitle', () => {
  it('prefixes the owner only when the line named one', () => {
    expect(actionItemTitle({ owner: 'Ana', task: 'Ship', done: false })).toBe('Ana — Ship');
    expect(actionItemTitle({ owner: null, task: 'Ship', done: false })).toBe('Ship');
  });
});
