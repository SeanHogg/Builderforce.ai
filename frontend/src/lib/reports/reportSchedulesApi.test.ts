import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn() }));

import { apiRequest } from '@/lib/apiClient';
import { invalidateClientCache } from '@/infrastructure/http/readThrough';
import { boardPackSessionId, parseRecipients, reportSchedulesApi } from './reportSchedulesApi';

const request = vi.mocked(apiRequest);

const row = {
  id: 's1', reportType: 'board_pack', schedule: 'monthly', deliveryHour: 9,
  recipients: '["cfo@x.co","board@x.co"]', isEnabled: true,
  subjectKind: 'canvas_frame', subjectRef: 'sess-1:frame-1',
  lastRunAt: null, nextRunAt: '2026-11-01T09:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};

beforeEach(() => {
  request.mockReset();
  invalidateClientCache('report-schedules:');
});

describe('parseRecipients', () => {
  it('reads the JSON text column, an array, or nothing', () => {
    expect(parseRecipients('["a@x.co"]')).toEqual(['a@x.co']);
    expect(parseRecipients(['a@x.co'])).toEqual(['a@x.co']);
    expect(parseRecipients(null)).toEqual([]);
    expect(parseRecipients('not json')).toEqual([]);
    expect(parseRecipients('{"a":1}')).toEqual([]);
  });
});

describe('boardPackSessionId', () => {
  it('is the part of the subject before the first colon', () => {
    expect(boardPackSessionId('sess-1:frame-1')).toBe('sess-1');
    expect(boardPackSessionId('no-colon')).toBeNull();
    expect(boardPackSessionId(null)).toBeNull();
  });
});

describe('reportSchedulesApi', () => {
  it('normalises recipients from the list route and serves repeat reads from cache', async () => {
    request.mockResolvedValue({ schedules: [row] });
    const first = await reportSchedulesApi.list();
    const second = await reportSchedulesApi.list();
    expect(first[0].recipients).toEqual(['cfo@x.co', 'board@x.co']);
    expect(second).toBe(first);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/api/reports/schedules');
  });

  it('invalidates the list after a create, update and delete', async () => {
    request.mockResolvedValueOnce({ schedules: [] });
    await reportSchedulesApi.list();

    request.mockResolvedValueOnce(row);
    await reportSchedulesApi.create({
      reportType: 'board_pack', schedule: 'monthly', deliveryHour: 9, recipients: ['cfo@x.co'],
      subjectKind: 'canvas_frame', subjectRef: 'sess-1:frame-1',
    });
    expect(request).toHaveBeenLastCalledWith('/api/reports/schedules', expect.objectContaining({ method: 'POST' }));

    request.mockResolvedValueOnce({ schedules: [row] });
    expect(await reportSchedulesApi.list()).toHaveLength(1);

    request.mockResolvedValueOnce({ ...row, isEnabled: false });
    const updated = await reportSchedulesApi.update('s1', { isEnabled: false });
    expect(updated.recipients).toEqual(['cfo@x.co', 'board@x.co']);
    expect(request).toHaveBeenLastCalledWith('/api/reports/schedules/s1', expect.objectContaining({ method: 'PATCH', body: '{"isEnabled":false}' }));

    request.mockResolvedValueOnce({ deleted: true });
    await reportSchedulesApi.remove('s1');
    expect(request).toHaveBeenLastCalledWith('/api/reports/schedules/s1', { method: 'DELETE' });

    request.mockResolvedValueOnce({ schedules: [] });
    expect(await reportSchedulesApi.list()).toEqual([]);
  });

  it('reads a board\'s schedulable frames with the session id encoded', async () => {
    request.mockResolvedValue({ frames: [{ id: 'f1', title: 'Q3', tileCount: 4, subjectKind: 'canvas_frame', subjectRef: 'a b:f1' }] });
    const frames = await reportSchedulesApi.boardPackFrames('a b');
    expect(frames).toHaveLength(1);
    expect(request).toHaveBeenCalledWith('/api/reports/schedules/board-pack/frames?sessionId=a%20b');
  });
});
