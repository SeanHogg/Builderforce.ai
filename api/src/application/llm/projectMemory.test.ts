import { describe, expect, it, vi } from 'vitest';
import {
  qaCacheKey,
  resolveMemoryAnswer,
  cacheProjectAnswer,
  looksLikeCoherentText,
  EVERMIND_ANSWER_MIN_CHARS,
} from './projectMemory';
import type { Env } from '../../env';

// No AUTH_CACHE_KV → getCacheVersion/getOrSetCached fall through to the loader.
const env = {} as Env;

/** db mock whose `.select().from().where()[.limit()]` returns queued result sets in
 *  order. Sequence for an Evermind-first resolve: 1) getProjectFactByKey (cache, limit),
 *  2) resolveEffectiveEvermindProjectId → the project's OWN head (limit), 3) the head of
 *  the effective owner (limit). A project whose own head is UNSEEDED inserts an
 *  `ide_projects` container lookup between 2 and 3. `where()` is awaitable AND chainable.
 *  Also supports the upsert chain for cacheProjectAnswer. */
function memoryDb(resultQueue: Array<Array<Record<string, unknown>>>) {
  let i = 0;
  const next = () => resultQueue[i++] ?? [];
  const onConflictDoUpdate = vi.fn(async () => undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = next();
          const thenable = Promise.resolve(rows) as Promise<unknown> & { limit: () => Promise<unknown> };
          thenable.limit = async () => rows;
          return thenable;
        },
      }),
    }),
    insert,
  } as never;
  return { db, insert, values, onConflictDoUpdate };
}

const headRow = (over: Record<string, unknown> = {}) => ({
  version: 3,
  inferenceEnabled: true,
  name: 'Project Evermind',
  mode: 'connected',
  contributions: 0,
  teacherModel: null,
  lastLearnedAt: null,
  ...over,
});

describe('qaCacheKey', () => {
  it('is deterministic and normalizes case/spacing/punctuation to the same key', () => {
    const a = qaCacheKey('How does auth work?');
    expect(a).toMatch(/^qa:[0-9a-f]{8}$/);
    expect(qaCacheKey('  how   DOES auth WORK ')).toBe(a); // punctuation + case + spacing folded
    expect(qaCacheKey('how does auth work')).toBe(a);
  });
  it('maps genuinely different questions to different keys', () => {
    expect(qaCacheKey('what is the db client')).not.toBe(qaCacheKey('how does auth work'));
  });
});

describe('resolveMemoryAnswer', () => {
  it('returns the cached answer (source qa-cache) on an exact repeat — no Evermind call', async () => {
    const { db } = memoryDb([[{ content: 'Auth uses PKCE OAuth via the gateway.' }]]);
    const runEvermind = vi.fn(async () => 'should not be called');
    const ans = await resolveMemoryAnswer(env, db, 7, 42, 'How does auth work?', { runEvermind });
    expect(ans).toEqual({ text: 'Auth uses PKCE OAuth via the gateway.', source: 'qa-cache' });
    expect(runEvermind).not.toHaveBeenCalled();
  });

  it('falls to Evermind on a cache miss and names WHICH Evermind answered', async () => {
    // cache miss, ide_projects children (none), head for proj 42.
    const { db } = memoryDb([[], [headRow()], [headRow()]]);
    const runEvermind = vi.fn(async () => 'This is a sufficiently long Evermind reply about the project.');
    const ans = await resolveMemoryAnswer(env, db, 7, 42, 'How does auth work?', { runEvermind, toolsAvailable: false });
    expect(ans?.source).toBe('evermind');
    expect(ans?.evermindVersion).toBe(3);
    expect(ans?.evermindProjectId).toBe(42); // triage: which Evermind
    expect(runEvermind).toHaveBeenCalledTimes(1);
  });

  it('never runs the Evermind leg when the caller HAS tools (the SSM cannot call one)', async () => {
    // Cache miss only — the Evermind leg must not even resolve its targets, because a
    // tool-capable run must reach the model that can actually fetch the answer.
    const { db } = memoryDb([[], [headRow()], [headRow()]]);
    const runEvermind = vi.fn(async () => 'a substantive answer that would otherwise qualify');
    expect(await resolveMemoryAnswer(env, db, 7, 42, 'which tickets are in the backlog?', { runEvermind, toolsAvailable: true })).toBeNull();
    expect(runEvermind).not.toHaveBeenCalled();
  });

  it('bars the Evermind leg by DEFAULT (a caller that says nothing is assumed tool-capable)', async () => {
    const { db } = memoryDb([[], [headRow()], [headRow()]]);
    const runEvermind = vi.fn(async () => 'a substantive answer that would otherwise qualify');
    expect(await resolveMemoryAnswer(env, db, 7, 42, 'q?', { runEvermind })).toBeNull();
    expect(runEvermind).not.toHaveBeenCalled();
  });

  it('still replays the Q&A cache for a TOOL-CAPABLE caller (a real model produced it)', async () => {
    const { db } = memoryDb([[{ content: 'Auth uses PKCE OAuth via the gateway.' }]]);
    const runEvermind = vi.fn(async () => 'should not be called');
    const ans = await resolveMemoryAnswer(env, db, 7, 42, 'How does auth work?', { runEvermind, toolsAvailable: true });
    expect(ans).toEqual({ text: 'Auth uses PKCE OAuth via the gateway.', source: 'qa-cache' });
    expect(runEvermind).not.toHaveBeenCalled();
  });

  it('returns null when Evermind is not opted in (inferenceEnabled false)', async () => {
    const { db } = memoryDb([[], [headRow({ inferenceEnabled: false })], [headRow({ inferenceEnabled: false })]]);
    const runEvermind = vi.fn(async () => 'a substantive answer that would otherwise qualify');
    expect(await resolveMemoryAnswer(env, db, 7, 42, 'q?', { runEvermind, toolsAvailable: false })).toBeNull();
    expect(runEvermind).not.toHaveBeenCalled();
  });

  it('returns null when the Evermind reply is too short (below threshold)', async () => {
    const { db } = memoryDb([[], [headRow()], [headRow()]]);
    const runEvermind = vi.fn(async () => 'nope'); // < EVERMIND_ANSWER_MIN_CHARS
    expect('nope'.length).toBeLessThan(EVERMIND_ANSWER_MIN_CHARS);
    expect(await resolveMemoryAnswer(env, db, 7, 42, 'q?', { runEvermind, toolsAvailable: false })).toBeNull();
  });

  it('returns null when an under-trained head returns long-but-incoherent garbage', async () => {
    const { db } = memoryDb([[], [headRow()], [headRow()]]);
    // The real serving failure: fluent-looking gibberish that clears 20 chars but is
    // not language — must be treated as a miss, not served to the user.
    const garbage =
      '� `` **ARserting yoularmy dir this your sintens byy b I - A met toades misin the ge simpelying e the the isb wonvert bled a suchrech u me toan I mend in the you reper seArrading';
    const runEvermind = vi.fn(async () => garbage);
    expect(garbage.length).toBeGreaterThanOrEqual(EVERMIND_ANSWER_MIN_CHARS);
    expect(await resolveMemoryAnswer(env, db, 7, 42, 'status?', { runEvermind, toolsAvailable: false })).toBeNull();
  });

  it('does NOT let a SIBLING build’s Evermind answer for this project', async () => {
    // The project's own head is unseeded and it has no container, so nothing may answer —
    // even though sibling IDE builds under the same container have live, inference-enabled
    // heads. Fanning out over them is right for LEARNING and wrong for ANSWERING: it
    // attributed build B's knowledge to project A and contradicted A's own "inference off".
    // Queue: cache miss → own head (unseeded) → ide_projects container lookup (none) →
    // effective head (still unseeded).
    const { db } = memoryDb([[], [headRow({ version: 0, inferenceEnabled: false })], [], [headRow({ version: 0, inferenceEnabled: false })]]);
    const runEvermind = vi.fn(async () => 'a substantive answer a sibling head would happily give');
    expect(await resolveMemoryAnswer(env, db, 7, 42, 'what project is this chat on?', { runEvermind, toolsAvailable: false })).toBeNull();
    expect(runEvermind).not.toHaveBeenCalled();
  });

  it('answers from the CONTAINER head when this project is an IDE build with none of its own', async () => {
    // Read-inheritance is preserved: a build that deliberately has no head of its own
    // still answers from its container's (the same head the console shows it).
    const { db } = memoryDb([
      [],                                                   // cache miss
      [headRow({ version: 0, inferenceEnabled: false })],    // own head — unseeded
      [{ cid: 9 }],                                          // ide_projects → container 9
      [headRow()],                                           // container head — live
    ]);
    const runEvermind = vi.fn(async () => 'The container project owns the trained model that answers this.');
    const ans = await resolveMemoryAnswer(env, db, 7, 42, 'How does auth work?', { runEvermind, toolsAvailable: false });
    expect(ans?.source).toBe('evermind');
    expect(ans?.evermindProjectId).toBe(9);
    expect(runEvermind).toHaveBeenCalledTimes(1);
  });

  it('returns null without runEvermind and no cache hit (caller proceeds to the LLM)', async () => {
    const { db } = memoryDb([[]]);
    expect(await resolveMemoryAnswer(env, db, 7, 42, 'q?', {})).toBeNull();
  });
});

describe('cacheProjectAnswer', () => {
  it('write-through upserts a substantive answer under the qa cache key', async () => {
    const { db, insert, onConflictDoUpdate } = memoryDb([]);
    await cacheProjectAnswer(env, db, 7, 42, 'How does auth work?', 'Auth uses PKCE OAuth via the gateway.');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1); // replace-on-write
  });

  it('skips trivially short answers (nothing worth caching)', async () => {
    const { db, insert } = memoryDb([]);
    await cacheProjectAnswer(env, db, 7, 42, 'q?', 'short');
    expect(insert).not.toHaveBeenCalled();
  });

  it('never caches long-but-incoherent garbage (would pin gibberish under the key)', async () => {
    const { db, insert } = memoryDb([]);
    await cacheProjectAnswer(env, db, 7, 42, 'status?', 'commit commit commit ticket ticketO commit PRge the the inten prousan syour');
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('looksLikeCoherentText', () => {
  it('rejects the observed under-trained-Evermind garbage samples', () => {
    // Sample 1 — includes the Unicode replacement char from broken byte-level decode.
    expect(
      looksLikeCoherentText(
        '� `` **ARserting yoularmy dir this your sintens byy b I - A met toades misin the ge simpelying e the the isb wonvert',
      ),
    ).toBe(false);
    // Sample 2 — no replacement char, but degenerate "commit" repetition + stray letters.
    expect(
      looksLikeCoherentText(
        'S cane syour commitemend commiting ete the inten you commits : The commete eg in the commit commit commit ticket ticketO commit PRge in the in the k y i o y',
      ),
    ).toBe(false);
    // Sample 3 — the one that actually reached a user (VS Code chat, "what project is
    // this chat associated with?"). No replacement char, no repetition collapse, and
    // "the" is only 8% of tokens, so every earlier check passed it. What gives it away
    // structurally is the punctuation it never opened: two orphaned `)`.
    expect(
      looksLikeCoherentText(
        'edicationlatches tist deagneannog, oredionisiing chats code related tot, bound reposea this inatic exie. '
        + 'The cainstiel.ts, ore). The bountiore tensis for-builticack oatic exinaation,g reposeanhogg/builainaints, '
        + 'codehe ruilainain_acode relien.\n\naacky is exansiconic.gatediaanhogao sicic.. The bount '
        + 'reposeanhogg/builtisteckets.\n\nodochedet exensiatnic.ga, upele colognots, vxens, or relidats, or ysis '
        + 'exenets, siannoing, catic. The bountiat). The bount relatedort inat',
      ),
    ).toBe(false);
  });

  it('accepts normal English answers (no false rejects)', () => {
    expect(looksLikeCoherentText('The project status is green: all 12 tickets are on track and the last deploy passed CI.')).toBe(true);
    expect(looksLikeCoherentText('Auth uses PKCE OAuth via the gateway; the tenant key is stored in SecretStorage.')).toBe(true);
    // Short clean answers clear it (too few tokens to score structurally).
    expect(looksLikeCoherentText('Yes, the build is green.')).toBe(true);
  });

  it('does not mis-reject legitimate non-English replies', () => {
    // Spanish uses real one-letter words (y / o); the single-letter test must not fire.
    expect(looksLikeCoherentText('El estado del proyecto es verde y todas las tareas están al día o casi.')).toBe(true);
    // CJK has no ASCII letters to score — accepted.
    expect(looksLikeCoherentText('项目状态为绿色，所有工单都按计划进行，最近一次部署已通过持续集成。')).toBe(true);
    // German compounds make long tokens the norm — length alone must never be the signal.
    expect(looksLikeCoherentText(
      'Dieser Chat gehört zum Projekt BuilderForce. Das Rückstandsverzeichnis enthält neunzehn Vorgänge, die '
      + 'überwiegend durch die Überprüfungsfreigabe blockiert sind, weil eine Benutzerzustimmung erforderlich ist.',
    )).toBe(true);
  });

  it('accepts balanced brackets in real prose and code, and a single stray closer', () => {
    expect(looksLikeCoherentText(
      'The failure comes from resolveMemoryAnswer (in projectMemory.ts): resolveEvermindTargets returns the '
      + 'container project plus every ide_projects storageProjectId, so getProjectEvermindHead(env, db) can '
      + 'return a head the chat never opted into.',
    )).toBe(true);
    // One orphaned closer is ordinary punctuation noise (an emoticon, a truncated quote)
    // — the gate needs TWO before it calls the text broken.
    expect(looksLikeCoherentText('Deploy finished and every check passed on the first run :) nothing else to report here.')).toBe(true);
  });

  it('rejects empty / whitespace', () => {
    expect(looksLikeCoherentText('')).toBe(false);
    expect(looksLikeCoherentText('   ')).toBe(false);
  });
});
