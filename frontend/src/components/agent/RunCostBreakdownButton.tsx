import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';
import { Button } from '@/components/ui/Button';

// The breakdown only renders inside the drawer once opened; a dynamic edge keeps the
// cost client out of every page that shows a run.
const RunCostBreakdownView = dynamic(() => import('./RunCostBreakdownView').then((module) => module.RunCostBreakdownView), { ssr: false });

/**
 * "Cost breakdown" affordance beside a run's spend: opens the per-turn breakdown in
 * the slide-out drawer (a detail view — never a modal). Disabled, never hidden, for a
 * reader below the cost lens's role; the drawer's read only fires once it is open.
 */
export function RunCostBreakdownButton({ executionId }: { executionId: number }) {
  const t = useTranslations('insights.cost');
  const [open, setOpen] = useState(false);
  return (
    <>
      <RoleGate capability="insights.costEfficiency">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {t('run.open')}
        </Button>
      </RoleGate>
      {open && (
        <SlideOutPanel
          open
          onClose={() => setOpen(false)}
          title={t('run.title', { id: executionId })}
          width="wide"
          widthStorageKey="run-cost-breakdown"
        >
          <RunCostBreakdownView executionId={executionId} />
        </SlideOutPanel>
      )}
    </>
  );
}
