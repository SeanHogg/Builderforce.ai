import { beforeEach, describe, expect, it } from 'vitest';
import { resetBrainRunStore, startRun } from '../brainRunStore';
import type { CheckRecord } from '@builderforce/run-guards';
import type { VerifierPort } from './runTypes';

// PRD 45 §4.5 row 1 / workstream A3 — post-edit diagnostics. The done-check is the
// chat #216 regression: that run's 14 KB Towers.tsx rewrite introduced a
// rules-of-hooks violation that was only caught by luck. This gate must surface it
// DETERMINISTICALLY, on the edit result the model reads, the moment the edit lands —
// not whenever the model happens to run the suite.
//
// The test binds a FAKE verifier port (the host's real one is the VSIX's
// `clients/vscode/src/verify/`, built by a sibling) that returns the hooks-in-map
// error exactly as the language server would phrase it, and asserts the note rides
// the edit_file result the model reads.

beforeEach(resetBrainRunStore);

type Sent = { role: string; content: string; metadata?: string };
const persistence = () => ({
  sendMessages: async (chatId: number, msgs: Sent[]) => msgs.map((m, i) => ({ id: 9000 + i, chatId, createdAt: '', ...m })),
}) as never;

const TOOLS = ['edit_file', 'write_file', 'read_file'].map((name) => ({
  type: 'function' as const,
  function: { name, description: name, parameters: {} },
}));
type Call = { id: string; name: string; args: string } | null;

/** The hooks-in-map error chat #216's Towers.tsx rewrite carried (react-hooks/rules-of-hooks). */
const HOOKS_IN_MAP: CheckRecord = {
  kind: 'diagnostics',
  name: 'lsp',
  outcome: 'fail',
  exitCode: null,
  findings: [
    'src/scene/Towers.tsx:88:13 error React Hook "useMemo" is called in function "map" that is neither a React function component nor a custom React Hook function. (react-hooks/rules-of-hooks)',
  ],
  at: 0,
};

/** A fake verifier port: records which paths it was asked about, returns a scripted record. */
function fakeVerifier(record: CheckRecord | null, seen: { paths: string[] }) {
  return {
    diagnostics: async (paths: readonly string[]) => {
      seen.paths = [...seen.paths, ...paths];
      return record;
    },
    full: async () => [],
  } satisfies VerifierPort;
}

/** Every string a tool row carries — its parsed JSON's string leaves, or the raw text. */
function textInRow(row: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row);
  } catch {
    return [row];
  }
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(parsed);
  return out;
}

/**
 * Runs a scripted model through ONE read then ONE edit_file call; returns the tool
 * results the model read after the edit. The read comes first on purpose: a run's
 * FIRST model call is the PLANNING model, and a code-change tool call issued there is
 * swallowed by the pipeline's role hand-off (`llm.role_handoff`). Sequencing a read
 * first hands off to the CODING model, which is where the edit must be issued (its
 * result — the one the post-edit note rides — comes back on the following call).
 */
async function scriptedEdit(
  chatId: number,
  verifier: VerifierPort | undefined,
  toolResult: unknown,
  editArgs: Record<string, unknown> = { path: 'src/scene/Towers.tsx' },
) {
  const toolResults: string[] = [];
  let called = 0;
  await startRun(chatId, {
    resolvedSystemPrompt: 'sys',
    tools: TOOLS,
    verifier,
    // A QUICK route starts the run in `code` (pipelineRoute.ts), so the FIRST model call
    // issues the edit — the full pipeline's planning model would swallow a code-change call
    // at the role hand-off and the edit's result would never reach a model-facing turn.
    pipeline: { route: 'quick', quickModel: 'default' },
    runTool: async () => toolResult,
    stream: async (opts) => {
      called += 1;
      if (called === 1) {
        return { text: '', toolCalls: [{ id: 'e1', name: 'edit_file', args: JSON.stringify(editArgs) }], finishReason: 'tool_calls' };
      }
      // Capture the tool results the model reads on the call after the edit.
      toolResults.push(...opts.messages.filter((m) => m.role === 'tool').map((m) => String(m.content)));
      return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
    },
    persistence: persistence(),
    userTurn: 'rewrite Towers.tsx',
  });
  return toolResults;
}

describe('post-edit diagnostics (PRD 45 §4.5 row 1)', () => {
  it('regression: hooks-in-map violation reported on the edit result (chat #216)', async () => {
    const seen: { paths: string[] } = { paths: [] };
    const rows = await scriptedEdit(4701, fakeVerifier(HOOKS_IN_MAP, seen), { ok: true, excerpt: 'edited' });

    // The verifier was asked about EXACTLY the edited file — the fast tier runs on the spot.
    expect(seen.paths).toEqual(['src/scene/Towers.tsx']);
    // The note is on the edit result the model reads, in the D7 post-edit format.
    const note = textInRow(rows[0] ?? '').find((t) => t.includes('Post-edit check FAILED'));
    expect(note).toBeDefined();
    expect(note).toContain('react-hooks/rules-of-hooks');
    expect(note).toContain('Towers.tsx:88');
    expect(note).toContain('useMemo');
  });

  it('adds nothing when the verifier passes', async () => {
    const pass: CheckRecord = { ...HOOKS_IN_MAP, outcome: 'pass', findings: [] };
    const seen: { paths: string[] } = { paths: [] };
    const rows = await scriptedEdit(4702, fakeVerifier(pass, seen), { ok: true });
    // The fast tier still ran (evidence for the push-time gate), but a pass adds no note.
    expect(seen.paths).toEqual(['src/scene/Towers.tsx']);
    expect(rows.flat().some((r) => r.includes('Post-edit check FAILED'))).toBe(false);
  });

  it('adds nothing when no verifier is bound (host without a verifier)', async () => {
    const rows = await scriptedEdit(4703, undefined, { ok: true });
    expect(rows.flat().some((r) => r.includes('Post-edit check FAILED'))).toBe(false);
  });

  it('adds nothing when the edit itself failed (nothing new to check)', async () => {
    const seen: { paths: string[] } = { paths: [] };
    // A failed edit is surfaced by the failure guard, not the post-edit check — the
    // verifier must not be asked about bytes that never landed.
    await scriptedEdit(4704, fakeVerifier(HOOKS_IN_MAP, seen), { ok: false, error: 'no match' });
    expect(seen.paths).toEqual([]);
  });

  it('never blocks the edit: a throwing verifier still returns the edit result', async () => {
    const throwing = {
      diagnostics: async () => {
        throw new Error('lsp unavailable');
      },
      full: async () => [],
    } satisfies VerifierPort;
    const rows = await scriptedEdit(4705, throwing, { ok: true });
    // The edit result stands, unblocked and without a spurious note.
    expect(rows.flat().some((r) => r.includes('Post-edit check FAILED'))).toBe(false);
    expect(rows.flat().some((r) => r.includes('lsp unavailable'))).toBe(false);
  });
});
