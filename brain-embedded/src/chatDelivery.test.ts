import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverToChat, forgetChatDelivery, handToChat, releaseChat, removeWaiting, subscribeWaiting, takeBackWaiting, waitingFor } from './chatDelivery';
import { installRunDriver, type BrainRunDriver } from './runDriver';
import { drainRunSteering, hasRunInterrupt, resetRunSteering } from './runSteering';
import { resetBrainRunStore, stopRun } from './runStore/runControl';
import { mirrorRun } from './test/mirrorRun';

const texts = (chat: number) => drainRunSteering(chat).map((m) => m.text);
const steer = (text: string) => ({ text, steer: true });
const after = (text: string) => ({ text, steer: false });

afterEach(() => {
  installRunDriver(null);
  resetBrainRunStore();
  resetRunSteering();
});

describe('chatDelivery - turns for a chat\'s run, keyed by the chat', () => {
  it('waits for a run that is not live yet, then steers into it in order the moment it goes live', () => {
    deliverToChat(41, [steer('B'), steer('C')]);
    expect(texts(41)).toEqual([]); // no run is reading yet

    mirrorRun(41, true);

    expect(hasRunInterrupt(41)).toBe(true);
    expect(texts(41)).toEqual(['B', 'C']);
    mirrorRun(41, false);
    expect(texts(41)).toEqual([]); // delivered once
  });

  it('a chat whose run is already live hears them at once', () => {
    mirrorRun(42, true);
    deliverToChat(42, [steer('now')]);
    expect(texts(42)).toEqual(['now']);
  });

  it('a turn held for AFTER the run waits for its falling edge and is then the chat\'s next turn - and holds what is behind it', () => {
    deliverToChat(43, [steer('first'), after('later'), steer('behind later')]);
    mirrorRun(43, true);
    expect(texts(43)).toEqual(['first']); // the steer before it goes; the one behind it must not jump it

    mirrorRun(43, false); // the run ended: the rest is the chat's next turn (nothing can wake it here: saved in its inbox)

    expect(texts(43)).toEqual(['later', 'behind later']);
  });

  it('with the run driver installed the words go through the driver\'s chat-keyed steer, never the in-page inbox', () => {
    const driver = { start: vi.fn(), stop: vi.fn(), confirm: vi.fn(), clearError: vi.fn(), steer: vi.fn() } as unknown as BrainRunDriver;
    installRunDriver(driver);
    deliverToChat(44, [steer('B'), steer('C')]);
    mirrorRun(44, true);

    const calls = (driver.steer as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1); // ONE call carries both turns, in order
    expect(calls[0]![0]).toBe(44);
    expect(calls[0]![1].map((turn: { text: string }) => turn.text)).toEqual(['B', 'C']);
    expect(calls[0]![1].every((turn: { eventKey: string }) => turn.eventKey.length > 0)).toBe(true);
    expect(texts(44)).toEqual([]);
  });

  it('release: nothing is coming to start the run - the turns are the chat\'s next turn, never left waiting for a run that will not come', () => {
    deliverToChat(45, [steer('B'), after('C')]);
    expect(texts(45)).toEqual([]);

    releaseChat(45);

    expect(texts(45)).toEqual(['B', 'C']);
    expect(hasRunInterrupt(45)).toBe(false); // no run to interrupt
  });

  it('release while the run is live leaves the rest to its falling edge', () => {
    deliverToChat(46, [steer('B'), after('C')]);
    mirrorRun(46, true);
    releaseChat(46);
    expect(texts(46)).toEqual(['B']);
    mirrorRun(46, false);
    expect(texts(46)).toEqual(['C']);
  });

  it('a Stop on the chat drops what waited for its run: the falling edge wakes nothing', () => {
    deliverToChat(47, [steer('B'), after('C')]);
    mirrorRun(47, true);
    drainRunSteering(47);
    stopRun(47); // the store's Stop seam: every entry point to Stop reaches it
    mirrorRun(47, false);
    expect(texts(47)).toEqual([]);
  });

  it('a Stop on the chat drops what waited even before its run was ever live', () => {
    deliverToChat(50, [steer('B')]);
    stopRun(50);
    expect(waitingFor(50)).toEqual([]);
    mirrorRun(50, true);
    expect(texts(50)).toEqual([]);
  });

  it('what waits is visible (oldest first, with a negative id and the host\'s own turn) and a change is announced', () => {
    const seen = vi.fn();
    const off = subscribeWaiting(seen);
    deliverToChat(51, [{ text: 'B', steer: true, turn: { text: 'B', to: null } }, after('C')]);
    expect(waitingFor(51).map((w) => [w.text, w.steer, w.turn])).toEqual([['B', true, { text: 'B', to: null }], ['C', false, undefined]]);
    expect(waitingFor(51).every((w) => w.id < 0)).toBe(true);
    expect(seen).toHaveBeenCalled();
    off();
  });

  it('removing a waiting turn means it is never delivered; removing the last forgets the chat', () => {
    deliverToChat(52, [steer('B'), steer('C')]);
    removeWaiting(waitingFor(52)[0]!.id);
    expect(waitingFor(52).map((w) => w.text)).toEqual(['C']);
    removeWaiting(waitingFor(52)[0]!.id);
    expect(waitingFor(52)).toEqual([]);
    mirrorRun(52, true);
    expect(texts(52)).toEqual([]);
  });

  it('take-back: while the run was never live the waiting turns are returned (and forgotten); once it has been live there is nothing to take back', () => {
    deliverToChat(53, [steer('B'), after('C')]);
    expect(takeBackWaiting(53).map((w) => w.text)).toEqual(['B', 'C']);
    expect(waitingFor(53)).toEqual([]);
    mirrorRun(53, true);
    expect(texts(53)).toEqual([]);

    deliverToChat(54, [after('later')]);
    mirrorRun(54, true);
    expect(takeBackWaiting(54)).toEqual([]);
  });

  it('a deleted chat forgets what waited for it, and a store reset forgets every chat', () => {
    deliverToChat(55, [steer('B')]);
    forgetChatDelivery(55);
    expect(waitingFor(55)).toEqual([]);
    mirrorRun(55, true);
    expect(texts(55)).toEqual([]);

    deliverToChat(56, [steer('B')]);
    resetBrainRunStore();
    expect(waitingFor(56)).toEqual([]);
  });

  it('handToChat is the one rule: through the driver in ONE steer call when the run executes elsewhere, else the chat\'s inbox', () => {
    const driver = { start: vi.fn(), stop: vi.fn(), confirm: vi.fn(), clearError: vi.fn(), steer: vi.fn() } as unknown as BrainRunDriver;
    installRunDriver(driver);
    handToChat(57, [{ text: 'one' }, { text: 'two', attachments: [{ key: 'k', name: 'a.png', type: 'image/png' }] }]);
    const sent = (driver.steer as ReturnType<typeof vi.fn>).mock.calls;
    expect(sent).toHaveLength(1);
    expect(sent[0]![1].map((turn: { text: string }) => turn.text)).toEqual(['one', 'two']);
    expect(sent[0]![1][1].attachments).toHaveLength(1);
    expect(texts(57)).toEqual([]);

    installRunDriver(null);
    handToChat(58, [{ text: 'one' }, { text: 'two' }]);
    expect(texts(58)).toEqual(['one', 'two']);
  });

  it('turns for one chat never reach another\'s run', () => {
    deliverToChat(48, [steer('for 48')]);
    mirrorRun(49, true);
    expect(texts(49)).toEqual([]);
    mirrorRun(48, true);
    expect(texts(48)).toEqual(['for 48']);
  });
});
