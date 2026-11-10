/**
 * PRD 46 §3.6 (F3/F4) — the post-edit notes on the edit's own result.
 *
 *  - Diagnostics used to be skipped whenever another advisory (a placeholder warning, a
 *    delegation nudge) was already attached (`callRunner.ts`, `if (!advisory && …)`); the notes
 *    now concatenate.
 *  - Chat #70776: an `edit_file` on `labels.ts` replaced a fragment with one that closed the
 *    object early (`};`), orphaning the spreads after it. The call reported success; nothing
 *    checked balance. The bracket-balance note is computed from the call's own arguments, so it
 *    holds with no verifier bound.
 *
 * Driven through the real `startRun` (as `postEditDiagnostics.test.ts` is), so the note is
 * asserted on the result the model reads.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resetBrainRunStore, startRun } from '../brainRunStore';
import type { CheckRecord } from '@builderforce/run-guards';
import type { VerifierPort } from './runTypes';
import { bracketBalanceNote } from './postEditStructure';

beforeEach(resetBrainRunStore);

type Sent = { role: string; content: string; metadata?: string };
const persistence = () => ({
  sendMessages: async (chatId: number, msgs: Sent[]) => msgs.map((m, i) => ({ id: 9000 + i, chatId, createdAt: '', ...m })),
}) as never;

const TOOLS = ['edit_file', 'write_file', 'read_file'].map((name) => ({
  type: 'function' as const,
  function: { name, description: name, parameters: {} },
}));

/** Chat #70776's `labels.ts` edit: the new fragment closes the object (`};`) before the spreads. */
const LABELS_EDIT = {
  path: 'packages/knowledge-graph-view/src/labels.ts',
  old_string: "  legend: 'Legend',\n  ...coreLabels,",
  new_string: "  legend: 'Legend',\n};\n  ...coreLabels,",
};

const LSP_ERROR: CheckRecord = {
  kind: 'diagnostics',
  name: 'lsp',
  outcome: 'fail',
  exitCode: null,
  findings: ["packages/knowledge-graph-view/src/labels.ts:12:3 error Declaration or statement expected. (ts1128)"],
  at: 0,
};

const verifierOf = (record: CheckRecord | null): VerifierPort => ({
  diagnostics: async () => record,
  full: async () => new Map(),
});

/** One edit_file call on the run's first model call; returns the tool results the next call reads. */
async function scriptedEdit(chatId: number, verifier: VerifierPort | undefined, editArgs: Record<string, unknown>): Promise<string> {
  const toolResults: string[] = [];
  let called = 0;
  await startRun(chatId, {
    resolvedSystemPrompt: 'sys',
    tools: TOOLS,
    ...(verifier ? { verifier } : {}),
    // QUICK route: the first model call is the coder's, so the edit is not swallowed by a hand-off.
    pipeline: { route: 'quick', quickModel: 'default' },
    runTool: async () => ({ ok: true, excerpt: 'edited' }),
    stream: async (opts) => {
      called += 1;
      if (called === 1) {
        return { text: '', toolCalls: [{ id: 'e1', name: 'edit_file', args: JSON.stringify(editArgs) }], finishReason: 'tool_calls' };
      }
      toolResults.push(...opts.messages.filter((m) => m.role === 'tool').map((m) => String(m.content)));
      return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
    },
    persistence: persistence(),
    userTurn: 'edit labels.ts',
  });
  return toolResults.join('\n');
}

describe('post-edit notes (PRD 46 §3.6)', () => {
  it('regression: diagnostics run when another advisory is attached', async () => {
    // The new fragment carries a placeholder, so the placeholder guard's advisory is attached first.
    const rows = await scriptedEdit(46001, verifierOf(LSP_ERROR), {
      path: 'src/a.ts',
      old_string: 'return value;',
      new_string: 'return value; // TODO: wire up the real signal',
    });
    expect(rows).toContain('PLACEHOLDER WRITTEN');
    expect(rows).toContain('Post-edit check FAILED (lsp');
    expect(rows).toContain('ts1128');
  });

  it('regression: bracket break reported on the edit result (chat #70776)', async () => {
    // No verifier bound: the balance note needs none.
    const rows = await scriptedEdit(46002, undefined, LABELS_EDIT);
    expect(rows).toContain('Post-edit check FAILED (bracket balance)');
    expect(rows).toContain('labels.ts');
    expect(rows).toContain('`{}` -1');
  });

  it('adds no balance note when the replacement keeps the balance', async () => {
    const rows = await scriptedEdit(46003, undefined, { path: 'src/a.ts', old_string: 'f(a)', new_string: 'f(a, { b: [1] })' });
    expect(rows).not.toContain('bracket balance');
  });
});

describe('bracketBalanceNote', () => {
  it('checks every entry of an edits[] batch, naming each file whose balance moved', () => {
    const note = bracketBalanceNote({
      name: 'edit_file',
      args: { edits: [LABELS_EDIT, { path: 'src/ok.ts', old_string: 'a', new_string: 'b' }, { path: 'src/b.ts', old_string: 'g(', new_string: 'g((' }] },
      result: { ok: true },
    });
    expect(note).toContain('labels.ts: `{}` -1');
    expect(note).toContain('src/b.ts: `()` +1');
    expect(note).not.toContain('src/ok.ts');
  });

  it('says nothing for a failed edit, a non-edit tool, or a file the lexer does not know', () => {
    expect(bracketBalanceNote({ name: 'edit_file', args: LABELS_EDIT, result: { ok: false } })).toBeNull();
    expect(bracketBalanceNote({ name: 'write_file', args: { path: 'a.ts', content: '{' }, result: { ok: true } })).toBeNull();
    expect(bracketBalanceNote({ name: 'edit_file', args: { ...LABELS_EDIT, path: 'docs/a.md' }, result: { ok: true } })).toBeNull();
  });

  it('regression: a correct edit holding a regex literal or JSX prose is not flagged', () => {
    expect(bracketBalanceNote({ name: 'edit_file', args: { path: 'src/a.ts', old_string: 's', new_string: `s.replace(/["']/g, '')` }, result: { ok: true } })).toBeNull();
    expect(bracketBalanceNote({ name: 'edit_file', args: { path: 'src/A.tsx', old_string: '<p>Hi</p>', new_string: `<p>Don't (really)</p>` }, result: { ok: true } })).toBeNull();
  });
});
