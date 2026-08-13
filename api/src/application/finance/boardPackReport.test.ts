/**
 * The board pack's subject reference.
 *
 * The assertion that matters is the REFUSAL: a malformed reference must return null so
 * the dispatcher skips that schedule and still advances its watermark. Throwing would
 * fail the whole tick and take every other schedule in the batch with it.
 */
import { describe, expect, it } from 'vitest';
import { boardPackSubjectRef, parseBoardPackSubject } from './boardPackReport';

describe('board pack subject reference', () => {
  it('round-trips a session and frame', () => {
    const ref = boardPackSubjectRef('sess-1', 'frame-9');
    expect(ref).toBe('sess-1:frame-9');
    expect(parseBoardPackSubject('canvas_frame', ref)).toEqual({ sessionId: 'sess-1', frameId: 'frame-9' });
  });

  it('ignores a subject that is not a canvas frame', () => {
    // The five computed report types carry no subject; a future sixth may carry a
    // different kind. Neither must be read as a frame reference.
    expect(parseBoardPackSubject('project', 'a:b')).toBeNull();
    expect(parseBoardPackSubject(null, null)).toBeNull();
  });

  it('returns null for a half reference rather than throwing', () => {
    expect(parseBoardPackSubject('canvas_frame', 'sess-1')).toBeNull();
    expect(parseBoardPackSubject('canvas_frame', 'sess-1:')).toBeNull();
    expect(parseBoardPackSubject('canvas_frame', ':frame-9')).toBeNull();
    expect(parseBoardPackSubject('canvas_frame', '')).toBeNull();
  });

  it('keeps a uuid frame id intact when the session id also contains hyphens', () => {
    const sessionId = '11111111-2222-3333-4444-555555555555';
    const frameId = '66666666-7777-8888-9999-000000000000';
    expect(parseBoardPackSubject('canvas_frame', boardPackSubjectRef(sessionId, frameId)))
      .toEqual({ sessionId, frameId });
  });
});
