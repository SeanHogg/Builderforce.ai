'use client';

/**
 * ONE control per poll format — what a participant actually touches.
 *
 * ── WHY THE SWITCH IS EXHAUSTIVE ─────────────────────────────────────────────
 * It is exhaustive over `PollFormat`, so a ninth instrument added to the contract fails
 * to COMPILE here rather than silently rendering as a text box that collects something
 * nobody asked for. That is the same rule `QuestionControl` follows for the nine form
 * field types, and it is the only thing that keeps "add a format" from meaning "add a
 * format and hope somebody remembers the control".
 *
 * ── WHY EVERY CONTROL IS A TAP ───────────────────────────────────────────────
 * This is answered standing up, one-handed, on a phone, at arm's length, in a room where
 * the facilitator is waiting. So a ranking is reordered with two buttons rather than a
 * drag, a 2x2 is placed with a tap rather than a drag, and an option is a whole 52px
 * card rather than a 20px radio beside a label. None of that is decoration: a control
 * that needs a second hand is one a third of the room does not answer with.
 */

import { useTranslations } from 'next-intl';
import type { PollFormat, PollOption } from '@builderforce/creation-canvas-contract';
import { POLL_SCALE_DEFAULT } from '@builderforce/creation-canvas-contract';
import styles from './PollJoin.module.css';

export interface PollAnswerControlProps {
  format: PollFormat;
  options: readonly PollOption[];
  scaleMax: number | null;
  grid: { xLabel: string; yLabel: string } | null;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

export function PollAnswerControl({ format, options, scaleMax, grid, value, onChange, disabled }: PollAnswerControlProps) {
  const t = useTranslations('poll');

  switch (format) {
    case 'choice':
    case 'quiz':
      return (
        <div className={styles.options} role="radiogroup" aria-label={t('chooseOne')}>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={value === option.id}
              disabled={disabled}
              className={value === option.id ? `${styles.option} ${styles.optionOn}` : styles.option}
              onClick={() => onChange(option.id)}
            >
              <span className={styles.optionMark} aria-hidden>{value === option.id ? '●' : '○'}</span>
              {option.label}
            </button>
          ))}
        </div>
      );

    case 'multiChoice': {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <div className={styles.options} role="group" aria-label={t('chooseAny')}>
          {options.map((option) => {
            const on = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                className={on ? `${styles.option} ${styles.optionOn}` : styles.option}
                onClick={() => onChange(on ? selected.filter((id) => id !== option.id) : [...selected, option.id])}
              >
                <span className={styles.optionMark} aria-hidden>{on ? '☑' : '☐'}</span>
                {option.label}
              </button>
            );
          })}
        </div>
      );
    }

    case 'scale': {
      const max = scaleMax ?? POLL_SCALE_DEFAULT;
      const current = Number(value);
      return (
        <div className={styles.scale} role="radiogroup" aria-label={t('chooseScale', { max })}>
          {Array.from({ length: max }, (_, index) => index + 1).map((point) => (
            <button
              key={point}
              type="button"
              role="radio"
              aria-checked={current === point}
              disabled={disabled}
              className={current === point ? `${styles.scaleButton} ${styles.scaleButtonOn}` : styles.scaleButton}
              onClick={() => onChange(point)}
            >
              {point}
            </button>
          ))}
        </div>
      );
    }

    case 'ranking': {
      // The ballot starts in the order the facilitator wrote it, NOT shuffled: a person
      // who agrees with the given order should be able to send it, and a shuffle would
      // make "I did not reorder anything" indistinguishable from a random answer.
      const order: string[] = Array.isArray(value) && value.length
        ? value.map(String).filter((id) => options.some((option) => option.id === id))
        : options.map((option) => option.id);
      const move = (index: number, by: number) => {
        const next = [...order];
        const target = index + by;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
      };
      return (
        <ol className={styles.options} aria-label={t('rankThem')}>
          {order.map((id, index) => (
            <li key={id} className={`${styles.option} ${styles.rankRow}`}>
              <span className={styles.rankPosition}>{index + 1}</span>
              <span className={styles.rankLabel}>{options.find((option) => option.id === id)?.label ?? id}</span>
              <button
                type="button" className={styles.rankButton} disabled={disabled || index === 0}
                aria-label={t('moveUp', { position: index + 1 })} onClick={() => move(index, -1)}
              >↑</button>
              <button
                type="button" className={styles.rankButton} disabled={disabled || index === order.length - 1}
                aria-label={t('moveDown', { position: index + 1 })} onClick={() => move(index, 1)}
              >↓</button>
            </li>
          ))}
        </ol>
      );
    }

    case 'grid': {
      const point = (value && typeof value === 'object' ? value : null) as { x?: number; y?: number } | null;
      const place = (event: React.MouseEvent<HTMLDivElement>) => {
        if (disabled) return;
        const box = event.currentTarget.getBoundingClientRect();
        onChange({
          x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
          // Inverted because a 2x2 reads upwards and the DOM reads downwards.
          y: Math.min(1, Math.max(0, 1 - (event.clientY - box.top) / box.height)),
        });
      };
      // Keyboard: the centre is the fallback, and the arrow keys nudge from there. A 2x2
      // reachable only by pointer is one a keyboard user cannot answer at all.
      const nudge = (dx: number, dy: number) => {
        const current = { x: point?.x ?? 0.5, y: point?.y ?? 0.5 };
        onChange({
          x: Math.min(1, Math.max(0, current.x + dx)),
          y: Math.min(1, Math.max(0, current.y + dy)),
        });
      };
      return (
        <div
          className={styles.placer}
          role="application"
          aria-label={t('placeOnGrid', { x: grid?.xLabel ?? '', y: grid?.yLabel ?? '' })}
          tabIndex={disabled ? -1 : 0}
          onClick={place}
          onKeyDown={(event) => {
            const step = 0.05;
            if (event.key === 'ArrowLeft') { event.preventDefault(); nudge(-step, 0); }
            if (event.key === 'ArrowRight') { event.preventDefault(); nudge(step, 0); }
            if (event.key === 'ArrowUp') { event.preventDefault(); nudge(0, step); }
            if (event.key === 'ArrowDown') { event.preventDefault(); nudge(0, -step); }
          }}
        >
          <span className={`${styles.placerAxis} ${styles.placerAxisX}`} aria-hidden />
          <span className={`${styles.placerAxis} ${styles.placerAxisY}`} aria-hidden />
          {grid?.xLabel && <span className={`${styles.placerLabel} ${styles.placerLabelX}`}>{grid.xLabel}</span>}
          {grid?.yLabel && <span className={`${styles.placerLabel} ${styles.placerLabelY}`}>{grid.yLabel}</span>}
          {point && Number.isFinite(point.x) && Number.isFinite(point.y) && (
            <span className={styles.placerPin} style={{ left: `${(point.x ?? 0) * 100}%`, top: `${(1 - (point.y ?? 0)) * 100}%` }} aria-hidden />
          )}
        </div>
      );
    }

    case 'wordCloud':
      // Short and single-line: a cloud is built from words, and a textarea invites a
      // sentence that contributes "the" to the shape and nothing else.
      return (
        <input
          type="text"
          className={styles.input}
          maxLength={80}
          disabled={disabled}
          placeholder={t('wordPlaceholder')}
          aria-label={t('wordPlaceholder')}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'openText':
      return (
        <textarea
          className={styles.textarea}
          maxLength={500}
          disabled={disabled}
          placeholder={t('answerPlaceholder')}
          aria-label={t('answerPlaceholder')}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}
