import { useTranslations } from 'next-intl';
import type { ExecutionTraceToolEvent } from '@/lib/builderforceApi';

/**
 * NO `'use client'`, and that is a judgement about THIS file, not about its callers.
 * It is props in, markup out: no state, no effect, no handler, no browser API. Its one
 * hook is next-intl's `useTranslations`, which renders in a Server Component as well
 * as a client one. So the component is isomorphic, and a directive would only take
 * that away — it would turn `thinkingEventsOf` into a client reference a server
 * surface could not call, and force a client boundary on a run transcript that a
 * server-rendered report could otherwise print. A client host pulls it into its
 * bundle by importing it, the `ResumeDocumentView` shape in the architecture ratchet's
 * changelog. Put the directive back only when this file gains state or a handler.
 *
 * THE REASONING A RUN RECORDED.
 *
 * A reasoning-capable model's thought for each turn is persisted as an
 * `agent.thinking` row (category `thinking`) whose `args` carries the FULL text
 * under `content`; `result` is only a 280-character preview, and the Observability
 * timeline draws 120 characters of that. This is where the reasoning is read
 * whole, in the order the run produced it.
 *
 * Self-contained: hand it the run's trace events through {@link thinkingEventsOf}
 * and it renders its own empty state.
 */

export interface RunThought {
  id: number;
  ts: string;
  text: string;
  step?: number;
  model?: string;
}

function isThinkingEvent(event: ExecutionTraceToolEvent): boolean {
  return event.category === 'thinking' || event.toolName === 'agent.thinking';
}

function detailOf(args: string | undefined): { content?: unknown; step?: unknown; model?: unknown } {
  if (!args || !args.trim().startsWith('{')) return {};
  try {
    return JSON.parse(args) as { content?: unknown; step?: unknown; model?: unknown };
  } catch {
    return {};
  }
}

/** The run's thoughts, oldest first — the full text, falling back to the preview for older rows. */
export function thinkingEventsOf(events: readonly ExecutionTraceToolEvent[]): RunThought[] {
  return events
    .filter(isThinkingEvent)
    .map((event) => {
      const detail = detailOf(event.args);
      const full = typeof detail.content === 'string' && detail.content.trim() ? detail.content : (event.result ?? '');
      return {
        id: event.id,
        ts: event.ts,
        text: full.trim(),
        ...(typeof detail.step === 'number' ? { step: detail.step } : {}),
        ...(typeof detail.model === 'string' && detail.model ? { model: detail.model } : {}),
      };
    })
    .filter((thought) => thought.text)
    .sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id);
}

export function RunThinkingPanel({ thoughts }: { thoughts: readonly RunThought[] }) {
  const t = useTranslations('agentExecution');
  if (thoughts.length === 0) {
    return <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', padding: 8 }}>{t('noThinking')}</div>;
  }
  return (
    <div data-testid="run-thinking" style={{ minHeight: 80, maxHeight: 360, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {thoughts.map((thought) => (
        <section key={thought.id} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
          {(thought.step != null || thought.model) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginBottom: 4 }}>
              {thought.step != null && <span>{t('thinkingStep', { step: thought.step })}</span>}
              {thought.model && <span style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{thought.model}</span>}
            </div>
          )}
          <div style={{ fontSize: 'var(--font-size-small)', lineHeight: 1.55, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {thought.text}
          </div>
        </section>
      ))}
    </div>
  );
}
