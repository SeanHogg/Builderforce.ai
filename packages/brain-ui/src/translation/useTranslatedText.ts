/**
 * The state machine behind `<TranslatableText>` (PRD 42 · E2/E3). Never touches the text it
 * is given — it only reports what to SHOW.
 *
 *   plain         render the original, nothing else (same language, unsure, no wiring)
 *   pending       a translation is under way (the original still shows)
 *   translated    show `text`, with the toggle back to the original
 *   needs-device  foreign text, but nothing here can translate it and no cloud is allowed
 *   failed        the cloud refused / was unreachable — the original, quietly
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslationContext } from './context';
import { detectForeignLanguage, translateWithEngines } from './engine';
import { translationCacheKey, type TranslationEntry } from './translationCache';
import { recentOutcome, rememberOutcome, type Outcome } from './recentOutcomes';

export { MIN_DETECT_CONFIDENCE } from './engine';
export { FAILED_OUTCOME_TTL_MS, clearRecentOutcomes } from './recentOutcomes';

export type TranslatedTextState =
  | { status: 'plain' }
  | { status: 'pending' }
  | { status: 'translated'; text: string; from: string }
  | { status: 'needs-device'; from: string }
  | { status: 'failed' };

export function useTranslatedText(text: string, contentId: string, enabled: boolean): TranslatedTextState {
  const ctx = useTranslationContext();
  // Only the wiring that changes what is translated re-runs the effect; the copy and the
  // picker opener are not inputs to it.
  const wiring = useRef(ctx);
  wiring.current = ctx;
  const present = !!ctx;
  const tasks = ctx?.tasks ?? null;
  const cloud = ctx?.cloud ?? null;
  const locale = ctx?.locale ?? '';
  const cache = ctx?.cache ?? null;
  const [state, setState] = useState<TranslatedTextState>({ status: 'plain' });

  useEffect(() => {
    const current = wiring.current;
    if (!current || !enabled || text.trim().length < 2) { setState({ status: 'plain' }); return undefined; }
    const ac = new AbortController();
    const live = () => !ac.signal.aborted;
    const key = translationCacheKey(contentId, locale, text);
    const remember = (entry: TranslationEntry) => { void cache?.set(key, entry).catch(() => undefined); };
    // A cloud arriving (the mode changed) must not be answered by what failed without one.
    const outcomeKey = cloud ? `${key}|cloud` : key;
    const recent = recentOutcome(outcomeKey);
    if (recent) { setState(recent); return undefined; }
    void (async () => {
      const hit = await cache?.get(key).catch(() => undefined);
      if (!live()) return;
      if (hit) {
        setState(hit.kind === 'plain' ? { status: 'plain' } : { status: 'translated', text: hit.text, from: hit.from });
        return;
      }
      const verdict = await detectForeignLanguage(current, text);
      if (!live()) return;
      if (!verdict.foreign) {
        // Only a REAL same-language / unsure verdict is cached; "could not detect" retries next time.
        if (verdict.known) remember({ kind: 'plain' });
        setState({ status: 'plain' });
        return;
      }
      setState({ status: 'pending' });
      const result = await translateWithEngines(current, [text], verdict.lang, ac.signal);
      if (!live()) return;
      if (!result.ok) {
        const outcome: Outcome = result.reason === 'needs-device' ? { status: 'needs-device', from: verdict.lang } : { status: 'failed' };
        rememberOutcome(outcomeKey, outcome);
        setState(outcome);
        return;
      }
      remember({ kind: 'translated', from: verdict.lang, text: result.texts[0]! });
      setState({ status: 'translated', text: result.texts[0]!, from: verdict.lang });
    })();
    return () => ac.abort();
  }, [present, tasks, cloud, locale, cache, enabled, text, contentId]);

  return state;
}
