/**
 * A run's auto-compaction, made DURABLE — the fold's note persisted as an auto
 * consolidation marker so the next run on this chat (after a reload, on another surface)
 * seeds from the note instead of summarizing the whole history again.
 *
 * The coverage rule is the memory package's (`foldKeepFromId`, `scopeToConsolidation`,
 * `@seanhogg/builderforce-memory/working`); this module only knows which persisted
 * message each transcript entry is, and writes the row.
 */

import {
  consolidationMarkerContent,
  consolidationMetadata,
  foldKeepFromId,
  type TranscriptFold,
} from '@seanhogg/builderforce-memory/working';
import { replayTextOf } from '@builderforce/agent-loop';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { contentText } from '../localSuccess/turnFeatures';
import type { RunCell } from './runCell';
import type { BrainRunPersistence, BrainRunRequest } from './runTypes';
import { emit, nowIso, pushTrace, recordAppended } from './runCells';

/** What makes a transcript entry and a seed entry the same message (assistant text as replayed). */
function entryKey(m: ChatCompletionMessage): string {
  return `${m.role}\u0000${m.role === 'assistant' ? replayTextOf(contentText(m.content ?? '')) : contentText(m.content ?? '')}`;
}

/**
 * The cell's transcript was seeded by an EARLIER request, and this run's history may hold
 * messages persisted since that it never saw. Match the history against the transcript in
 * order: a match is anchored (its id is now known), a miss sets `unseenFromId`.
 */
function anchorPersistedHistory(c: RunCell, seed: readonly ChatCompletionMessage[], seedIds: readonly number[]): void {
  const at = new Map<string, number[]>();
  c.transcript.forEach((m, i) => {
    const key = entryKey(m);
    const list = at.get(key);
    if (list) list.push(i); else at.set(key, [i]);
  });
  let from = 0;
  seed.forEach((m, k) => {
    const id = seedIds[k]!;
    const index = at.get(entryKey(m))?.find((i) => i >= from);
    if (index === undefined) {
      c.unseenFromId = c.unseenFromId === undefined ? id : Math.min(c.unseenFromId, id);
      return;
    }
    if (!c.transcriptAnchors.some((a) => a.index === index)) c.transcriptAnchors.push({ index, id });
    from = index + 1;
  });
}

/**
 * Record which persisted messages the cell's transcript holds, before the run's first
 * turn: the seeded history (by identity when the transcript was seeded from THIS request,
 * else matched in order — see {@link anchorPersistedHistory}) and the run's user turn.
 */
export function recordTranscriptAnchors(c: RunCell, req: Pick<BrainRunRequest, 'seed' | 'seedIds' | 'userTurn' | 'userTurnMessageId'>): void {
  const t = c.transcript;
  const { seed, seedIds } = req;
  c.unseenFromId = undefined;
  if (seed && seedIds && seed.length > 0 && seedIds.length === seed.length) {
    if (t[0] === seed[0] && t[seed.length - 1] === seed[seed.length - 1]) {
      c.transcriptAnchors = seedIds.map((id, index) => ({ index, id }));
    } else {
      anchorPersistedHistory(c, seed, seedIds);
    }
  }
  if (req.userTurnMessageId == null || req.userTurn === undefined) return;
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i]!.role === 'user' && t[i]!.content === req.userTurn) {
      if (!c.transcriptAnchors.some((a) => a.index === i)) c.transcriptAnchors.push({ index: i, id: req.userTurnMessageId });
      return;
    }
  }
}

/**
 * Persist a fold as an auto marker. Skipped when no persisted message precedes the cut:
 * a marker that cannot say where its verbatim part begins would read as covering the
 * whole history, and the next seed would lose what the note did not hold. Keeps from no
 * later than the first persisted message the transcript never held (`unseenFromId`) — the
 * note cannot have covered it. Best-effort — the fold already applies to this run; only
 * its durability is at stake.
 */
export async function persistFoldMarker(c: RunCell, chatId: number, persistence: BrainRunPersistence, fold: TranscriptFold): Promise<void> {
  const covered = foldKeepFromId(c.transcriptAnchors, fold.coveredEnd);
  if (covered === undefined) return;
  const keepFromId = c.unseenFromId === undefined ? covered : Math.min(covered, c.unseenFromId);
  try {
    const [msg] = await persistence.sendMessages(chatId, [{
      role: 'assistant',
      content: consolidationMarkerContent(fold.note),
      metadata: consolidationMetadata({ keepFromId, folded: fold.droppedMessages }),
    }]);
    if (msg) {
      recordAppended(c, msg);
      emit(c);
    }
  } catch (error) {
    // Durability only — the run keeps its in-memory note; the reason is kept on the trace.
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'context.compact_persist_failed',
      args: { coveredEnd: fold.coveredEnd },
      result: `The compaction note could not be saved (${error instanceof Error ? error.message : String(error)}) — the next run will summarize this history again.`,
    });
  }
}
