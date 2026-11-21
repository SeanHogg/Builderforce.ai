import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { membersApi, type MemberEngagement } from '@/lib/builderforceApi';
import { LocalCollection } from '@/components/pm/LocalCollection';
import { ENGAGEMENT_SEGMENTS, useEngagementDescriptor } from './performanceCollections';
import { useErrorMessage } from '@/i18n/useErrorMessage';

/**
 * Unified engagement — one score per human member that folds EVERY signal we
 * capture (external dev activity, in-product usage, VS Code presence, delivery),
 * not just board behaviour. Reads /api/members/engagement. Lives under the
 * Performance tab beside the task scorecards, rendered through the ONE
 * Collection (PRD 47). MANAGER+ on the API.
 */

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16,
};

const memberSearch = (m: MemberEngagement) => `${m.displayName} ${m.role}`;

export function EngagementSection({ days }: { days: number }) {
  const errorMessage = useErrorMessage();
  const t = useTranslations('workforce.performance.engagement');
  const descriptor = useEngagementDescriptor();
  const [members, setMembers] = useState<MemberEngagement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const windowDays = Math.max(days, 30);

  useEffect(() => {
    setMembers(null);
    setError(null);
    membersApi.engagement(windowDays).then((r) => setMembers(r.members)).catch((e: unknown) => setError(errorMessage(e)));
  }, [windowDays, errorMessage]);

  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
        {t('title')} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{t('subtitle', { days: windowDays })}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {ENGAGEMENT_SEGMENTS.map((s) => (
          <span key={s.key}><span aria-hidden style={{ color: s.color }}>■</span> {t(`legend.${s.key}`)}</span>
        ))}
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {members == null ? (
        !error && <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('loading')}</div>
      ) : (
        <LocalCollection descriptor={descriptor} rows={members} searchText={memberSearch} />
      )}
    </div>
  );
}
