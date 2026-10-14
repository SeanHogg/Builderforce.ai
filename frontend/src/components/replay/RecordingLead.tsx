/**
 * The identified visitor behind a recording: the id the site passed to
 * `BFReplay.identify` and its traits. Only reachable when the recording has an
 * `identifiedId` — the tab row declares `requires: 'identified'`.
 */

import { useTranslations } from 'next-intl';
import type { ReplayRecordingDto } from '@builderforce/interaction-contract';

export function RecordingLead({ recording }: { recording: ReplayRecordingDto }) {
  const t = useTranslations('insights.lead');
  const traits = Object.entries(recording.traits ?? {});
  const tags = Object.entries(recording.tags ?? {});
  const row = { display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', fontSize: 'var(--font-size-small)' } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      <div style={row}>
        <span style={{ color: 'var(--text-secondary)', minWidth: 120 }}>{t('identifiedId')}</span>
        <span style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere', fontFamily: 'var(--font-mono)' }}>{recording.identifiedId ?? '—'}</span>
      </div>
      <h3 style={{ margin: 0, fontSize: 'var(--font-size-small)' }}>{t('traits')}</h3>
      {traits.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('noTraits')}</p>
      ) : (
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(100px, max-content) 1fr', gap: 'var(--space-1) var(--space-3)' }}>
          {traits.map(([key, value]) => (
            <div key={key} style={{ display: 'contents' }}>
              <dt style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{key}</dt>
              <dd style={{ margin: 0, overflowWrap: 'anywhere', fontSize: 'var(--font-size-small)' }}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {tags.length > 0 && (
        <>
          <h3 style={{ margin: 0, fontSize: 'var(--font-size-small)' }}>{t('tags')}</h3>
          <p style={{ margin: 0, fontSize: 'var(--font-size-small)', overflowWrap: 'anywhere' }}>
            {tags.map(([key, value]) => `${key}=${value}`).join(' · ')}
          </p>
        </>
      )}
    </div>
  );
}
