import { describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useQueuedTurns, type QueuedTurns } from './useQueuedTurns';

/**
 * The rule under test is the one every composer in the product depends on: a run
 * in flight NEVER refuses input. What it does instead is hold the turn and send
 * it on the run's falling edge â€” exactly one per completed run, so two turns can
 * never race the same conversation.
 */
interface Props { running: boolean; resetKey?: string; send: (text: string) => void }

function setup(send = vi.fn()) {
  const current: { value: QueuedTurns | null } = { value: null };
  function Probe({ running, resetKey, send: s }: Props) {
    current.value = useQueuedTurns({ running, send: s, resetKey });
    return null;
  }
  const el = document.createElement('div');
  let root: Root;
  act(() => { root = createRoot(el); root.render(<Probe running={false} resetKey="chat-1" send={send} />); });
  const rerender = (p: { running: boolean; resetKey?: string }) =>
    act(() => { root.render(<Probe {...p} send={send} />); });
  const q = () => current.value!;
  return { q, rerender, send };
}

describe('useQueuedTurns', () => {
  it('sends immediately when nothing is running', () => {
    const { q, send } = setup();
    let held = true;
    act(() => { held = q().submit('first'); });
    expect(held).toBe(false);
    expect(q().count).toBe(0);
    expect(send).not.toHaveBeenCalled(); // the caller sends; the queue only says "not mine"
  });

  it('holds a turn typed mid-run and flushes it when the run finishes', () => {
    const { q, rerender, send } = setup();
    rerender({ running: true, resetKey: 'chat-1' });

    let held = false;
    act(() => { held = q().submit('while thinking'); });
    expect(held).toBe(true);
    expect(q().count).toBe(1);
    expect(send).not.toHaveBeenCalled();

    rerender({ running: false, resetKey: 'chat-1' });
    expect(send).toHaveBeenCalledWith('while thinking');
    expect(q().count).toBe(0);
  });

  it('flushes exactly one turn per completed run', () => {
    const { q, rerender, send } = setup();
    rerender({ running: true, resetKey: 'chat-1' });
    act(() => { q().submit('one'); q().submit('two'); });
    expect(q().count).toBe(2);

    rerender({ running: false, resetKey: 'chat-1' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith('one');
    expect(q().count).toBe(1);

    // The flushed turn starts its own run; the next falling edge releases the rest.
    rerender({ running: true, resetKey: 'chat-1' });
    rerender({ running: false, resetKey: 'chat-1' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('two');
    expect(q().count).toBe(0);
  });

  it('drops everything held when the run is stopped', () => {
    const { q, rerender, send } = setup();
    rerender({ running: true, resetKey: 'chat-1' });
    act(() => { q().submit('queued behind a stopped run'); });

    act(() => { q().clear(); });
    rerender({ running: false, resetKey: 'chat-1' });

    expect(q().count).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('discards held turns when the conversation changes', () => {
    const { q, rerender, send } = setup();
    rerender({ running: true, resetKey: 'chat-1' });
    act(() => { q().submit('meant for chat 1'); });

    rerender({ running: true, resetKey: 'chat-2' });
    rerender({ running: false, resetKey: 'chat-2' });

    expect(send).not.toHaveBeenCalled();
    expect(q().count).toBe(0);
  });

  it('never flushes a held turn into the conversation switched to mid-run', () => {
    const { q, rerender, send } = setup();
    rerender({ running: true, resetKey: 'chat-1' });
    act(() => { q().submit('meant for chat 1'); });

    // Switching away from a running chat drops `running` in the SAME render the key
    // changes — that is not the run finishing.
    rerender({ running: false, resetKey: 'chat-2' });

    expect(send).not.toHaveBeenCalled();
    expect(q().count).toBe(0);
  });

  it('lists held turns with ids and removes one by id', () => {
    const { q, rerender, send } = setup();
    rerender({ running: true, resetKey: 'chat-1' });
    act(() => { q().submit('one'); q().submit('two'); });
    expect(q().items.map((i) => i.value)).toEqual(['one', 'two']);

    const firstId = q().items[0]!.id;
    act(() => { q().remove(firstId); });
    expect(q().items.map((i) => i.value)).toEqual(['two']);

    rerender({ running: false, resetKey: 'chat-1' });
    expect(send).toHaveBeenCalledWith('two');
  });

  it('queues a richer turn and blank-checks it through textOf', () => {
    interface Turn { text: string; to: string | null }
    const current: { value: QueuedTurns<Turn> | null } = { value: null };
    const send = vi.fn();
    function TurnProbe({ running }: { running: boolean }) {
      current.value = useQueuedTurns<Turn>({ running, send, resetKey: 7, textOf: (t) => t.text });
      return null;
    }
    const el = document.createElement('div');
    let root: Root;
    act(() => { root = createRoot(el); root.render(<TurnProbe running />); });

    let blank = true;
    act(() => { blank = current.value!.submit({ text: '  ', to: null }); });
    expect(blank).toBe(false);
    act(() => { current.value!.submit({ text: 'hi agent', to: 'agent-3' }); });
    expect(current.value!.items[0]!.value).toEqual({ text: 'hi agent', to: 'agent-3' });

    act(() => { root.render(<TurnProbe running={false} />); });
    expect(send).toHaveBeenCalledWith({ text: 'hi agent', to: 'agent-3' });
  });

  it('ignores blank input', () => {
    const { q, rerender } = setup();
    rerender({ running: true, resetKey: 'chat-1' });
    let held = true;
    act(() => { held = q().submit('   '); });
    expect(held).toBe(false);
    expect(q().count).toBe(0);
  });
});
