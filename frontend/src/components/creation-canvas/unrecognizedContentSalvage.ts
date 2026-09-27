import type { CreationObjectKind } from './types';
import { creationObjectContentFields, creationObjectMutableFields, isAuthored, isSensitiveMutationKey } from './creationObjectRegistry';

/**
 * Authored work sent under field names the kind does not declare, kept as the kind's
 * `content` instead of being thrown away.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ───────────────────────────────────────────────
 * Measured 2026-09-27 (ui 2026.9.39): "show me evermind training" sent an `evermind`
 * with `description`, `trainingConfig`, `evaluationConfig` and `teachConfig`, and a
 * `trainingRun` with `modelId`, `config` and `metrics`. None of those names is
 * declared, so the sanitizer dropped every one and `emptyShellProblem` refused both
 * calls as title-only, even though the model had written the work.
 *
 * `emptyShellProblem` exists to stop a card holding only its title. It was never meant
 * to refuse a card that holds real content under the wrong names. So this default
 * applies only where that content exists. A card with just a title is still refused.
 */
export interface ContentSalvage {
  readonly authored: Record<string, unknown>;
  /** The undeclared keys that were kept in `content`; empty when nothing was kept. */
  readonly folded: readonly string[];
}

const MAX_SALVAGED_CONTENT = 40_000;
const MAX_RENDER_DEPTH = 4;

export function salvageUnrecognizedContent(
  kind: CreationObjectKind,
  fields: unknown,
  authored: Record<string, unknown>,
): ContentSalvage {
  const unchanged: ContentSalvage = { authored, folded: [] };
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return unchanged;
  if (isAuthored(authored.content) || !creationObjectContentFields(kind).includes('content')) return unchanged;
  const declared = new Set(creationObjectMutableFields(kind));
  const stray = Object.entries(fields as Record<string, unknown>)
    .filter(([key, value]) => !declared.has(key) && !isSensitiveMutationKey(key) && isAuthored(value));
  if (stray.length === 0) return unchanged;
  const content = stray.map(([key, value]) => renderEntry(key, value, 0)).join('\n').slice(0, MAX_SALVAGED_CONTENT);
  return { authored: { ...authored, content }, folded: stray.map(([key]) => key) };
}

function renderEntry(key: string, value: unknown, depth: number): string {
  const indent = '  '.repeat(depth);
  const label = humanizeKey(key);
  if (isScalar(value)) return `${indent}- **${label}:** ${String(value)}`;
  if (Array.isArray(value) && value.every(isScalar)) return `${indent}- **${label}:** ${value.map(String).join(', ')}`;
  if (depth >= MAX_RENDER_DEPTH) return `${indent}- **${label}:** ${JSON.stringify(value)}`;
  const children = Array.isArray(value)
    ? value.map((item, index) => renderEntry(String(index + 1), item, depth + 1))
    : Object.entries(value as Record<string, unknown>)
      .filter(([childKey, child]) => !isSensitiveMutationKey(childKey) && isAuthored(child))
      .map(([childKey, child]) => renderEntry(childKey, child, depth + 1));
  return [`${indent}- **${label}**`, ...children].join('\n');
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** `trainingConfig` → `Training config`, `learning_rate` → `Learning rate`. */
function humanizeKey(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
