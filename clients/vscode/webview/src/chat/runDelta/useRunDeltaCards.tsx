/**
 * The run delta in the editor chat (PRD 41 §C11, principle 6: the card shows in the chat that ran
 * the run — no separate analysis surface). This hook is the whole wiring; the thread wraps the
 * timeline in {@link RunDeltaFootersProvider}, passes {@link renderRunDeltaAfter} as the timeline's footer slot
 * (`renderAfterMessage`) and renders its `panel`:
 *
 *  - `run-delta/card` frames for the open chat become cards; `run-delta/get { chatId }` brings a
 *    reopened chat's cards back (the host answers the same payloads, oldest first);
 *  - each card renders under the reply that ended its run (`runDeltaCards.ts` places it);
 *  - "Open details" opens the `RunDeltaPanel` as a side sheet over the chat (non-modal);
 *  - "Open code" asks the HOST (`run-delta/open { runId, path, line }`), which resolves the
 *    path under that delta's repository root; the webview never builds or sends an absolute path.
 *
 * The footer slot is a STABLE module-level function rendering {@link RunDeltaAfter}, which reads the
 * placed cards from context: a new card re-renders the small footers, never the memoized message rows.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { RunDeltaCard, RunDeltaPanel, type RunDeltaCodeTarget, type RunDeltaLabels } from '@builderforce/knowledge-graph-view/delta';
import { onHostMessage, request } from '../../vscodeBridge';
import {
  RUN_DELTA_CARD, RUN_DELTA_GET, RUN_DELTA_OPEN_FILE, cardKey, cardsFromAnswer, mergeCards, placeCards, rememberAnchor, safeRepoPath,
  type RunDeltaCardPayload,
} from './runDeltaCards';
import { useRunDeltaLabels } from './useRunDeltaLabels';

/** Below this width the panel is a bottom sheet (the chat is a narrow sidebar view). */
const COMPACT_BELOW_PX = 600;

/** The repo's last path segment, for a run that touched more than one repository. */
const repoName = (repo: string): string => repo.replace(/[\\/]+$/, '').split(/[\\/:]/).filter(Boolean).pop() ?? repo;

function useCompact(): boolean {
  const query = `(max-width: ${COMPACT_BELOW_PX - 1}px)`;
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setCompact(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return compact;
}

export interface RunDeltaFooters {
  placed: ReadonlyMap<number, readonly RunDeltaCardPayload[]>;
  reposPerRun: ReadonlyMap<string, number>;
  labels: RunDeltaLabels;
  openDetails(key: string): void;
}

const RunDeltaContext = createContext<RunDeltaFooters | null>(null);

/** Wraps the timeline with the chat's placed cards (`value` = {@link RunDeltaChat.footers}). */
export const RunDeltaFootersProvider = RunDeltaContext.Provider;

/** The cards placed after one reply. */
function RunDeltaAfter({ messageId }: { messageId: number }) {
  const ctx = useContext(RunDeltaContext);
  const here = ctx?.placed.get(messageId);
  if (!ctx || !here) return null;
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 8, minWidth: 0 }}>
      {here.map((c) => (
        <RunDeltaCard
          key={cardKey(c)}
          delta={c.delta}
          labels={ctx.labels}
          repoLabel={(ctx.reposPerRun.get(c.runId) ?? 0) > 1 ? repoName(c.repo) : undefined}
          onOpenDetails={() => ctx.openDetails(cardKey(c))}
        />
      ))}
    </div>
  );
}

/** The timeline's footer slot (`renderAfterMessage`): stable, so the memoized rows never re-render for a card. */
export const renderRunDeltaAfter = (msg: BrainMessage): ReactNode => (msg.role === 'assistant' ? <RunDeltaAfter messageId={msg.id} /> : null);

export interface RunDeltaChat {
  /** The value of {@link RunDeltaFootersProvider} around the timeline. */
  footers: RunDeltaFooters;
  /** The open panel (a fixed side sheet over the chat), or null. */
  panel: ReactNode;
}

export function useRunDeltaCards(chatId: number | null, messages: readonly BrainMessage[]): RunDeltaChat {
  const labels = useRunDeltaLabels();
  const compact = useCompact();
  const [cards, setCards] = useState<RunDeltaCardPayload[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const replies = useMemo(() => messages.filter((m) => m.role === 'assistant').map((m) => m.id), [messages]);
  const lastReply = useRef<number | undefined>(undefined);
  lastReply.current = replies[replies.length - 1];
  /** The reply that was current when this chat's run last settled — the end of the run a delta belongs to. */
  const settledReply = useRef<number | undefined>(undefined);

  useEffect(() => {
    setCards([]);
    setOpenKey(null);
    settledReply.current = undefined;
    if (chatId == null) return;
    let live = true;
    // A reopened chat: the host's stored deltas for it. A failed read leaves only the live cards.
    request<unknown>(RUN_DELTA_GET, { chatId }).then(
      (answer) => { if (live) setCards((current) => mergeCards(cardsFromAnswer(answer), current)); },
      () => {},
    );
    // The delta is computed AFTER the run settles, and the reader may have sent another turn by then: the card belongs
    // to the reply that ended the run, so the reply current at `run.settled` is its anchor, not the one current on arrival.
    const offSettled = onHostMessage<{ chatId?: number }>('run.settled', ({ chatId: forChat }) => {
      if (forChat === chatId) settledReply.current = lastReply.current;
    });
    const off = onHostMessage<RunDeltaCardPayload & { type?: string }>(RUN_DELTA_CARD, ({ chatId: forChat, runId, repo, root, delta }) => {
      if (forChat !== chatId) return;
      const anchor = settledReply.current ?? lastReply.current;
      if (anchor !== undefined) rememberAnchor(runId, anchor);
      setCards((current) => mergeCards(current, [{ chatId: forChat, runId, repo, root, delta }]));
    });
    return () => { live = false; off(); offSettled(); };
  }, [chatId]);

  const placed = useMemo(() => placeCards(cards, replies), [cards, replies]);
  const reposPerRun = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cards) counts.set(c.runId, (counts.get(c.runId) ?? 0) + 1);
    return counts;
  }, [cards]);
  const footers = useMemo<RunDeltaFooters>(() => ({ placed, reposPerRun, labels, openDetails: setOpenKey }), [placed, reposPerRun, labels]);

  const open = openKey ? cards.find((c) => cardKey(c) === openKey) : undefined;
  const openCode = useMemo(() => {
    if (!open) return undefined;
    return (target: RunDeltaCodeTarget) => {
      // Only a repo-relative path the delta names; the host resolves it under the repository root and confines it there.
      const path = safeRepoPath(target.path);
      if (!path) return;
      void request(RUN_DELTA_OPEN_FILE, { runId: open.runId, path, ...(target.line ? { line: target.line } : {}) }).catch(() => {});
    };
  }, [open]);

  const panel = open ? (
    // A fixed layer the size of the chat that lets clicks through: the sheet docks to its edge, the transcript stays usable.
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto' }}>
        <RunDeltaPanel open delta={open.delta} labels={labels} onClose={() => setOpenKey(null)} onOpenCode={openCode} compact={compact} />
      </div>
    </div>
  ) : null;

  return { footers, panel };
}
