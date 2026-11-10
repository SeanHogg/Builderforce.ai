/**
 * The run delta in the editor chat (PRD 41 §C11, principle 6: the card shows in the chat that ran
 * the run — no separate analysis surface). This hook is the whole wiring; the thread wraps the
 * timeline in {@link RunDeltaFootersProvider}, passes {@link renderRunDeltaAfter} as the timeline's footer slot
 * (`renderAfterMessage`) and renders its `panel`:
 *
 *  - `run-delta/card` frames for the open chat become cards; `run-delta/get { chatId }` brings a
 *    reopened chat's cards back (the host answers the same payloads, oldest first);
 *  - a run shows "Measuring…" the moment its delta starts, then its computed cards (or not
 *    measured); each renders under the reply its run produced, as the host names it (`at`);
 *  - a run its delta HELD (§12.5) shows the rules and "Release run" (`useRunDeltaRelease.ts`);
 *  - "Open details" opens the `RunDeltaPanel` as a side sheet over the chat (non-modal);
 *  - "Open code" asks the HOST (`run-delta/open { runId, path, line }`), which resolves the
 *    path under that delta's repository root; the webview never builds or sends an absolute path.
 *
 * The footer slot is a STABLE module-level function rendering {@link RunDeltaAfter}, which reads the
 * placed cards from context: a new card re-renders the small footers, never the memoized message rows.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { RunDeltaCard, RunDeltaPanel, RunDeltaStatusCard, type RunDeltaCodeTarget, type RunDeltaLabels } from '@builderforce/knowledge-graph-view/delta';
import { onHostMessage, request } from '../../vscodeBridge';
import {
  RUN_DELTA_CARD, RUN_DELTA_GET, RUN_DELTA_OPEN_FILE, cardKey, cardsFromAnswer, isProgress, mergeCards, placeCards, safeRepoPath,
  type ComputedCard, type RunDeltaCardPayload,
} from './runDeltaCards';
import { useRunDeltaLabels } from './useRunDeltaLabels';
import { useRunDeltaRelease, type RunDeltaRelease } from './useRunDeltaRelease';

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
  release: RunDeltaRelease;
}

const RunDeltaContext = createContext<RunDeltaFooters | null>(null);

/** Wraps the timeline with the chat's placed cards (`value` = {@link RunDeltaChat.footers}). */
export const RunDeltaFootersProvider = RunDeltaContext.Provider;

/** A held card's hold state (§12.5): the rules, released or not, and "Release run" while it still holds. */
function heldOf(c: ComputedCard, release: RunDeltaRelease) {
  const rules = c.blocked?.rules ?? [];
  if (rules.length === 0) return undefined;
  return {
    rules,
    released: c.released === true,
    onRelease: () => release.release(c.runId, rules),
    releasing: release.releasing.has(c.runId),
    refused: release.refused.has(c.runId),
  };
}

/** The cards placed after one reply. */
function RunDeltaAfter({ messageId }: { messageId: number }) {
  const ctx = useContext(RunDeltaContext);
  const here = ctx?.placed.get(messageId);
  if (!ctx || !here) return null;
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 8, minWidth: 0 }}>
      {here.map((c) => (isProgress(c)
        ? <RunDeltaStatusCard key={cardKey(c)} status={c.status} runId={c.runId} labels={ctx.labels} />
        : (
          <RunDeltaCard
            key={cardKey(c)}
            delta={c.delta}
            labels={ctx.labels}
            repoLabel={(ctx.reposPerRun.get(c.runId) ?? 0) > 1 ? repoName(c.repo) : undefined}
            onOpenDetails={() => ctx.openDetails(cardKey(c))}
            held={heldOf(c, ctx.release)}
          />
        )))}
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

  const release = useRunDeltaRelease(labels);

  const replies = useMemo(() => messages.filter((m) => m.role === 'assistant').map((m) => m.id), [messages]);

  useEffect(() => {
    setCards([]);
    setOpenKey(null);
    if (chatId == null) return;
    let live = true;
    // A reopened chat: the host's stored deltas for it. A failed read leaves only the live cards.
    request<unknown>(RUN_DELTA_GET, { chatId }).then(
      (answer) => { if (live) setCards((current) => mergeCards(cardsFromAnswer(answer), current)); },
      () => {},
    );
    // Pending, computed and failed cards alike; each names the reply its run produced (`at`), where it sits.
    const off = onHostMessage<RunDeltaCardPayload & { type?: string }>(RUN_DELTA_CARD, ({ type: _type, ...card }) => {
      if (card.chatId !== chatId) return;
      setCards((current) => mergeCards(current, cardsFromAnswer([card])));
    });
    return () => { live = false; off(); };
  }, [chatId]);

  const placed = useMemo(() => placeCards(cards, replies), [cards, replies]);
  const reposPerRun = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cards) if (!isProgress(c)) counts.set(c.runId, (counts.get(c.runId) ?? 0) + 1);
    return counts;
  }, [cards]);
  const footers = useMemo<RunDeltaFooters>(
    () => ({ placed, reposPerRun, labels, openDetails: setOpenKey, release }),
    [placed, reposPerRun, labels, release],
  );

  const found = openKey ? cards.find((c) => cardKey(c) === openKey) : undefined;
  const open = found && !isProgress(found) ? found : undefined;
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
        <RunDeltaPanel open delta={open.delta} overrides={open.overrides} labels={labels} onClose={() => setOpenKey(null)} onOpenCode={openCode} compact={compact} />
      </div>
    </div>
  ) : null;

  return { footers, panel };
}
