import { useCallback, useEffect, useState } from 'react';
import type { CloudOrder } from '@builderforce/model-catalog';
import { accountBrainPreferencesApi } from '@/lib/accountBrainPreferencesApi';

/**
 * The person's cloud funding preference (`cloudOrder`) — read from and saved to their
 * account, so it follows them across devices and hosts. A save is a partial update: the
 * other Brain preferences are left as stored.
 *
 * Two distinct failures: `loadFailed` (the stored choice could not be read, so no option
 * can honestly be shown as selected) and `saveFailed` (a new choice did not persist and
 * the previous one is restored).
 */
export function useCloudFundingPreference() {
  const [cloudOrder, setCloudOrder] = useState<CloudOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let live = true;
    accountBrainPreferencesApi.get()
      .then(({ preferences }) => { if (live) setCloudOrder(preferences.cloudOrder ?? 'inferred'); })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, []);

  const choose = useCallback((next: CloudOrder) => {
    const previous = cloudOrder;
    setCloudOrder(next);
    setSaving(true);
    setSaveFailed(false);
    accountBrainPreferencesApi.update({ cloudOrder: next })
      .then(({ preferences }) => setCloudOrder(preferences.cloudOrder))
      .catch(() => { setCloudOrder(previous); setSaveFailed(true); })
      .finally(() => setSaving(false));
  }, [cloudOrder]);

  return { cloudOrder, choose, saving, loadFailed, saveFailed };
}
