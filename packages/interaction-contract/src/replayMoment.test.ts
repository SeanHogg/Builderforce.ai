import { describe, expect, it } from 'vitest';
import { formatReplayMomentTrailer, parseReplayMoment, replayMomentDescriptionEditor, replayMomentFromDescription, stripReplayMomentTrailer, type ReplayMoment } from './replayMoment';

const MOMENT: ReplayMoment = {
  siteId: '11111111-1111-4111-8111-111111111111',
  recordingId: '22222222-2222-4222-8222-222222222222',
  atMs: 12_345,
  releaseKey: 'abcdef123456',
  metric: 'frustrated',
  route: '/pricing',
};

describe('replay moment trailer', () => {
  it('round-trips through a ticket description', () => {
    const description = `Rage click on Buy.\n\n[Watch](/apps/insights?panel=recording:x&t=12)\n\n${formatReplayMomentTrailer(MOMENT)}`;
    expect(replayMomentFromDescription(description)).toEqual(MOMENT);
  });

  it('cannot be closed early by a value carrying "--"', () => {
    const odd = { ...MOMENT, route: '/a--b -->' };
    const trailer = formatReplayMomentTrailer(odd);
    expect(trailer.indexOf('-->')).toBe(trailer.length - 3);
    expect(replayMomentFromDescription(trailer)).toEqual(odd);
  });

  it('is null for a description without one, or with a malformed one', () => {
    expect(replayMomentFromDescription(null)).toBeNull();
    expect(replayMomentFromDescription('Just a ticket')).toBeNull();
    expect(replayMomentFromDescription('<!-- bf:replay-moment {"siteId":"x"} -->')).toBeNull();
    expect(replayMomentFromDescription('<!-- bf:replay-moment {not json} -->')).toBeNull();
  });

  it('refuses an unknown metric or a negative time', () => {
    expect(parseReplayMoment({ ...MOMENT, metric: 'clicks' })).toBeNull();
    expect(parseReplayMoment({ ...MOMENT, atMs: -1 })).toBeNull();
  });

  it('is stripped from the description a person reads', () => {
    expect(stripReplayMomentTrailer(`Rage click on Buy.

${formatReplayMomentTrailer(MOMENT)}`)).toBe('Rage click on Buy.');
  });

  it('edits as visible text and re-attaches the same trailer on save', () => {
    const trailer = formatReplayMomentTrailer(MOMENT);
    const editor = replayMomentDescriptionEditor(`Rage click on Buy.\n\n${trailer}`);
    expect(editor.text).toBe('Rage click on Buy.');
    expect(editor.save('Rage click on Buy, fixed copy.')).toBe(`Rage click on Buy, fixed copy.\n\n${trailer}`);
    expect(replayMomentFromDescription(editor.save('anything'))).toEqual(MOMENT);
    expect(editor.save('')).toBe(trailer);
  });

  it('passes a plain description through untouched', () => {
    const editor = replayMomentDescriptionEditor('Just a ticket');
    expect(editor.text).toBe('Just a ticket');
    expect(editor.save('Edited')).toBe('Edited');
    expect(editor.save('')).toBeNull();
    expect(replayMomentDescriptionEditor(null).text).toBe('');
  });
});
