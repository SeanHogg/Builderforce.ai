import { describe, expect, it } from 'vitest';
import { createMemoryRecords } from '../store/records';
import { createActionLedger, LEDGER_DETAIL_MAX } from './ledger';

describe('action ledger', () => {
  const fixed = () => {
    let n = 0;
    return { now: () => new Date(Date.UTC(2026, 9, 16, 12, 0, n)), newId: () => `id-${++n}` };
  };

  it('records each action per chat, in order, and returns the stamp the step row carries', async () => {
    const records = createMemoryRecords();
    const ledger = createActionLedger(records, fixed());
    const stamp = await ledger.record(-1, { tool: 'browser_click', target: 'Next', tabId: 7, url: 'https://a.example/', outcome: 'done', detail: 'clicked e1' });
    await ledger.record(-1, { tool: 'browser_type', target: 'Email', tabId: 7, url: 'https://a.example/', outcome: 'failed', detail: 'gone' });
    await ledger.record(-2, { tool: 'browser_read_page', target: 'page', tabId: 9, url: 'https://b.example/', outcome: 'done', detail: '' });

    expect(stamp).toEqual({ tool: 'browser_click', target: 'Next', tabId: 7, url: 'https://a.example/', outcome: 'done', at: '2026-10-16T12:00:00.000Z' });
    const first = await ledger.list(-1);
    expect(first.map((e) => [e.tool, e.outcome])).toEqual([
      ['browser_click', 'done'],
      ['browser_type', 'failed'],
    ]);
    expect((await ledger.list(-2)).map((e) => e.url)).toEqual(['https://b.example/']);
  });

  it('caps what an entry keeps, and keeps a screenshot on the device entry only', async () => {
    const records = createMemoryRecords();
    const ledger = createActionLedger(records, fixed());
    const stamp = await ledger.record(-1, {
      tool: 'browser_screenshot',
      target: 'x'.repeat(400),
      tabId: 1,
      url: 'https://a.example/',
      outcome: 'done',
      detail: 'y'.repeat(LEDGER_DETAIL_MAX * 2),
      image: 'data:image/png;base64,AAAA',
    });
    const [entry] = await ledger.list(-1);
    expect(entry!.target).toHaveLength(200);
    expect(entry!.detail).toHaveLength(LEDGER_DETAIL_MAX);
    expect(entry!.image).toBe('data:image/png;base64,AAAA');
    expect(stamp).not.toHaveProperty('image');
  });

  it('tells subscribers which chat changed', async () => {
    const ledger = createActionLedger(createMemoryRecords(), fixed());
    const seen: number[] = [];
    const off = ledger.subscribe((chatId) => seen.push(chatId));
    await ledger.record(-5, { tool: 'browser_scroll', target: 'down', tabId: 1, url: '', outcome: 'done', detail: '' });
    off();
    await ledger.record(-6, { tool: 'browser_scroll', target: 'down', tabId: 1, url: '', outcome: 'done', detail: '' });
    expect(seen).toEqual([-5]);
  });
});
