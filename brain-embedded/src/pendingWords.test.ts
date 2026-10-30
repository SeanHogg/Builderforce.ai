import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetPendingWords, pendingWordsOf, rememberPendingWords, replayPendingWords } from './pendingWords';
import { drainRunSteering, queueRunSteering, resetRunSteering } from './runSteering';

/**
 * "Your message is kept" is true because words the run will save are on the DEVICE the moment they are queued, until
 * they are saved - so a reload before the (bounded) network save lands finds them and saves them under the SAME key.
 */
beforeEach(() => {
  localStorage.clear();
  resetRunSteering();
});

describe('the journal of unsaved words', () => {
  it('queueing words the run will save writes them to the device, under their key; a steer that is already saved is not journaled', () => {
    queueRunSteering(9601, 'unsaved words', { fromPerson: true, persist: true });
    queueRunSteering(9601, 'already saved', { fromPerson: true, saved: true });

    const [kept] = drainRunSteering(9601);
    expect(pendingWordsOf(9601)).toEqual([{ eventKey: kept!.eventKey, text: 'unsaved words' }]);
  });

  it('forgetting by key removes only those', () => {
    rememberPendingWords(9602, 'k1', 'one');
    rememberPendingWords(9602, 'k2', 'two');
    forgetPendingWords(9602, ['k1', undefined]);
    expect(pendingWordsOf(9602)).toEqual([{ eventKey: 'k2', text: 'two' }]);
  });
});

describe('replayPendingWords - after a reload', () => {
  it('saves words an EARLIER page load left, under their keys, and clears them; this load\'s own words are left to its inbox', async () => {
    // Words left by an earlier page load (another session).
    localStorage.setItem('bf:pendingWords:9603', JSON.stringify([{ eventKey: 'steer:old', text: 'left by the last session', session: 'an-earlier-load' }]));
    rememberPendingWords(9603, 'steer:mine', 'still in this load\'s inbox');
    const sendMessages = vi.fn(async () => [] as never);

    const saved = await replayPendingWords(9603, { sendMessages });

    expect(saved).toBe(1);
    expect(sendMessages).toHaveBeenCalledWith(9603, [{ role: 'user', content: 'left by the last session', eventKey: 'steer:old' }]);
    expect(pendingWordsOf(9603)).toEqual([{ eventKey: 'steer:mine', text: 'still in this load\'s inbox' }]);
  });

  it('a save that fails leaves the words for the next open - never lost, never throws', async () => {
    localStorage.setItem('bf:pendingWords:9604', JSON.stringify([{ eventKey: 'steer:old', text: 'unsaved', session: 'an-earlier-load' }]));
    const sendMessages = vi.fn(async () => { throw new Error('offline'); });

    await expect(replayPendingWords(9604, { sendMessages })).resolves.toBe(0);

    expect(pendingWordsOf(9604)).toEqual([{ eventKey: 'steer:old', text: 'unsaved' }]);
  });
});
