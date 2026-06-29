import { describe, it, expect } from 'vitest';
import { parseSuggestedActions } from './suggestedActions';

describe('parseSuggestedActions', () => {
  it('returns the message unchanged when there is no block', () => {
    const r = parseSuggestedActions('Here is a plain reply.');
    expect(r.content).toBe('Here is a plain reply.');
    expect(r.actions).toEqual([]);
  });

  it('lifts a suggested-actions block out and parses the buttons', () => {
    const content = [
      'I can set those up for you.',
      '',
      '```suggested-actions',
      '[{"label":"Create the OKRs","prompt":"Create those OKRs on the board"},',
      ' {"label":"Generate a PRD","prompt":"Write a PRD for this"}]',
      '```',
    ].join('\n');
    const r = parseSuggestedActions(content);
    expect(r.content).toBe('I can set those up for you.');
    expect(r.actions).toEqual([
      { label: 'Create the OKRs', prompt: 'Create those OKRs on the board' },
      { label: 'Generate a PRD', prompt: 'Write a PRD for this' },
    ]);
  });

  it('accepts the shorter ```actions fence', () => {
    const r = parseSuggestedActions('Done.\n```actions\n[{"label":"Open board","prompt":"Open the board"}]\n```');
    expect(r.content).toBe('Done.');
    expect(r.actions).toEqual([{ label: 'Open board', prompt: 'Open the board' }]);
  });

  it('caps at 4 buttons and drops entries missing label or prompt', () => {
    const items = JSON.stringify([
      { label: 'A', prompt: 'a' },
      { label: '', prompt: 'b' }, // dropped: no label
      { label: 'C', prompt: '' }, // dropped: no prompt
      { label: 'D', prompt: 'd' },
      { label: 'E', prompt: 'e' },
      { label: 'F', prompt: 'f' },
      { label: 'G', prompt: 'g' },
    ]);
    const r = parseSuggestedActions(`x\n\`\`\`suggested-actions\n${items}\n\`\`\``);
    expect(r.actions.map((a) => a.label)).toEqual(['A', 'D', 'E', 'F']);
  });

  it('strips a malformed block but yields no buttons', () => {
    const r = parseSuggestedActions('Reply.\n```suggested-actions\nnot json\n```');
    expect(r.content).toBe('Reply.');
    expect(r.actions).toEqual([]);
  });

  it('hides a still-streaming, not-yet-closed block', () => {
    const r = parseSuggestedActions('Working on it…\n```suggested-actions\n[{"label":"Cre');
    expect(r.content).toBe('Working on it…');
    expect(r.actions).toEqual([]);
  });
});
