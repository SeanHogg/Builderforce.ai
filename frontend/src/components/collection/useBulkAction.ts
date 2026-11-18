import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ToastProvider';
import { collectionsApi } from '@/lib/collectionsApi';
import type { BulkEntityKey } from './descriptor';
import type { BulkAction, BulkResult, BulkSkipReason } from './collectionTypes';

/**
 * useBulkAction — the ONE-request bulk mutation every Collection shares
 * (PRD 47 §3.1). It issues a single `collectionsApi.bulk` call regardless of
 * the id count (the F6 429 was a per-id fan-out), then refetches the page,
 * clears the selection, and surfaces a toast with the succeeded/skipped counts
 * and the skip reasons expandable.
 */
export interface RunBulkOptions {
  action: BulkAction;
  ids: string[];
  targetId?: string;
  dryRun?: boolean;
  /** Labels for the toast's expandable skip reasons. */
  labelFor?: (id: string) => string;
}

export interface BulkActionApi {
  run: (opts: RunBulkOptions) => Promise<BulkResult | null>;
  busy: boolean;
  /** The last result's skip reasons, for the expandable toast. */
  lastSkipped: { id: string; reason: BulkSkipReason }[];
}

export function useBulkAction(
  entity: BulkEntityKey,
  opts: { refetch: () => void; clearSelection: () => void },
): BulkActionApi {
  const t = useTranslations('common.collection');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [lastSkipped, setLastSkipped] = useState<{ id: string; reason: BulkSkipReason }[]>([]);

  const run = useCallback(
    async (o: RunBulkOptions): Promise<BulkResult | null> => {
      setBusy(true);
      try {
        const result = await collectionsApi.bulk(entity, {
          action: o.action,
          ids: o.ids,
          targetId: o.targetId,
          dryRun: o.dryRun,
        });
        setLastSkipped(result.skipped);
        // Toast: "{verb} {n}" plus a skipped count, reasons expandable.
        const verbKey = `${o.action}Done`;
        const succeeded = result.succeeded.length;
        const skipped = result.skipped.length;
        if (skipped > 0) {
          const reasons = result.skipped
            .map((s) => `${o.labelFor?.(s.id) ?? s.id}: ${t(`skipReason.${s.reason}`)}`)
            .join(' · ');
          toast.success(t('bulkResultSkipped', { verb: t(verbKey), count: succeeded, skipped }), {
            title: reasons,
          });
        } else {
          toast.success(t('bulkResult', { verb: t(verbKey), count: succeeded }));
        }
        if (!o.dryRun) {
          opts.refetch();
          opts.clearSelection();
        }
        return result;
      } catch {
        toast.error(t('bulkFailed'));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [entity, opts, t, toast],
  );

  return { run, busy, lastSkipped };
}
