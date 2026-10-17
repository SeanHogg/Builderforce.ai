import { useCallback, useState } from 'react';

/**
 * A notice about the run that the person can wave away — until something NEW happens.
 *
 * Moved from the web panel's banner hook (`useBrainPanelBanners`) so the editor's two
 * run notices (a connected account the gateway could not use, a provider key that hit
 * its usage cap) and the web's provider-cap banner share one rule instead of three
 * copies of it: dismissal is keyed on the exact set of values, so a different
 * provider (or reason) re-shows the notice rather than staying hidden.
 */
export function useDismissibleNotice(values: readonly string[]): { show: boolean; dismiss: () => void } {
  const [dismissed, setDismissed] = useState('');
  const key = values.join(',');
  const dismiss = useCallback(() => setDismissed(key), [key]);
  return { show: values.length > 0 && dismissed !== key, dismiss };
}
