/**
 * Compaction (T2) and what a chat keeps: a long chat that folds, two runs in one chat with a fold, a reload after a fold,
 * a Stop during a fold, and an image attachment. The Brain's fold is `buildWorkingTranscript` (64,000-token history
 * allowance, 40,000-token tail), so each scenario seeds enough history to cross it.
 */

import { stopRun } from '../../../runStore/runControl';
import { bulk, call, calls, completion, reply, decide } from '../script';
import type { Scenario, ScenarioHost } from '../types';

const FILES = { read_file: (a: unknown) => ({ ok: true, path: (a as { path?: string }).path, content: 'export const a = 1;\n', totalLines: 1 }) };

/** `pairs` earlier turns of ~5k tokens each, saved as the chat's history. */
function longHistory(h: ScenarioHost, pairs: number): { seed: ReturnType<ScenarioHost['seedOf']>['seed']; seedIds: number[] } {
  const rows = Array.from({ length: pairs }, (_, i) => [
    { role: 'user' as const, content: `Question ${i + 1}. ${bulk(`q${i + 1}`, 2_500)}` },
    { role: 'assistant' as const, content: `Answer ${i + 1}. ${bulk(`a${i + 1}`, 2_500)}` },
  ]).flat();
  h.preload(rows);
  return h.seedOf();
}

const SUMMARY = 'Memory: the earlier questions were about the manifest service; nothing is outstanding but the newest request.';

export const longChatFolds: Scenario = {
  id: 'long-chat-folds', rows: ['T2'], loopShows: ['context.compacted'], title: 'a long chat folds its older middle through the Brain\'s summarizer, silently, and the run answers on the folded window',
  async run(h) {
    h.script([reply('Here is the answer on the folded window.')], SUMMARY);
    const { seed, seedIds } = longHistory(h, 20);
    const userTurnMessageId = h.saveUser('And what about the manifest?');
    await h.start({ seed, seedIds, userTurn: 'And what about the manifest?', userTurnMessageId });
  },
};

export const twoRunsOneFold: Scenario = {
  id: 'two-runs-one-fold', rows: ['T2'], loopShows: ['context.compacted'], title: 'two runs in one chat: the second reuses the first\'s fold memo instead of summarising again',
  async run(h) {
    h.script([reply('First answer, on the folded window.'), reply('Second answer, reusing the memo.')], SUMMARY);
    const { seed, seedIds } = longHistory(h, 20);
    const first = h.saveUser('First question after the history.');
    await h.start({ seed, seedIds, userTurn: 'First question after the history.', userTurnMessageId: first });
    const second = h.saveUser('Second question.');
    await h.start({ seed: [], seedIds: [], userTurn: 'Second question.', userTurnMessageId: second });
  },
};

export const reloadAfterFold: Scenario = {
  id: 'reload-after-fold', rows: ['T2'], title: 'after a page reload the next run seeds from the durable fold marker, not the whole history',
  async run(h) {
    h.script([reply('First answer, on the folded window.'), reply('After the reload, starting from the note.')], SUMMARY);
    const { seed, seedIds } = longHistory(h, 20);
    const first = h.saveUser('First question after the history.');
    await h.start({ seed, seedIds, userTurn: 'First question after the history.', userTurnMessageId: first });
    h.reload();
    const again = h.seedOf();
    const second = h.saveUser('Question after the reload.');
    await h.start({ seed: again.seed, seedIds: again.seedIds, userTurn: 'Question after the reload.', userTurnMessageId: second });
  },
};

export const foldSummaryFails: Scenario = {
  id: 'fold-summary-fails', rows: ['T2'], title: 'when the summary is empty the fold drops the oldest and the run still answers',
  async run(h) {
    h.script([reply('Answered without a note.')], '');
    const { seed, seedIds } = longHistory(h, 20);
    const id = h.saveUser('Carry on.');
    await h.start({ seed, seedIds, userTurn: 'Carry on.', userTurnMessageId: id });
  },
};

export const stopDuringFold: Scenario = {
  id: 'stop-during-fold', rows: ['T2'], loopShows: ['agent.stopped'], title: 'a Stop pressed while the fold\'s summary is being written ends the run cleanly',
  async run(h) {
    let summarising = false;
    h.script([reply('Never reached.')], async () => {
      summarising = true;
      await new Promise((r) => setTimeout(r, 30));
      return SUMMARY;
    });
    const { seed, seedIds } = longHistory(h, 20);
    const id = h.saveUser('Carry on.');
    const run = h.begin({ seed, seedIds, userTurn: 'Carry on.', userTurnMessageId: id });
    await h.until(() => summarising, 'the summary call started');
    stopRun(h.key);
    await run;
  },
};

export const foldsInToolLoop: Scenario = {
  id: 'fold-in-tool-loop', rows: ['T2'], loopShows: ['context.compacted'], title: 'a tool loop that outgrows the window mid-run folds, then re-serves an exact re-read from the cache',
  async run(h) {
    h.tools({ read_file: (a) => ({ ok: true, path: (a as { path: string }).path, content: bulk((a as { path: string }).path, 4_000), totalLines: 800, offset: 1, truncated: false }) });
    const READS = 16;
    h.script([], SUMMARY);
    h.react(decide(({ call: n }) => {
      if (n <= READS) return completion({ toolCalls: [call('read_file', { path: `f${n}.ts` }, `c${n}`)], finishReason: 'tool_calls' });
      if (n === READS + 1) return completion({ toolCalls: [call('read_file', { path: 'f1.ts' }, `c${n}`)], finishReason: 'tool_calls' });
      return completion({ text: 'Done reading everything.' });
    }));
    await h.start({ userTurn: 'fix the deep link' });
  },
};

export const imageAttachment: Scenario = {
  id: 'image-attachment', rows: [], title: 'a turn carrying an image attachment reaches the model as vision parts and is saved as it was sent',
  async run(h) {
    h.script([calls([call('read_file', { path: 'a.ts' }, 'c1')]), reply('The screenshot shows a misaligned header.')]);
    h.tools(FILES);
    await h.start({
      userTurn: [
        { type: 'text', text: 'Why does the header look wrong?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      ],
    });
  },
};

export const foldScenarios: Scenario[] = [longChatFolds, twoRunsOneFold, reloadAfterFold, foldSummaryFails, stopDuringFold, foldsInToolLoop, imageAttachment];
