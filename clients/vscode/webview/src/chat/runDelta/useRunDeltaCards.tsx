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
 *  - "Open details" opens the `RunDeltaPanel` as a side sheet over the chat (non-modal), with the repository's run history
 *    and trend under its body (`run-delta/history`, `RunDeltaHistorySection`);
 *  - "Open code" asks the HOST (`run-delta/open { runId, path, line }`), which resolves the
 *    path under that delta's repository root; the webview never builds or sends an absolute path;
 *  - "Resolve" seeds the shared fix directive into the chat composer's draft (the chat surface
 *    owns `draftStore.set` — passed in as `onResolve`); the user reviews and sends it, never
 *    auto-sent (PRD 41 "Fix with agent" seeds the ONE composer);
 *  - "Copy diagnostics" writes the shared diagnostics text to the clipboard, with the view's ONE
 *    Copied / Copy-failed feedback beside the cards.
 *
 * The footer slot is a STABLE module-level function rendering {@link RunDeltaAfter}, which reads the
 * placed cards from context: a new card re-renders the small footers, never the memoized message rows.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { RunDelta } from '@builderforce/run-delta/contract';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import {
  CopiedNote,
  CopyFallback,
  RunDeltaCard,
  RunDeltaStatusCard,
  resolveDirectiveText,
  runDeltaDiagnosticsText,
  useCopyText,
  type RunDeltaCodeTarget,
  type RunDeltaLabels,
} from '@builderforce/knowledge-graph-view/delta';
import { repoDisplayName } from '@builderforce/knowledge-graph-view/delta/history';
import { onHostMessage, request } from '../../vscodeBridge';
import { RunDeltaOpenPanel } from './RunDeltaOpenPanel';
import { PredictedLine } from './PredictedLine';
import {
  RUN_DELTA_CARD, RUN_DELTA_GET, RUN_DELTA_OPEN_FILE, cardKey, cardsFromAnswer, isProgress, mergeCards, placeCards, safeRepoPath,
  type RunDeltaCardPayload,
} from './runDeltaCards';
import { useRunDeltaLabels } from './useRunDeltaLabels';
import { useRunDeltaRelease, type RunDeltaRelease } from './useRunDeltaRelease';

/** Below this width the panel is a bottom sheet (the chat is a narrow sidebar view). */
const COMPACT_BELOW_PX = 600;

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
  /** The shared fix directive behind *Resolve*, for the user to review and send (never auto-sent). */
  resolveText(delta: RunDelta): string;
  /** The chat surface's composer seed (`draftStore.set`): Resolve fills the draft with {@link resolveText}. Absent ⇒ no Resolve button. */
  onResolve?: ((text: string) => void) | undefined;
  /** Copies the full delta results as a diagnostic; the host owns the clipboard + Copied/Copy-failed feedback. */
  copyDiagnostics(delta: RunDelta): void;
}

const RunDeltaContext = createContext<RunDeltaFooters | null>(null);

/** Wraps the timeline with the chat's placed cards (`value` = {@link RunDeltaChat.footers}). */
export const RunDeltaFootersProvider = RunDeltaContext.Provider;

/**
 * A held card's hold state (§12.5), as the host read it from the run's execution: the rules (none for a run held because
 * it could not be measured), released or not, and "Release run" while it still holds.
 */
function heldOf(c: RunDeltaCardPayload, release: RunDeltaRelease) {
  if (!c.blocked) return undefined;
  const rules = c.blocked.rules;
  return {
    rules,
    unmeasured: c.blocked.unmeasured === true,
    released: c.released === true,
    onRelease: () => release.release(c.runId, rules),
    releasing: release.releasing.has(c.runId),
    refused: release.refused.get(c.runId),
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
        ? <RunDeltaStatusCard key={cardKey(c)} status={c.status} runId={c.runId} labels={ctx.labels} held={heldOf(c, ctx.release)} dynamicMinutes={c.dynamicMinutes} />
        : (
          <RunDeltaCard
            key={cardKey(c)}
            delta={c.delta}
            labels={ctx.labels}
            repoLabel={(ctx.reposPerRun.get(c.runId) ?? 0) > 1 ? repoDisplayName(c.repo) : undefined}
            onOpenDetails={() => ctx.openDetails(cardKey(c))}
            held={heldOf(c, ctx.release)}
            predicted={<PredictedLine predicted={c.predicted} />}
            onResolve={ctx.onResolve ? () => ctx.onResolve?.(ctx.resolveText(c.delta)) : undefined}
            onCopyDiagnostics={() => ctx.copyDiagnostics(c.delta)}
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

export function useRunDeltaCards(
  chatId: number | null,
  messages: readonly BrainMessage[],
  options?: { onResolve?: ((text: string) => void) | undefined },
): RunDeltaChat {
  const labels = useRunDeltaLabels();
  const compact = useCompact();
  const [cards, setCards] = useState<RunDeltaCardPayload[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);

  // The ONE copy behaviour (shared with the knowledge-graph view): clipboard +
  // Copied / Copy-failed feedback for "Copy diagnostics".
  const copier = useCopyText();
  const [lastCopied, setLastCopied] = useState<{ text: string; key: string } | null>(null);

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
    () => ({
      placed,
      reposPerRun,
      labels,
      openDetails: setOpenKey,
      release,
      resolveText: (delta) => resolveDirectiveText(labels, delta),
      onResolve: options?.onResolve,
      copyDiagnostics: (delta) => {
        const text = runDeltaDiagnosticsText(labels, delta, new Date().toISOString());
        setLastCopied((cur) => ({ text, key: cur?.key ?? '' }));
        void copier.copy(text);
      },
    }),
    [placed, reposPerRun, labels, release, copier, options?.onResolve],
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

  // The panel, with the repository's history and trend under its body (PRD 41 §C11.3).
  const panel = open
    ? (
      <>
        <RunDeltaOpenPanel
          card={open}
          labels={labels}
          compact={compact}
          onClose={() => setOpenKey(null)}
          onOpenCode={openCode}
          onResolve={options?.onResolve ? () => options.onResolve?.(resolveDirectiveText(labels, open.delta)) : undefined}
          onCopyDiagnostics={() => {
            const text = runDeltaDiagnosticsText(labels, open.delta, new Date().toISOString());
            setLastCopied({ text, key: cardKey(open) });
            void copier.copy(text);
          }}
        />
        <CopiedNote status={copier.status} labels={labels} />
        {lastCopied && (
          <CopyFallback status={copier.status} text={lastCopied.text} label={labels.copyDiagnostics} labels={labels} />
        )}
      </>
    )
    : null;

  return { footers, panel };
}
