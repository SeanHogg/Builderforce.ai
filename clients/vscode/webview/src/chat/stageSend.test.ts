import { describe, expect, it } from 'vitest';
import { stageSend } from './stageSend';

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
