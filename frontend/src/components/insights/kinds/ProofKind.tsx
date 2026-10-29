/**
 * The `proof` panel kind (PRD 33 §4.1, §5.3): the live proof's measured state —
 * the ONE `ProofScoreboard` (kill condition, sample and success progress, status,
 * the three moves the evidence supports), opened from the header's proof chip.
 * The level id is the realization id.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { realizationApi, type Realization } from '@/lib/realizationApi';
import { useAdminData } from '@/components/admin/adminShared';
import { ProofScoreboard } from '@/components/creation-canvas/ProofScoreboard';
import type { InsightPanelKindProps } from '../panelKinds';
import { PanelPending } from './PanelPending';

export function ProofKind({ id }: InsightPanelKindProps) {
  const t = useTranslations('insights.proof');
  const { data, loading, error } = useAdminData<Realization>(() => realizationApi.get(id), [id]);
  // An early call grades the proof in place: the scoreboard hands back its new copy.
  const [graded, setGraded] = useState<Realization | null>(null);
  const proof = graded?.id === id ? graded : data;
  if (!proof) return <PanelPending loading={loading} error={error} />;
  if (!proof.measure) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('noMeasure')}</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      <h3 style={{ margin: 0, fontSize: 'var(--font-size-card-title)', overflowWrap: 'anywhere' }}>{proof.title}</h3>
      <ProofScoreboard realization={proof} onRealizationChange={setGraded} />
    </div>
  );
}
