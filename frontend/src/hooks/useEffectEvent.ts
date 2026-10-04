import { useCallback } from 'react';
import { useLatestRef } from '@/components/creation-canvas/hooks/useLatestRef';

/**
 * A callback an effect can call that always runs the LATEST committed closure
 * without the effect depending on it — React's `useEffectEvent`, which this app
 * cannot import: the App Router renders with the React `next` vendors (a 19.2
 * canary under Next 15.5), and that build does not export it. Importing it from
 * 'react' type-checks against package.json's 19.2.8 and then crashes every page
 * that mounts the caller ("useEffectEvent is not a function").
 *
 * The returned function is stable, which is a superset of React's contract: it
 * may still be left out of an effect's dependency list, exactly as the original.
 * `eslint.config.js` forbids the 'react' import so the crash cannot come back.
 */
export function useEffectEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useLatestRef(fn);
  return useCallback((...args: A) => latest.current(...args), [latest]);
}
