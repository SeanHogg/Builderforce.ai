import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasObject, CreationObjectKind } from '@/domains/canvas/domain/canvasObject';
import type { CeremonyMinutesToCanvasResult } from '@/lib/builderforceApi';
import { minutesSyncNotice, pullStandupMinutesAct } from './ceremonyActs';

const { minutesToCanvas } = vi.hoisted(() => ({
  minutesToCanvas: vi.fn<(id: string) => Promise<CeremonyMinutesToCanvasResult>>(),
}));
vi.mock('@/lib/builderforceApi', () => ({ ceremonySessionsApi: { minutesToCanvas } }));

const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}:${JSON.stringify(values)}` : key);

function standup(data: Record<string, unknown> = {}): CanvasObject {
  return { id: 'card', type: 'creation', position: { x: 0, y: 0 }, data: { kind: 'standup' as CreationObjectKind, title: 'Daily', ...data } };
}

const run = (object: CanvasObject) =>
  pullStandupMinutesAct.run({ object, action: 'minutes', t, board: { objects: [object], create: () => object } });

const synced = (patch: Partial<Extract<CeremonyMinutesToCanvasResult, { status: 'synced' }>>): CeremonyMinutesToCanvasResult =>
  ({ status: 'synced', boards: 1, written: 1, placed: 0, updated: 0, removed: 0, actionItems: 0, ...patch });

describe('pullStandupMinutesAct', () => {
  beforeEach(() => minutesToCanvas.mockReset());

  it('refuses a card that was never convened without calling the server', async () => {
    expect((await run(standup())).notice).toBe('noticeStandupNeverConvened');
    expect(minutesToCanvas).not.toHaveBeenCalled();
  });

  it('asks the server to write the minutes back — it places nothing itself', async () => {
    minutesToCanvas.mockResolvedValue(synced({ placed: 2, actionItems: 2 }));
    const outcome = await run(standup({ resourceId: 'ceremony:abc' }));
    expect(minutesToCanvas).toHaveBeenCalledWith('abc');
    expect(outcome.notice).toBe('noticeStandupActionItemsPlaced:{"count":2}');
    // ONE writer: the follow-ups arrive through `canvas.changed`, never from the act.
    expect(outcome.add).toBeUndefined();
  });
});

describe('minutesSyncNotice', () => {
  it('names every refusal', () => {
    expect(minutesSyncNotice({ status: 'still_running' }, t)).toBe('noticeStandupStillRunning');
    expect(minutesSyncNotice({ status: 'no_meeting' }, t)).toBe('noticeStandupNoMeeting');
    expect(minutesSyncNotice({ status: 'not_summarized' }, t)).toBe('noticeStandupNotSummarized');
    expect(minutesSyncNotice({ status: 'nothing_captured' }, t)).toBe('noticeStandupNothingCaptured');
    expect(minutesSyncNotice({ status: 'not_found' }, t)).toBe('noticeStandupNeverConvened');
  });

  it('distinguishes an unsaved board, no action items, and a re-run that found them already there', () => {
    expect(minutesSyncNotice(synced({ boards: 0 }), t)).toBe('noticeStandupNotOnSavedBoard');
    expect(minutesSyncNotice(synced({}), t)).toBe('noticeStandupNoActionItems');
    expect(minutesSyncNotice(synced({ actionItems: 3, written: 0 }), t)).toBe('noticeStandupActionItemsAlreadyOnBoard:{"count":3}');
  });
});
