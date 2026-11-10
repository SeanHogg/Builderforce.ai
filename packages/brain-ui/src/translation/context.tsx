/**
 * What `<TranslatableText>` needs from its host, handed down ONCE by a provider — no prop
 * drilling through the transcript, the comment list or the canvas.
 *
 *   tasks   the on-device port (null: this host has no translator, e.g. the editor webview)
 *   cloud   the free cloud fallback (null under Local only / signed out — a hard rule, not
 *           a preference: nothing is sent)
 *   locale  the reader's UI language
 *
 * Without a provider every `<TranslatableText>` renders its text as-is.
 */
import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { OnDeviceTasks } from '@seanhogg/builderforce-brain-embedded';
import { defaultTranslationCache, retirableTranslationCache, type TranslationCache } from './translationCache';
import { clearRecentOutcomes } from './recentOutcomes';
import { DEFAULT_TRANSLATION_LABELS, type TranslationLabels } from './labels';

export type CloudTranslate = (texts: string[], to: string, from?: string) => Promise<string[]>;

export interface TranslationContextValue {
  tasks: OnDeviceTasks | null;
  cloud: CloudTranslate | null;
  locale: string;
  cache: TranslationCache | null;
  labels: TranslationLabels;
  /** Opens the model picker's Download; absent means the hint is text only. */
  openModelPicker?: () => void;
}

const TranslationContext = createContext<TranslationContextValue | null>(null);

export interface TranslationProviderProps {
  tasks: OnDeviceTasks | null;
  cloud: CloudTranslate | null;
  locale: string;
  /** Default: the device IndexedDB cache. `null` turns caching off. */
  cache?: TranslationCache | null;
  labels?: Partial<TranslationLabels>;
  openModelPicker?: () => void;
  /**
   * Who is signed in (any stable id; null when nobody is). When it changes — sign-out, or
   * another person signing in — the device cache is cleared, so one person's translated
   * messages never outlive their session on a shared browser.
   */
  identity?: string | null;
  children?: ReactNode;
}

export function TranslationProvider({ tasks, cloud, locale, cache, labels, openModelPicker, identity, children }: TranslationProviderProps) {
  const resolvedCache = cache === undefined ? defaultTranslationCache() : cache;
  // One write-scoped view per identity: a new identity gets a fresh view (so every consumer's
  // effect re-runs and aborts its in-flight work) and the old view is retired, so a stale
  // translation can never be written into the cache cleared below.
  const scopedCache = useMemo(() => (resolvedCache ? retirableTranslationCache(resolvedCache) : null), [resolvedCache, identity]);
  const lastIdentity = useRef(identity);
  const lastScoped = useRef(scopedCache);
  useLayoutEffect(() => {
    if (lastScoped.current !== scopedCache) lastScoped.current?.retire();
    lastScoped.current = scopedCache;
    if (identity === undefined) return;
    if (lastIdentity.current !== identity && lastIdentity.current) {
      clearRecentOutcomes();
      void resolvedCache?.clear().catch(() => undefined);
    }
    lastIdentity.current = identity;
  }, [identity, resolvedCache, scopedCache]);
  const value = useMemo<TranslationContextValue>(() => ({
    tasks,
    cloud,
    locale,
    cache: scopedCache,
    labels: { ...DEFAULT_TRANSLATION_LABELS, ...labels },
    ...(openModelPicker ? { openModelPicker } : {}),
  }), [tasks, cloud, locale, scopedCache, labels, openModelPicker]);
  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

/** The host's translation wiring, or null when no provider is mounted. */
export function useTranslationContext(): TranslationContextValue | null {
  return useContext(TranslationContext);
}

const PickerScopeContext = createContext<(() => void) | null>(null);

/**
 * Narrows where the "Download" hint goes for everything inside it — the Brain panel wraps its
 * thread so the hint opens THAT composer's model menu, not the provider's host-wide default.
 * Read through {@link usePickerOpener}; no prop drilling.
 */
export function TranslationPickerScope({ openModelPicker, children }: { openModelPicker: () => void; children?: ReactNode }) {
  return <PickerScopeContext.Provider value={openModelPicker}>{children}</PickerScopeContext.Provider>;
}

/** The nearest scope's opener, else the provider's, else none (the hint is text only). */
export function usePickerOpener(): (() => void) | undefined {
  const scoped = useContext(PickerScopeContext);
  const hosted = useContext(TranslationContext)?.openModelPicker;
  return scoped ?? hosted;
}
