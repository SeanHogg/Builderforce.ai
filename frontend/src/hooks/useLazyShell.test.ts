import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLazyShell } from './useLazyShell';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeWriter() {
  const written: string[] = [];
  return { written, writer: { write: vi.fn(async (data: string) => { written.push(data); }) } as unknown as WritableStreamDefaultWriter<string> };
}

describe('useLazyShell', () => {
  it('starts nothing until the first keystroke', () => {
    const startShell = vi.fn();
    renderHook(() => useLazyShell(startShell, () => {}));
    expect(startShell).not.toHaveBeenCalled();
  });

  it('starts the shell once and delivers keystrokes typed while it boots, in order', async () => {
    const { written, writer } = fakeWriter();
    let resolve!: (w: WritableStreamDefaultWriter<string>) => void;
    const startShell = vi.fn(() => new Promise<WritableStreamDefaultWriter<string>>((r) => { resolve = r; }));
    const { result } = renderHook(() => useLazyShell(startShell, () => {}));

    result.current('l');
    result.current('s');
    resolve(writer);
    await flush();
    result.current('\r');

    expect(startShell).toHaveBeenCalledTimes(1);
    expect(written).toEqual(['l', 's', '\r']);
  });

  it('shows a failed start in the terminal and retries on the next keystroke', async () => {
    const output: string[] = [];
    const { written, writer } = fakeWriter();
    const startShell = vi.fn()
      .mockRejectedValueOnce(new Error('boot failed'))
      .mockResolvedValueOnce(writer);
    const { result } = renderHook(() => useLazyShell(startShell, (d) => output.push(d)));

    result.current('a');
    await flush();
    expect(output.join('')).toContain('boot failed');

    result.current('b');
    await flush();
    expect(startShell).toHaveBeenCalledTimes(2);
    expect(written).toEqual(['b']);
  });
});
