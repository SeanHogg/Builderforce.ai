/**
 * The container's live-preview dev server (`container/previewProcess.mjs`): its output
 * reaches a bounded ring of whole lines, and a restart kills the running group and
 * starts the same command again — without the killed child reporting over its successor.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createLogRing, createPreviewProcess, type SpawnedChild } from '../../../container/previewProcess.mjs';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & SpawnedChild & { stdout: EventEmitter; stderr: EventEmitter };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = () => undefined;
  return child;
}

describe('createLogRing', () => {
  it('keeps whole lines across chunks, the newest last', () => {
    const ring = createLogRing({ maxLines: 3, maxLineChars: 100 });
    ring.push('a\nb');
    ring.push('c\nd\ne\npart');
    expect(ring.tail(10)).toEqual(['bc', 'd', 'e', 'part']);
    expect(ring.tail(2)).toEqual(['e', 'part']);
  });

  it('caps a line and drops the oldest past the bound', () => {
    const ring = createLogRing({ maxLines: 2, maxLineChars: 4 });
    ring.push('abcdefgh\n1\n2\n');
    expect(ring.tail(5)).toEqual(['1', '2']);
    const capped = createLogRing({ maxLines: 5, maxLineChars: 4 });
    capped.push('abcdefgh\n');
    expect(capped.tail(1)).toEqual(['abcd…']);
  });
});

describe('createPreviewProcess', () => {
  it('captures stdout and stderr and reports an exit', () => {
    const child = fakeChild();
    const proc = createPreviewProcess({ command: 'npm run dev', cwd: '/w', spawn: () => child, kill: vi.fn() });
    proc.start();
    child.stdout.emit('data', Buffer.from('VITE ready\n'));
    child.stderr.emit('data', 'Error: boom\n');
    expect(proc.running()).toBe(true);
    child.emit('exit', 1, null);
    expect(proc.exitCode()).toBe(1);
    expect(proc.tail(10)).toEqual(expect.arrayContaining(['VITE ready', 'Error: boom', '[builderforce] the dev server exited (1)']));
  });

  it('restarts: kills the running group, spawns the same command, ignores the old child’s exit', () => {
    const children = [fakeChild(), fakeChild()];
    const spawn = vi.fn(() => children[spawn.mock.calls.length - 1]!);
    const kill = vi.fn();
    const proc = createPreviewProcess({ command: 'npm run dev', cwd: '/w', extraEnv: { PORT: '5173' }, spawn, kill });
    proc.start();
    proc.restart();
    expect(kill).toHaveBeenCalledWith(children[0]);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenLastCalledWith('npm run dev', { cwd: '/w', extraEnv: { PORT: '5173' }, stdio: ['ignore', 'pipe', 'pipe'] });
    children[0]!.emit('exit', null, 'SIGKILL');
    expect(proc.running()).toBe(true);
    expect(proc.exitCode()).toBeNull();
  });

  it('does not kill a dev server that already exited', () => {
    const children = [fakeChild(), fakeChild()];
    const spawn = vi.fn(() => children[spawn.mock.calls.length - 1]!);
    const kill = vi.fn();
    const proc = createPreviewProcess({ command: 'x', cwd: '/w', spawn, kill });
    proc.start();
    children[0]!.emit('exit', 1, null);
    proc.restart();
    expect(kill).not.toHaveBeenCalled();
  });
});
