import { afterEach, describe, expect, it, vi } from 'vitest';
import { languageDetectorAdapter } from './languageDetectorApi';
import { proofreaderAdapter } from './proofreaderApi';
import { rewriterAdapter } from './rewriterApi';
import { structuredPromptAdapter } from './structuredPrompt';
import { summarizerAdapter } from './summarizerApi';
import { translatorAdapter } from './translatorApi';
import { writerAdapter } from './writerApi';
import type { BuiltInAdapter } from './taskSession';

/**
 * Adapter conformance (PRD 42 done-check 5): each adapter returns null when its global is
 * absent or its model is not `available` (never starting a download), and throws only on abort.
 */

interface Case {
  name: string;
  global: string;
  adapter: BuiltInAdapter;
  /** The session the fake global creates. */
  session: Record<string, unknown>;
  run: (signal?: AbortSignal) => Promise<unknown>;
  expected: unknown;
}

const cases: Case[] = [
  { name: 'summarizer', global: 'Summarizer', adapter: summarizerAdapter, session: { summarize: async () => 'sum' },
    run: (signal) => summarizerAdapter.summarize!('t', { kind: 'tldr', ...(signal ? { signal } : {}) }), expected: 'sum' },
  { name: 'rewriter', global: 'Rewriter', adapter: rewriterAdapter, session: { rewrite: async () => 'rw' },
    run: (signal) => rewriterAdapter.rewrite!('t', { tone: 'more-formal', ...(signal ? { signal } : {}) }), expected: 'rw' },
  { name: 'writer', global: 'Writer', adapter: writerAdapter, session: { write: async () => 'wr' },
    run: (signal) => writerAdapter.write!('t', signal ? { signal } : undefined), expected: 'wr' },
  { name: 'proofreader', global: 'Proofreader', adapter: proofreaderAdapter, session: { proofread: async () => ({ correctedInput: 'fixed' }) },
    run: (signal) => proofreaderAdapter.proofread!('t', signal ? { signal } : undefined), expected: 'fixed' },
  { name: 'languageDetector', global: 'LanguageDetector', adapter: languageDetectorAdapter,
    session: { detect: async () => [{ detectedLanguage: 'es', confidence: 0.9 }] },
    run: () => languageDetectorAdapter.detectLanguage!('hola'), expected: { lang: 'es', confidence: 0.9 } },
  { name: 'translator', global: 'Translator', adapter: translatorAdapter, session: { translate: async () => 'hello' },
    run: (signal) => translatorAdapter.translate!('hola', { from: 'es', to: 'en', ...(signal ? { signal } : {}) }), expected: 'hello' },
];

function fakeGlobal(availability: string, session: Record<string, unknown>) {
  const create = vi.fn(async () => ({ ...session, destroy: vi.fn() }));
  return { availability: vi.fn(async () => availability), create };
}

afterEach(() => vi.unstubAllGlobals());

describe.each(cases)('$name adapter', (c) => {
  it('is null when its global is absent', async () => {
    expect(await c.adapter.ready()).toBe(false);
    expect(await c.run()).toBeNull();
  });

  it.each(['unavailable', 'downloadable', 'downloading'])('is null and never creates when %s', async (state) => {
    const fake = fakeGlobal(state, c.session);
    vi.stubGlobal(c.global, fake);
    expect(await c.run()).toBeNull();
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('answers when available', async () => {
    vi.stubGlobal(c.global, fakeGlobal('available', c.session));
    expect(await c.run()).toEqual(c.expected);
  });

  it('reads a failing session as null', async () => {
    const boom = Object.fromEntries(Object.keys(c.session).map((k) => [k, async () => { throw new Error('boom'); }]));
    vi.stubGlobal(c.global, fakeGlobal('available', boom));
    expect(await c.run()).toBeNull();
  });

  it('throws only AbortError when aborted', async () => {
    vi.stubGlobal(c.global, fakeGlobal('available', c.session));
    const controller = new AbortController();
    controller.abort();
    if (c.name === 'languageDetector') return; // no signal on detect (a per-call, instant task)
    await expect(c.run(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('structuredPrompt adapter', () => {
  const session = (reply: string) => ({
    prompt: vi.fn(async () => reply),
    destroy: vi.fn(),
    inputQuota: 1000,
    measureInputUsage: vi.fn(async () => 5),
    inputUsage: 0,
  });

  it('is null when LanguageModel is absent', async () => {
    expect(await structuredPromptAdapter.ready()).toBe(false);
    expect(await structuredPromptAdapter.json!({ system: 's', user: 'u', schema: {} })).toBeNull();
    expect(await structuredPromptAdapter.summarize!('t', { kind: 'tldr' })).toBeNull();
  });

  it('never creates a session for a downloadable model', async () => {
    const create = vi.fn();
    vi.stubGlobal('LanguageModel', { availability: async () => 'downloadable', create });
    expect(await structuredPromptAdapter.summarize!('t', { kind: 'tldr' })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('passes the schema as responseConstraint and parses the reply', async () => {
    const s = session('{"ok":true}');
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create: async () => s });
    const schema = { type: 'object' };
    expect(await structuredPromptAdapter.json!({ system: 's', user: 'u', schema })).toEqual({ ok: true });
    expect(s.prompt).toHaveBeenCalledWith('u', expect.objectContaining({ responseConstraint: schema }));
    expect(s.destroy).toHaveBeenCalled();
  });

  it('is null for a prompt over the window', async () => {
    const s = { ...session('x'), measureInputUsage: vi.fn(async () => 5000) };
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create: async () => s });
    expect(await structuredPromptAdapter.summarize!('t', { kind: 'tldr' })).toBeNull();
  });
});
