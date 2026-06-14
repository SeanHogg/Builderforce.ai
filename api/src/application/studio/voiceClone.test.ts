import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  isTtsProviderConfigured,
  synthesizeClonedAudio,
  TtsProviderUnavailable,
} from './ttsProvider';
import {
  canUseClone,
  synthesizeForClone,
  VoiceCloneConsentRequired,
  VoiceCloneForbidden,
  VoiceCloneNotFound,
} from './voiceCloneService';
import {
  studioVoiceCloneLicenses,
  studioVoiceClones,
  studioVoiceovers,
  llmUsageLog,
} from '../../infrastructure/database/schema';
import type { Env } from '../../env';

// ── A scripted fake Drizzle db keyed by table reference. ────────────────────
function fakeDb(opts: {
  selectByTable?: Map<unknown, unknown[] | (() => unknown[])>;
  returningByTable?: Map<unknown, unknown[]>;
  captured?: Array<{ op: 'insert' | 'delete'; table: unknown; values?: unknown }>;
}) {
  const selectByTable = opts.selectByTable ?? new Map();
  const returningByTable = opts.returningByTable ?? new Map();
  const captured = opts.captured ?? [];

  function rowsFor(table: unknown): unknown[] {
    const v = selectByTable.get(table);
    return typeof v === 'function' ? (v as () => unknown[])() : (v ?? []);
  }

  return {
    select() {
      const chain: Record<string, unknown> = {};
      let table: unknown;
      chain.from = (t: unknown) => { table = t; return chain; };
      chain.where = () => chain;
      chain.orderBy = () => chain;
      chain.limit = () => chain;
      (chain as { then: unknown }).then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(rowsFor(table)).then(res, rej);
      return chain;
    },
    insert(table: unknown) {
      return {
        values(v: unknown) {
          captured.push({ op: 'insert', table, values: v });
          const ret = {
            onConflictDoNothing: () => ret,
            returning: () => Promise.resolve(returningByTable.get(table) ?? []),
            then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve(undefined).then(res, rej),
          };
          return ret;
        },
      };
    },
    delete(table: unknown) {
      return { where: () => { captured.push({ op: 'delete', table }); return Promise.resolve(); } };
    },
  } as never;
}

const CONSENTED = new Date('2026-06-01T00:00:00Z');

function cloneRow(over: Partial<typeof studioVoiceClones.$inferSelect> = {}) {
  return {
    id: 7, tenantId: 1, segmentId: null, userId: 'u1', name: 'Alice', description: null,
    provider: 'tts-server', referenceKey: '1/voice-clones/ref.wav', embedding: null,
    visibility: 'private', status: 'ready', priceMillicents: 0,
    consentAttestedAt: CONSENTED, consentTextVersion: 'v1',
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

const ENV_WITH_PROVIDER: Env = {
  VOICE_CLONE_TTS_URL: 'https://tts.example/synthesize',
  UPLOADS: {
    get: async () => ({ arrayBuffer: async () => new ArrayBuffer(8), httpMetadata: { contentType: 'audio/wav' } }),
    put: async () => undefined,
  },
} as unknown as Env;

afterEach(() => vi.unstubAllGlobals());

describe('ttsProvider adapter (§3.1 bytes-returning seam)', () => {
  it('isTtsProviderConfigured reflects the env binding', () => {
    expect(isTtsProviderConfigured({} as Env)).toBe(false);
    expect(isTtsProviderConfigured({ VOICE_CLONE_TTS_URL: 'x' } as Env)).toBe(true);
  });

  it('throws TtsProviderUnavailable when no provider is configured', async () => {
    await expect(
      synthesizeClonedAudio({} as Env, {
        referenceAudio: new ArrayBuffer(4), referenceContentType: 'audio/wav', text: 'hi',
      }),
    ).rejects.toBeInstanceOf(TtsProviderUnavailable);
  });

  it('POSTs to the provider and decodes the JSON audio envelope', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ audio_base64: btoa('RIFF....'), content_type: 'audio/wav', duration_ms: 900, word_timestamps: [{ word: 'hi', startMs: 0, endMs: 400 }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await synthesizeClonedAudio(
      { VOICE_CLONE_TTS_URL: 'https://tts.example', VOICE_CLONE_TTS_KEY: 'k' } as Env,
      { referenceAudio: new ArrayBuffer(4), referenceContentType: 'audio/wav', text: 'hi', speed: 1 },
    );
    expect(out.durationMs).toBe(900);
    expect(out.wordTimestamps).toHaveLength(1);
    const init = (fetchMock.mock.calls[0] as unknown as [unknown, RequestInit])[1];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer k' });
  });
});

describe('canUseClone (access predicate)', () => {
  it('owner can use', async () => {
    const db = fakeDb({});
    expect(await canUseClone(db, { id: 7, tenantId: 1 }, 1)).toBe(true);
  });
  it('non-owner without a license cannot', async () => {
    const db = fakeDb({ selectByTable: new Map([[studioVoiceCloneLicenses, []]]) });
    expect(await canUseClone(db, { id: 7, tenantId: 1 }, 2)).toBe(false);
  });
  it('non-owner WITH an active license can', async () => {
    const db = fakeDb({ selectByTable: new Map([[studioVoiceCloneLicenses, [{ id: 1 }]]]) });
    expect(await canUseClone(db, { id: 7, tenantId: 1 }, 2)).toBe(true);
  });
});

describe('synthesizeForClone gates', () => {
  it('throws VoiceCloneNotFound for a missing clone', async () => {
    const db = fakeDb({ selectByTable: new Map([[studioVoiceClones, []]]) });
    await expect(
      synthesizeForClone(db, ENV_WITH_PROVIDER, { cloneId: 7, tenantId: 1, userId: 'u1', text: 'hi' }),
    ).rejects.toBeInstanceOf(VoiceCloneNotFound);
  });

  it('throws VoiceCloneForbidden for a non-owner with no license', async () => {
    const db = fakeDb({
      selectByTable: new Map<unknown, unknown[]>([
        [studioVoiceClones, [cloneRow({ tenantId: 99 })]],
        [studioVoiceCloneLicenses, []],
      ]),
    });
    await expect(
      synthesizeForClone(db, ENV_WITH_PROVIDER, { cloneId: 7, tenantId: 1, userId: 'u1', text: 'hi' }),
    ).rejects.toBeInstanceOf(VoiceCloneForbidden);
  });

  it('throws VoiceCloneConsentRequired when consent is not attested', async () => {
    const db = fakeDb({
      selectByTable: new Map<unknown, unknown[]>([[studioVoiceClones, [cloneRow({ consentAttestedAt: null })]]]),
    });
    await expect(
      synthesizeForClone(db, ENV_WITH_PROVIDER, { cloneId: 7, tenantId: 1, userId: 'u1', text: 'hi' }),
    ).rejects.toBeInstanceOf(VoiceCloneConsentRequired);
  });

  it('throws TtsProviderUnavailable when consented but no provider configured', async () => {
    const db = fakeDb({ selectByTable: new Map<unknown, unknown[]>([[studioVoiceClones, [cloneRow()]]]) });
    await expect(
      synthesizeForClone(db, {} as Env, { cloneId: 7, tenantId: 1, userId: 'u1', text: 'hi' }),
    ).rejects.toBeInstanceOf(TtsProviderUnavailable);
  });

  it('cache hit: an existing voiceover row returns cached:true with no provider call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const db = fakeDb({
      selectByTable: new Map<unknown, unknown[]>([
        [studioVoiceClones, [cloneRow()]],
        [studioVoiceovers, [{ id: 42, audioKey: 'a/b.wav', durationMs: 1200, wordTimestamps: [] }]],
      ]),
    });
    const res = await synthesizeForClone(db, ENV_WITH_PROVIDER, {
      cloneId: 7, tenantId: 1, userId: 'u1', text: 'cached please',
    });
    expect(res.cached).toBe(true);
    expect(res.voiceoverId).toBe(42);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cache miss: synthesizes, persists a voiceover, and meters one ledger row', async () => {
    const captured: Array<{ op: 'insert' | 'delete'; table: unknown; values?: unknown }> = [];
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ audio_base64: btoa('AUDIO'), content_type: 'audio/wav', duration_ms: 2000, word_timestamps: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const db = fakeDb({
      selectByTable: new Map<unknown, unknown[]>([
        [studioVoiceClones, [cloneRow()]],
        [studioVoiceovers, []], // no existing row → true miss
      ]),
      returningByTable: new Map<unknown, unknown[]>([[studioVoiceovers, [{ id: 100 }]]]),
      captured,
    });
    const res = await synthesizeForClone(db, ENV_WITH_PROVIDER, {
      cloneId: 7, tenantId: 1, userId: 'u1', text: 'fresh synthesis',
    });
    expect(res.cached).toBe(false);
    expect(res.voiceoverId).toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // one voiceover insert + one ledger (llm_usage_log) insert
    expect(captured.filter((c) => c.table === studioVoiceovers && c.op === 'insert')).toHaveLength(1);
    const ledger = captured.find((c) => c.table === llmUsageLog && c.op === 'insert');
    expect(ledger).toBeTruthy();
    // 2000ms → ceil(2s) * default 5 mc/s = 10 millicents
    expect((ledger!.values as { costUsdMillicents: number }).costUsdMillicents).toBe(10);
  });
});
