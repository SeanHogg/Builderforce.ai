import { MathAwareText } from '@/components/academic/MathAwareText';
import type { CreationNodeData } from '../types';
import styles from '../CreationCanvas.module.css';

/*
 * Helpers more than one card body reads. ONE copy each: a second `textValue` in a body
 * file is the duplication that lets two cards disagree about what counts as blank.
 */

export function authoredText(data: CreationNodeData): string | null {
  const value = [data.content, data.markdown, data.code, data.transcript, data.subtitle].find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? value : null;
}

export function asRecord(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fallback;
}

export function AuthoredContent({ data, fallback }: { data: CreationNodeData; fallback: string }) {
  return <MathAwareText className={styles.authoredContent} text={authoredText(data) || fallback} />;
}

export function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** Compact engagement numbers: 12400 reads as 12.4k on a 460px tile. */
export function compactCount(value: unknown): string {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function scoreTone(score: unknown): 'good' | 'watch' | 'risk' | 'empty' {
  if (score == null || score === '') return 'empty';
  const value = Number(score);
  if (!Number.isFinite(value)) return 'empty';
  if (value >= 80) return 'good';
  if (value >= 60) return 'watch';
  return 'risk';
}

export function optionLabel(value: unknown, labels: Record<string, string>, fallback: string): string {
  return typeof value === 'string' && labels[value] ? labels[value] : fallback;
}
