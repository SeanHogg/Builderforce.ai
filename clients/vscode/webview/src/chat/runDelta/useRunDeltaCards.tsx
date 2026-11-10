/**
 * The run delta in the editor chat (PRD 41 §C11, principle 6: the card shows in the chat that ran
 * the run — no separate analysis surface). This hook is the whole wiring, so the thread only
 * passes its `renderMessage` to the timeline and renders its `panel`:
 *
 *  - `run-delta/card` frames for the open chat become cards; `run-delta/get { chatId }` brings a
 *    reopened chat's cards back (the host answers the same payloads, oldest first);
 *  - each card renders under the reply that ended its run (`runDeltaCards.ts` places it);
 *  - "Open details" opens the `RunDeltaPanel` as a side sheet over the chat (non-modal);
 *  - "Open code" posts the editor's existing `canvas.openFile`.
 *
 * `renderMessage` re-states the timeline's default body (translated text → Markdown) — the
 * timeline's one seam for adding to a message's body — and appends the cards after it.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { BrainTimeline, Markdown, TranslatableText } from '@seanhogg/builderforce-brain-ui';
import { RunDeltaCard, RunDeltaPanel, type RunDeltaCodeTarget } from '@builderforce/knowledge-graph-view/delta';
import { onHostMessage, post, request } from '../../vscodeBridge';
import {
  RUN_DELTA_CARD, RUN_DELTA_GET, cardKey, cardsFromAnswer, mergeCards, placeCards, rememberAnchor, type RunDeltaCardPayload,
} from './runDeltaCards';
import { useRunDeltaLabels } from './useRunDeltaLabels';

type TimelineProps = ComponentProps<typeof BrainTimeline>;

/** Below this width the panel is a bottom sheet (the chat is a narrow sidebar view). */
const COMPACT_BELOW_PX = 600;

/** A local repository root (POSIX or Windows), as opposed to a remote URL identity. */
const isLocalRoot = (repo: string): boolean => /^(\/|[A-Za-z]:[\\/])/.test(repo);

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

export interface RunDeltaChat {
  renderMessage: NonNullable<TimelineProps['renderMessage']>;
  /** The open panel (a fixed side sheet over the chat), or null. */
  panel: ReactNode;
}

export function useRunDeltaCards(chatId: number | null, messages: readonly BrainMessage[], markdownLabels: TimelineProps['labels']): RunDeltaChat {
  const labels = useRunDeltaLabels();
  const compact = useCompact();
  const [cards, setCards] = useState<RunDeltaCardPayload[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const replies = useMemo(() => messages.filter((m) => m.role === 'assistant').map((m) => m.id), [messages]);
  const lastReply = useRef<number | undefined>(undefined);
  lastReply.current = replies[replies.length - 1];

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
    const off = onHostMessage<RunDeltaCardPayload & { type?: string }>(RUN_DELTA_CARD, ({ chatId: forChat, runId, repo, delta }) => {
      if (forChat !== chatId) return;
      // The run just settled: its card follows the reply that ended it, here and when the chat reopens.
      if (lastReply.current !== undefined) rememberAnchor(runId, lastReply.current);
      setCards((current) => mergeCards(current, [{ chatId: forChat, runId, repo, delta }]));
    });
    return () => { live = false; off(); };
  }, [chatId]);

  const placed = useMemo(() => placeCards(cards, replies), [cards, replies]);
  const reposPerRun = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cards) counts.set(c.runId, (counts.get(c.runId) ?? 0) + 1);
    return counts;
  }, [cards]);

  const renderMessage = useCallback<RunDeltaChat['renderMessage']>((msg, ctx) => {
    const body = (
      <TranslatableText
        text={ctx.text}
        contentId={`msg:${msg.id}`}
        enabled={ctx.translate}
        render={(shown) => <Markdown content={shown} labels={markdownLabels} />}
      />
    );
    const here = ctx.role === 'assistant' ? placed.get(msg.id) : undefined;
    if (!here) return body;
    return (
      <>
        {body}
        <div style={{ display: 'grid', gap: 8, marginTop: 8, minWidth: 0 }}>
          {here.map((c) => (
            <RunDeltaCard
              key={cardKey(c)}
              delta={c.delta}
              labels={labels}
              repoLabel={(reposPerRun.get(c.runId) ?? 0) > 1 ? repoName(c.repo) : undefined}
              onOpenDetails={() => setOpenKey(cardKey(c))}
            />
          ))}
        </div>
      </>
    );
  }, [placed, labels, markdownLabels, reposPerRun]);

  const open = openKey ? cards.find((c) => cardKey(c) === openKey) : undefined;
  const openCode = useMemo(() => {
    if (!open || !isLocalRoot(open.repo)) return undefined;
    const root = open.repo.replace(/[\\/]+$/, '');
    return (target: RunDeltaCodeTarget) => post('canvas.openFile', {
      path: `${root}/${target.path}`,
      ...(target.line ? { range: { startLine: target.line, startColumn: 1, endLine: target.line, endColumn: 1 } } : {}),
    });
  }, [open]);

  const panel = open ? (
    // A fixed layer the size of the chat that lets clicks through: the sheet docks to its edge, the transcript stays usable.
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto' }}>
        <RunDeltaPanel open delta={open.delta} labels={labels} onClose={() => setOpenKey(null)} onOpenCode={openCode} compact={compact} />
      </div>
    </div>
  ) : null;

  return { renderMessage, panel };
}
