/**
 * The "ask the user a question" protocol — shared by the web app and the VS Code
 * webview so a clarifying question renders identically as a clickable card on both.
 *
 * The agent emits its question as a fenced ```ask-user block carrying a small JSON
 * payload (produced server-side when the model calls the `ask_user` tool — a
 * schema-validated call is far more reliable than asking a weak model to hand-format
 * JSON in prose). {@link parseAskUser} lifts that payload out of an assistant message
 * and {@link stripAskUser} removes the raw block so the surrounding prose still reads
 * cleanly; <BrainTimeline> renders the payload with <QuestionCard>. If the block is
 * absent or malformed, both degrade gracefully (no card; the fenced block just shows
 * as normal code), so a question is never lost.
 */

import { useMemo, useState } from 'react';

export interface AskUserOption {
  label: string;
  description?: string;
}

export interface AskUserPayload {
  question: string;
  options: AskUserOption[];
  /** Allow more than one option to be chosen (checkboxes + submit) instead of a
   *  single click. */
  multiSelect?: boolean;
}

/** Copy for <QuestionCard> — defaulted in English, overridable per host for i18n. */
export interface AskUserLabels {
  /** Submit button for a multi-select card. */
  askSubmit: string;
  /** Shown on the card once the user has answered (buttons disabled). */
  askAnswered: string;
}

export const DEFAULT_ASK_USER_LABELS: AskUserLabels = {
  askSubmit: 'Send',
  askAnswered: 'Answered',
};

/** The fenced info-string the agent tags its question block with. */
const ASK_USER_FENCE = /```ask-user\s*\n([\s\S]*?)\n```/i;

function coercePayload(raw: unknown): AskUserPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const question = typeof o.question === 'string' ? o.question.trim() : '';
  const optionsIn = Array.isArray(o.options) ? o.options : [];
  const options: AskUserOption[] = optionsIn
    .map((it): AskUserOption | null => {
      if (typeof it === 'string') return it.trim() ? { label: it.trim() } : null;
      if (it && typeof it === 'object') {
        const rec = it as Record<string, unknown>;
        const label = typeof rec.label === 'string' ? rec.label.trim() : '';
        const description = typeof rec.description === 'string' ? rec.description.trim() : undefined;
        return label ? { label, ...(description ? { description } : {}) } : null;
      }
      return null;
    })
    .filter((x): x is AskUserOption => !!x);
  // A question card is only meaningful with a prompt AND at least two choices.
  if (!question || options.length < 2) return null;
  return { question, options, multiSelect: o.multiSelect === true };
}

/** Extract the ask-user payload from an assistant message, or null if none/invalid. */
export function parseAskUser(text: string): AskUserPayload | null {
  if (!text || !text.includes('ask-user')) return null;
  const m = text.match(ASK_USER_FENCE);
  if (!m) return null;
  try {
    return coercePayload(JSON.parse(m[1]));
  } catch {
    return null;
  }
}

/** Remove the raw ask-user fenced block so the message's prose reads cleanly beside
 *  the rendered card. Collapses the whitespace the removed block leaves behind. */
export function stripAskUser(text: string): string {
  if (!text) return text;
  return text.replace(ASK_USER_FENCE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Serialize a payload into the canonical fenced block the agent runtime emits and
 * {@link parseAskUser} reads. Shared so the producer (server) and consumer (UI) can
 * never drift on the format.
 */
export function serializeAskUser(payload: AskUserPayload): string {
  return ['```ask-user', JSON.stringify(payload), '```'].join('\n');
}

/**
 * A clarifying question rendered as clickable options. Single-select sends the
 * chosen label on click; multi-select collects checkboxes behind a submit button.
 * The chosen label(s) are handed to `onAnswer`, which the host posts as the user's
 * next turn — so the model's question and the user's answer stay in the transcript.
 */
export function QuestionCard({
  payload,
  labels,
  onAnswer,
}: {
  payload: AskUserPayload;
  labels?: Partial<AskUserLabels>;
  onAnswer: (answer: string) => void;
}) {
  const lab = useMemo(() => ({ ...DEFAULT_ASK_USER_LABELS, ...labels }), [labels]);
  const [answered, setAnswered] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const multi = payload.multiSelect === true;

  const commit = (answer: string) => {
    if (answered || !answer.trim()) return;
    setAnswered(answer);
    onAnswer(answer);
  };
  const toggle = (i: number) => {
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };
  const submitMulti = () => {
    const picks = payload.options.filter((_, i) => checked.has(i)).map((o) => o.label);
    if (picks.length) commit(picks.join(', '));
  };

  return (
    <div className={`bf-qcard${answered ? ' bf-qcard--done' : ''}`} role="group" aria-label={payload.question}>
      <div className="bf-qcard__q">{payload.question}</div>
      <div className="bf-qcard__opts">
        {payload.options.map((opt, i) =>
          multi ? (
            <label key={i} className={`bf-qcard__opt bf-qcard__opt--check${checked.has(i) ? ' is-checked' : ''}`}>
              <input
                type="checkbox"
                className="bf-qcard__cb"
                checked={checked.has(i)}
                disabled={!!answered}
                onChange={() => toggle(i)}
              />
              <span className="bf-qcard__opt-body">
                <span className="bf-qcard__opt-label">{opt.label}</span>
                {opt.description && <span className="bf-qcard__opt-desc">{opt.description}</span>}
              </span>
            </label>
          ) : (
            <button
              key={i}
              type="button"
              className="bf-qcard__opt bf-qcard__opt--btn"
              disabled={!!answered}
              onClick={() => commit(opt.label)}
            >
              <span className="bf-qcard__opt-label">{opt.label}</span>
              {opt.description && <span className="bf-qcard__opt-desc">{opt.description}</span>}
            </button>
          ),
        )}
      </div>
      {multi && !answered && (
        <button type="button" className="bf-qcard__submit" disabled={checked.size === 0} onClick={submitMulti}>
          {lab.askSubmit}
        </button>
      )}
      {answered && <div className="bf-qcard__answered">{`${lab.askAnswered}: ${answered}`}</div>}
    </div>
  );
}
