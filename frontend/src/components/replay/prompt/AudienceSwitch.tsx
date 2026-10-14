/**
 * Who the improvement prompt is for (PRD 33 §5.2 "Prompt"): the ONE composer, a
 * coding agent, or any site builder's AI. A tablist over `IMPROVEMENT_AUDIENCES`
 * (data from the contract) — the compiler, not this switch, decides what changes.
 */

import { useTranslations } from 'next-intl';
import { IMPROVEMENT_AUDIENCES, type ImprovementAudience } from '@builderforce/interaction-contract';

export interface AudienceSwitchProps {
  value: ImprovementAudience;
  onChange: (audience: ImprovementAudience) => void;
}

export function AudienceSwitch({ value, onChange }: AudienceSwitchProps) {
  const t = useTranslations('replay.prompt');
  return (
    <div role="tablist" aria-label={t('audienceAria')} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
      {IMPROVEMENT_AUDIENCES.map((audience) => (
        <button
          key={audience}
          type="button"
          role="tab"
          data-audience={audience}
          aria-selected={audience === value}
          className={audience === value ? 'btn-secondary' : 'btn-ghost'}
          style={{ minHeight: 44 }}
          onClick={() => onChange(audience)}
        >
          {t(`audience.${audience}`)}
        </button>
      ))}
    </div>
  );
}
