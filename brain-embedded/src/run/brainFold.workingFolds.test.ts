/**
 * PRD 45 §4.7 B6/B7 in the Brain: the compaction hook (`brainFold.ts`) applies `foldWorkingTranscript` to the messages the MODEL
 * is sent. An earlier `read_file` result of a path that a later edit changed reaches the model as the superseded marker, and a
 * tool-call turn's narration that only repeats the previous one reaches it as "(progress note)". The run's own transcript keeps
 * every row at full fidelity.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { PROGRESS_NOTE, supersededReadMarker } from '@seanhogg/builderforce-memory/working';
import { resetBrainRunStore, startRun } from '../brainRunStore';
import type { ChatCompletionMessage, StreamChatOptions, StreamChatResult } from '../streamChatCompletion';
import { getCell } from '../runStore/runCells';

beforeEach(() => {
  resetBrainRunStore();
});

const persistence = () => ({
  sendMessages: async (chatId: number, msgs: Array<{ role: string; content: string }>) => msgs.map((m, i) => ({ id: 9300 + i, chatId, createdAt: '', ...m })),
}) as never;

const TOOLS = ['read_file', 'edit_file'].map((name) => ({
  type: 'function' as const,
  function: { name, description: name, parameters: {} },
}));

const FILE_TEXT = 'export const lever = 1; // the original file text';
const READ_NARRATION = 'Reading src/lever.ts to find the lever wiring.';
const EDIT_NARRATION = 'Reading src/lever.ts to find the lever wiring again.';

const answered = (msgs: readonly ChatCompletionMessage[], id: string): boolean => msgs.some((m) => m.role === 'tool' && m.tool_call_id === id);

describe('the Brain folds the working transcript it sends the model (B6/B7)', () => {
  it('regression: a read superseded by a later successful edit reaches the model as the marker; repeated narration as a progress note', async () => {
    const key = 4545;
    let finalTurn: ChatCompletionMessage[] | null = null;
    const stream = async (opts: StreamChatOptions): Promise<StreamChatResult> => {
      const msgs = opts.messages;
      if (!answered(msgs, 'r1')) {
        return { text: READ_NARRATION, toolCalls: [{ id: 'r1', name: 'read_file', args: JSON.stringify({ path: 'src/lever.ts' }) }], finishReason: 'tool_calls' } as never;
      }
      if (!answered(msgs, 'e1')) {
        return {
          text: EDIT_NARRATION,
          toolCalls: [{ id: 'e1', name: 'edit_file', args: JSON.stringify({ path: 'src/lever.ts', old_string: '1', new_string: '2' }) }],
          finishReason: 'tool_calls',
        } as never;
      }
      finalTurn = msgs;
      return { text: 'Done.', toolCalls: [], finishReason: 'stop' } as never;
    };

    await startRun(key, {
      resolvedSystemPrompt: 'sys',
      tools: TOOLS,
      runTool: async (name: string) => (name === 'read_file' ? { ok: true, content: FILE_TEXT } : { ok: true, content: 'edited' }),
      stream: stream as never,
      persistence: persistence(),
      userTurn: 'change the lever to 2',
    });

    expect(finalTurn).not.toBeNull();
    const sent = finalTurn as unknown as ChatCompletionMessage[];
    const readResult = sent.find((m) => m.role === 'tool' && m.tool_call_id === 'r1');
    const readStep = sent.findIndex((m) => m.role === 'assistant' && (m.tool_calls ?? []).some((call) => call.id === 'r1'));
    const editStep = sent.findIndex((m) => m.role === 'assistant' && (m.tool_calls ?? []).some((call) => call.id === 'e1'));
    expect(readStep).toBeGreaterThanOrEqual(0);
    expect(editStep).toBeGreaterThan(readStep);
    // B6: the stale read leaves the model's window.
    expect(readResult?.content).toBe(supersededReadMarker('src/lever.ts', editStep));
    expect(sent.some((m) => typeof m.content === 'string' && m.content.includes(FILE_TEXT))).toBe(false);
    // B7: the narration that introduced the (now superseded) read is kept; the repeat is a progress note.
    expect(sent[readStep]!.content).toBe(READ_NARRATION);
    expect(sent[editStep]!.content).toBe(PROGRESS_NOTE);

    // Full fidelity in the run's own transcript: nothing there was folded.
    const transcript = getCell(key).transcript;
    expect(transcript.some((m) => m.role === 'tool' && typeof m.content === 'string' && m.content.includes(FILE_TEXT))).toBe(true);
    expect(transcript.some((m) => m.role === 'assistant' && m.content === EDIT_NARRATION)).toBe(true);
    expect(transcript.some((m) => m.content === PROGRESS_NOTE)).toBe(false);
  });
});
