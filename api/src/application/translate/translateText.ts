/**
 * TranslateText — the cloud fallback for on-device translation (PRD 42 Part E, E4).
 *
 * The use case owns batching and the per-text cache; the model call sits behind the
 * injected {@link TranslationModel} port (infrastructure adapter) and the cache behind
 * {@link TranslationCache}, so neither the route nor this file knows Workers AI or KV.
 *
 * Per-text caching: a batch with partial hits calls the model only for the misses. A
 * failed model call throws and is never cached (the read-through core does not store a
 * rejected loader).
 */
import { sha256Hex } from '../../domain/shared/hash';
import { mapWithConcurrency } from '../runtime/boundedPool';

export const MAX_TRANSLATE_TEXTS = 20;
export const MAX_TRANSLATE_TEXT_CHARS = 5000;
/** Model calls in flight at once within ONE request — never the whole batch at once. */
export const TRANSLATE_MODEL_CONCURRENCY = 4;
/** A text's translation never changes, so the entry only ages out for keyspace hygiene. */
export const TRANSLATE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface TranslateRequest {
  texts: string[];
  to: string;
  /** Always the DETECTED source language: the model cannot detect one, so clients detect first. */
  from: string;
}

/** Thrown by a {@link TranslationModel} when the model cannot be reached or is unconfigured. */
export class TranslationUnavailableError extends Error {
  constructor(message = 'Translation model unavailable') {
    super(message);
    this.name = 'TranslationUnavailableError';
  }
}

/** Infrastructure port: translate ONE text with the free translation model. */
export interface TranslationModel {
  translate(text: string, o: { from: string; to: string }): Promise<string>;
}

/** Read-through cache port: return the cached value for `key`, else compute and store it. */
export type TranslationCache = (
  key: string,
  loader: () => Promise<string>,
  ttlSeconds: number,
) => Promise<string>;

export type TranslateText = (req: TranslateRequest) => Promise<string[]>;

/** `translate:v1:` + sha256(text) + `:` + from + `:` + to. No 'auto' key: a result is only
 *  reusable for the source language it was actually translated from. */
export async function translateCacheKey(text: string, from: string, to: string): Promise<string> {
  return `translate:v1:${await sha256Hex(text)}:${from}:${to}`;
}

/** Same language (compared case-insensitively): there is nothing to translate. */
export function isSameLanguage(from: string, to: string): boolean {
  return from.toLowerCase() === to.toLowerCase();
}

export function createTranslateText(deps: { model: TranslationModel; cache: TranslationCache }): TranslateText {
  return async ({ texts, to, from }) => {
    if (isSameLanguage(from, to)) return [...texts];
    return mapWithConcurrency(texts, TRANSLATE_MODEL_CONCURRENCY, async (text) =>
      deps.cache(
        await translateCacheKey(text, from, to),
        () => deps.model.translate(text, { from, to }),
        TRANSLATE_CACHE_TTL_SECONDS,
      ),
    );
  };
}
