import { describe, expect, it } from 'vitest';
import { stageSend, stopReaches, type SendStage } from './stageSend';

const fetched = (block = 'limbic') => async () => block;

describe('stageSend - the wait before the editor chat sends', () => {
  it('is ready with the fetched block when nothing changed', async () => {
    await expect(stageSend({ startedIn: 5, currentChat: () => 5, stopped: () => false, fetchBlock: fetched('affect') })).resolves.toEqual({ ready: true, block: 'affect' });
  });

  it('is NOT ready when the person switched chats while the block was being fetched: a turn is never sent into another chat', async () => {
    let showing = 5;
    const fetchBlock = async () => { showing = 6; return 'late'; }; // the switch lands during the (up to 4 s) fetch
    await expect(stageSend({ startedIn: 5, currentChat: () => showing, stopped: () => false, fetchBlock })).resolves.toEqual({ ready: false, why: 'switched' });
  });

  it('is NOT ready when a Stop landed during the fetch (and a Stop outranks a switch)', async () => {
    await expect(stageSend({ startedIn: 5, currentChat: () => 6, stopped: () => true, fetchBlock: fetched() })).resolves.toEqual({ ready: false, why: 'stopped' });
  });

  it('a chat that did not exist yet (null) and still does not is the same chat', async () => {
    await expect(stageSend({ startedIn: null, currentChat: () => null, stopped: () => false, fetchBlock: fetched() })).resolves.toMatchObject({ ready: true });
  });
});

describe('stopReaches - which staged send a Stop is for', () => {
  const d1: SendStage = { chat: null, draft: 1, stopped: false };
  const inChat5: SendStage = { chat: 5, draft: undefined, stopped: false };

  it("a Stop on chat 50, or back on a new draft with another token, is not draft 1's", () => {
    expect(stopReaches(d1, 50, undefined)).toBe(false); // the person opened chat 50 and pressed Stop
    expect(stopReaches(d1, null, 2)).toBe(false); // a new draft (its own token) is showing
    expect(stopReaches(d1, 5, undefined)).toBe(false);
  });

  it("a Stop on the draft's own view reaches it, and a chat's Stop reaches that chat's sends", () => {
    expect(stopReaches(d1, null, 1)).toBe(true);
    expect(stopReaches(inChat5, 5, undefined)).toBe(true);
    expect(stopReaches(inChat5, null, 1)).toBe(false);
    expect(stopReaches(inChat5, 50, undefined)).toBe(false);
  });
});
