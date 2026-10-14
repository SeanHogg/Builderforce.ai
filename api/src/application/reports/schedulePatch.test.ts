import { describe, expect, it, vi } from 'vitest';
import {
  BOARD_PACK_FRAME_ERROR,
  BOARD_PACK_SUBJECT_ERROR,
  boardPackScheduleError,
  reportOrSubjectChanging,
  reportSchedulePatchSet,
  resolvedReportSubject,
} from './schedulePatch';

const standup = {
  reportType: 'standup',
  subjectKind: null,
  subjectRef: null,
};

const boardPack = {
  reportType: 'board_pack',
  subjectKind: 'canvas_frame',
  subjectRef: 'sess-1:frame-9',
};

describe('reportSchedulePatchSet', () => {
  it('still writes delivery hour, recipients and enabled', () => {
    const set = reportSchedulePatchSet({
      deliveryHour: 7,
      recipients: ['lead@x.co', 'cto@x.co'],
      isEnabled: false,
    });
    expect(set.deliveryHour).toBe(7);
    expect(set.recipients).toBe(JSON.stringify(['lead@x.co', 'cto@x.co']));
    expect(set.isEnabled).toBe(false);
    expect(set.reportType).toBeUndefined();
    expect(set.subjectKind).toBeUndefined();
    expect(set.subjectRef).toBeUndefined();
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it('leaves omitted fields undefined so drizzle does not rewrite them', () => {
    const set = reportSchedulePatchSet({ deliveryHour: 9 });
    expect(set.deliveryHour).toBe(9);
    expect(set.recipients).toBeUndefined();
    expect(set.isEnabled).toBeUndefined();
    expect(set.reportType).toBeUndefined();
    expect(set.subjectKind).toBeUndefined();
    expect(set.subjectRef).toBeUndefined();
  });

  it('writes reportType and subject when they are in the patch', () => {
    const set = reportSchedulePatchSet({
      reportType: 'board_pack',
      subjectKind: 'canvas_frame',
      subjectRef: 'sess-1:frame-2',
    });
    expect(set.reportType).toBe('board_pack');
    expect(set.subjectKind).toBe('canvas_frame');
    expect(set.subjectRef).toBe('sess-1:frame-2');
    expect(set.deliveryHour).toBeUndefined();
    expect(set.recipients).toBeUndefined();
    expect(set.isEnabled).toBeUndefined();
  });

  it('writes null subject fields when the patch clears them', () => {
    const set = reportSchedulePatchSet({ subjectKind: null, subjectRef: null });
    expect(set.subjectKind).toBeNull();
    expect(set.subjectRef).toBeNull();
  });
});

describe('resolvedReportSubject', () => {
  it('keeps existing report and subject when the patch omits them', () => {
    expect(resolvedReportSubject({ deliveryHour: 9 }, boardPack)).toEqual(boardPack);
  });

  it('overlays only the named fields', () => {
    expect(resolvedReportSubject({ reportType: 'executive_summary' }, standup)).toEqual({
      reportType: 'executive_summary',
      subjectKind: null,
      subjectRef: null,
    });
    expect(resolvedReportSubject(
      { subjectKind: 'canvas_frame', subjectRef: 'sess-1:frame-2' },
      boardPack,
    )).toEqual({
      reportType: 'board_pack',
      subjectKind: 'canvas_frame',
      subjectRef: 'sess-1:frame-2',
    });
  });
});

describe('reportOrSubjectChanging', () => {
  it('is false for hour / recipients / enabled only', () => {
    expect(reportOrSubjectChanging({ deliveryHour: 7, recipients: ['a@x.co'], isEnabled: true })).toBe(false);
  });

  it('is true when report or subject is named', () => {
    expect(reportOrSubjectChanging({ reportType: 'standup' })).toBe(true);
    expect(reportOrSubjectChanging({ subjectKind: 'canvas_frame' })).toBe(true);
    expect(reportOrSubjectChanging({ subjectRef: 'sess-1:frame-2' })).toBe(true);
  });
});

describe('boardPackScheduleError', () => {
  it('lets non-board-pack reports through without listing frames', async () => {
    const listFrames = vi.fn();
    expect(await boardPackScheduleError('standup', null, null, listFrames)).toBeNull();
    expect(listFrames).not.toHaveBeenCalled();
  });

  it('refuses board_pack without a frame subject', async () => {
    expect(await boardPackScheduleError('board_pack', null, null, vi.fn())).toBe(BOARD_PACK_SUBJECT_ERROR);
  });

  it('refuses a frame that is not on a readable board', async () => {
    const listFrames = vi.fn(async () => []);
    expect(await boardPackScheduleError(
      'board_pack',
      'canvas_frame',
      'sess-1:missing',
      listFrames,
    )).toBe(BOARD_PACK_FRAME_ERROR);
    expect(listFrames).toHaveBeenCalledWith('sess-1');
  });

  it('accepts a schedulable canvas frame', async () => {
    const listFrames = vi.fn(async () => [{ id: 'frame-2' }]);
    expect(await boardPackScheduleError(
      'board_pack',
      'canvas_frame',
      'sess-1:frame-2',
      listFrames,
    )).toBeNull();
  });
});
