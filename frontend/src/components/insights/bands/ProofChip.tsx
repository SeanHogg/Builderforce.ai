/**
 * The header's proof chip (PRD 33 §4.1): present only while the current site's
 * project has a live proof (a built realization that carries a visitor measure) —
 * an external site, which has no project, and a project that is not a proof both
 * render nothing. A press opens the `proof` kind on that realization.
 */

import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { useProjectProof } from '@/components/creation-canvas/useProjectProof';
import { useHostedSiteProject } from '@/components/replay/useHostedSiteProject';
import { useInsightsScope } from '../insightsScope';
import { usePanel } from '../usePanel';

export function ProofChip() {
  const t = useTranslations('insights.overview');
  const { siteId } = useInsightsScope();
  const { push } = usePanel();
  const projectId = useHostedSiteProject(siteId);
  const [proof] = useProjectProof(projectId);
  if (!proof) return null;
  return (
    <button
      type="button"
      className="btn-secondary"
      data-testid="proof-chip"
      aria-label={t('proofChipAria', { title: proof.title })}
      style={{ minHeight: 44 }}
      onClick={() => push({ kind: 'proof', id: proof.id })}
    >
      <Icon name="target" size={14} /> {t('proofChip')}
    </button>
  );
}
