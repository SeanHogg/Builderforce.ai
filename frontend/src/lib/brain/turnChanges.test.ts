import { describe, it, expect } from 'vitest';
import { turnChangedFiles } from './turnChanges';

const user = (id: number) => ({ id, role: 'user', metadata: null });
const reply = (id: number) => ({ id, role: 'assistant', metadata: null });
const step = (id: number, result: unknown, isError = false) => ({
  id,
  role: 'tool',
  metadata: JSON.stringify({ kind: 'step', category: 'tool', label: 'canvas_write_build_file', result, isError }),
});

describe('turnChangedFiles', () => {
  it('collects the paths a turn committed, once each, in order', () => {
    const messages = [
      user(1),
      reply(2),
      step(3, { ok: true, applied: true, path: 'src/App.jsx', bytes: 10 }),
      step(4, JSON.stringify({ ok: true, applied: true, path: 'src/index.css' })),
      step(5, { ok: true, applied: true, path: 'src/App.jsx' }),
      step(6, { created: 'index.html' }),
    ];
    expect(turnChangedFiles(messages, 2)).toEqual(['src/App.jsx', 'src/index.css', 'index.html']);
  });

  it('ignores reads, failures and errors', () => {
    const messages = [
      user(1),
      step(2, { path: 'src/App.jsx', content: '…' }),
      step(3, { ok: true, applied: true, path: 'a.js' }, true),
      step(4, { error: 'A path is required.' }),
      reply(5),
    ];
    expect(turnChangedFiles(messages, 5)).toEqual([]);
  });

  it('belongs to the last reply of a turn only, and stops at the next user message', () => {
    const messages = [
      user(1),
      reply(2),
      step(3, { applied: true, path: 'one.js' }),
      reply(4),
      user(5),
      reply(6),
      step(7, { applied: true, path: 'two.js' }),
    ];
    expect(turnChangedFiles(messages, 2)).toBeNull();
    expect(turnChangedFiles(messages, 4)).toEqual(['one.js']);
    expect(turnChangedFiles(messages, 6)).toEqual(['two.js']);
  });

  it('is null for a message it cannot find', () => {
    expect(turnChangedFiles([user(1)], 99)).toBeNull();
  });
});
