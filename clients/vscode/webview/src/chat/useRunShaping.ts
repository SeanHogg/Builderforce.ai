/**
 * The composer's run-shaping switches that belong to the PERSON, not the chat: Effort
 * and Thinking (persisted globally across webview reloads, like a keyboard layout) and
 * the per-session Browse-the-web toggle.
 *
 * Effort and Thinking are REAL request params — effort sets `max_tokens` and, with
 * Thinking on, the `reasoning.level` intensity. 'balanced' + thinking-off is the neutral
 * default and yields a request identical to having no controls at all.
 */

import { useCallback, useState } from 'react';
import { isEffort, type Effort } from '@seanhogg/builderforce-brain-embedded';
import { readStored, writeStored } from '../storage';
import { EFFORT_KEY, THINKING_KEY } from './chatPreferences';

export function useRunShaping() {
  const [effort, setEffortState] = useState<Effort>(() => {
    const stored = readStored(EFFORT_KEY);
    return isEffort(stored) ? stored : 'balanced';
  });
  const setEffort = useCallback((next: Effort) => {
    setEffortState(next);
    writeStored(EFFORT_KEY, next);
  }, []);
  const [thinking, setThinkingState] = useState(() => readStored(THINKING_KEY) === '1');
  const setThinking = useCallback((next: boolean) => {
    setThinkingState(next);
    writeStored(THINKING_KEY, next ? '1' : '0');
  }, []);
  const [webBrowsing, setWebBrowsing] = useState(false);
  return { effort, setEffort, thinking, setThinking, webBrowsing, setWebBrowsing };
}
