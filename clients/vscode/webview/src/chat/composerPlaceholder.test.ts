/**
 * Slow-typing regression guard (#6431). The composer's text lives in an external draft
 * store so a keystroke re-renders only the textarea, never the surface above it. The
 * regression that returned the lag: `VsCodeComposer` derived its placeholder from the
 * `recipient` prop with a plain expression, so EVERY render of the composer re-ran the
 * `t(...).replace(...)` string work — and because `recipient` flows from
 * `useRecipientChoice` (which re-renders whenever the surface does), a streamed token or
 * a rail refresh re-rendered the whole composer tree per key. The fix memoizes the
 * placeholder on `[recipient, t]`; this pins that guard so it cannot silently revert.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8');

describe('composer placeholder is memoized (slow-typing guard, #6431)', () => {
  const composer = src('VsCodeComposer.tsx');

  it('derives the recipient placeholder through useMemo, not a plain expression', () => {
    // The memoized form: a useMemo whose factory returns the `t(...).replace('{name}', ...)`.
    expect(composer).toMatch(/useMemo\(\s*\(\)\s*=>\s*\(?recipient\s*\?/);
    expect(composer).toContain('.replace(\'{name}\', recipient.name)');
  });

  it('keys the placeholder memo on the recipient and the label fn', () => {
    expect(composer).toMatch(/\[recipient,\s*t\]/);
  });
});
