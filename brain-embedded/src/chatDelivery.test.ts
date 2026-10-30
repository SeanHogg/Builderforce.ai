import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverToChat, dropWaiting, releaseChat } from './chatDelivery';
import { installRunDriver, type BrainRunDriver } from './runDriver';
import { drainRunSteering, hasRunInterrupt, resetRunSteering } from './runSteering';
import { resetBrainRunStore } from './runStore/runControl';
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

    expect((driver.steer as ReturnType<typeof vi.fn>).mock.calls.map((c) => [c[0], c[1]])).toEqual([[44, 'B'], [44, 'C']]);
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
    dropWaiting(47);
    mirrorRun(47, false);
    expect(texts(47)).toEqual([]);
  });

  it('turns for one chat never reach another\'s run', () => {
    deliverToChat(48, [steer('for 48')]);
    mirrorRun(49, true);
    expect(texts(49)).toEqual([]);
    mirrorRun(48, true);
    expect(texts(48)).toEqual(['for 48']);
  });
});
