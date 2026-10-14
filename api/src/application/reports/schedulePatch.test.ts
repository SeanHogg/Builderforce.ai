import { describe, expect, it } from 'vitest';
import { boardPackSubjectToVerify, reportSchedulePatchSet } from './schedulePatch';

const standup = {
  reportType: 'standup',
  subjectKind: null as string | null,
  subjectRef: null as string | null,
};

const boardPack = {
  reportType: 'board_pack',
  subjectKind: 'canvas_frame',
  subjectRef: 'sess-1:frame-a',
};

describe('reportSchedulePatchSet', () => {
  it('delivery-only patch does not mention reportType or subject', () => {
    const result = reportSchedulePatchSet(standup, { deliveryHour: 9, isEnabled: false });
    expect(result).toEqual({ set: { deliveryHour: 9, isEnabled: false } });
    expect('error' in result ? null : boardPackSubjectToVerify(result.set)).toBeNull();
  });

  it('serialises recipients the same way create does', () => {
    const result = reportSchedulePatchSet(standup, { recipients: ['a@x.com', 'b@y.com'] });
    expect(result).toEqual({ set: { recipients: '["a@x.com","b@y.com"]' } });
  });

  it('rejects an unknown reportType', () => {
    expect(reportSchedulePatchSet(standup, { reportType: 'weekly_digest' })).toEqual({
      error: 'reportType must be one of standup, code_review, project_status, executive_summary, portfolio_rollup, board_pack',
    });
  });

  it('rejects a board_pack patch with no parseable frame', () => {
    expect(reportSchedulePatchSet(standup, { reportType: 'board_pack' })).toEqual({
      error: 'A board_pack schedule needs subjectKind "canvas_frame" and subjectRef "<sessionId>:<frameId>"',
    });
    expect(reportSchedulePatchSet(boardPack, { subjectRef: 'not-a-frame' })).toEqual({
      error: 'A board_pack schedule needs subjectKind "canvas_frame" and subjectRef "<sessionId>:<frameId>"',
    });
  });

  it('rejects a subject on a non-board_pack schedule', () => {
    expect(reportSchedulePatchSet(standup, { subjectKind: 'canvas_frame', subjectRef: 's:f' })).toEqual({
      error: 'subjectKind/subjectRef only apply to board_pack schedules',
    });
  });

  it('accepts a switch to board_pack when the frame is parseable', () => {
    const result = reportSchedulePatchSet(standup, {
      reportType: 'board_pack',
      subjectKind: 'canvas_frame',
      subjectRef: 'sess-2:frame-b',
    });
    expect(result).toEqual({
      set: {
        reportType: 'board_pack',
        subjectKind: 'canvas_frame',
        subjectRef: 'sess-2:frame-b',
      },
    });
    expect('error' in result ? null : boardPackSubjectToVerify(result.set)).toEqual({
      sessionId: 'sess-2',
      frameId: 'frame-b',
    });
  });

  it('retargets an existing board_pack frame', () => {
    const result = reportSchedulePatchSet(boardPack, { subjectRef: 'sess-1:frame-b' });
    expect(result).toEqual({
      set: {
        subjectKind: 'canvas_frame',
        subjectRef: 'sess-1:frame-b',
      },
    });
  });

  it('clears the subject when leaving board_pack', () => {
    const result = reportSchedulePatchSet(boardPack, { reportType: 'executive_summary' });
    expect(result).toEqual({
      set: {
        reportType: 'executive_summary',
        subjectKind: null,
        subjectRef: null,
      },
    });
    expect('error' in result ? null : boardPackSubjectToVerify(result.set)).toBeNull();
  });

  it('omitted fields stay out of the set so drizzle does not null them', () => {
    const result = reportSchedulePatchSet(boardPack, { isEnabled: true });
    expect(result).toEqual({ set: { isEnabled: true } });
    expect('error' in result || 'reportType' in result.set).toBe(false);
  });
});
