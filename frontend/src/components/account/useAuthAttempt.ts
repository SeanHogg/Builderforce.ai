import { useCallback, useState } from 'react';
import { faultMessage } from '@/lib/apiClient';

/**
 * The submit/error handling every auth action shared: clear the previous error,
 * mark the action busy, run it, show a readable message when it throws, and clear
 * busy either way. One error line serves all of a screen's actions (password,
 * passkey, magic link), so it lives here while `busy` is tracked per action key.
 */
export function useAuthAttempt() {
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const attempt = useCallback(async (
    key: string,
    task: () => Promise<void>,
    fallbackMessage: string,
    /** Return true for a failure that is a choice, not an error (a dismissed system prompt). */
    isSilent?: (err: unknown) => boolean,
  ) => {
    setError(null);
    setBusyKey(key);
    try {
      await task();
    } catch (err) {
      if (!isSilent?.(err)) setError(faultMessage(err, fallbackMessage));
    } finally {
      setBusyKey(null);
    }
  }, []);

  return { error, setError, attempt, isBusy: (key: string) => busyKey === key };
}
