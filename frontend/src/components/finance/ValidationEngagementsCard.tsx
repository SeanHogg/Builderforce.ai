/**
 * Validation engagements — the experiments, validation dashboards and feedback
 * collectors this segment is running, as one small card.
 *
 * `biApi.getValidationEngagements` had a typed client and no reader: the
 * evidence that a bet is paying off sat one route away from the CFO's page
 * that decides how long the money lasts. This is that reader. Self-contained
 * (one hook, one read through the shared BI source), so it can stand on any
 * finance or insights surface without its host passing it data.
 */

import { useTranslations } from 'next-intl';
import { Badge, SectionEmpty, SectionError, SectionLoading, Surface } from '@/components/ui';
import { statusTone, type StatusToneMap } from '@/lib/statusTone';
import { countEngagementKinds, useValidationEngagements, type EngagementKind } from '@/lib/bi/useValidationEngagements';

/** How many rows the card lists before it says "and N more". */
const VISIBLE = 6;

/** Statuses the three sources write, with a catalog label each. Anything else
 *  the API adds later is shown verbatim, neutral — never as an empty badge. */
const KNOWN_STATUSES = ['in_progress', 'validated', 'invalidated', 'inconclusive', 'running', 'active', 'completed', 'disabled'] as const;

const STATUS_TONES: StatusToneMap = {
  in_progress: 'info',
  running: 'info',
  validated: 'success',
  active: 'success',
  completed: 'success',
  invalidated: 'danger',
  inconclusive: 'warning',
  disabled: 'neutral',
};

const KINDS: EngagementKind[] = ['validation', 'dashboard', 'feedback_collector'];

const headerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 600 };
const mutedStyle: React.CSSProperties = { margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' };
const countsStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 };
const listStyle: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 'var(--font-size-small)' };
const nameStyle: React.CSSProperties = { color: 'var(--text-primary)', minWidth: 0, overflowWrap: 'anywhere', flex: '1 1 160px' };
const metaStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' };

function kindOf(kind: string | undefined): EngagementKind {
  return kind === 'dashboard' || kind === 'feedback_collector' ? kind : 'validation';
}

export function ValidationEngagementsCard() {
  const t = useTranslations('financeHub.validation');
  const { data, error } = useValidationEngagements();

  const statusLabel = (status: string) =>
    (KNOWN_STATUSES as readonly string[]).includes(status) ? t(`status.${status}`) : status;

  let body: React.ReactNode;
  if (error) body = <SectionError error={new Error(error)} />;
  else if (!data) body = <SectionLoading label={t('loading')} />;
  else if (!data.available || data.engagements.length === 0) body = <SectionEmpty message={t('empty')} />;
  else {
    const counts = countEngagementKinds(data);
    const rest = data.engagements.length - VISIBLE;
    body = (
      <>
        <div style={countsStyle}>
          {KINDS.filter((kind) => counts[kind] > 0).map((kind) => (
            <Badge key={kind} tone="accent">{t(`count.${kind}`, { count: counts[kind] })}</Badge>
          ))}
        </div>
        <ul style={listStyle}>
          {data.engagements.slice(0, VISIBLE).map((engagement) => (
            <li key={`${engagement.kind ?? 'validation'}:${engagement.id}`} style={rowStyle}>
              <span style={nameStyle}>{engagement.name || t('untitled')}</span>
              <span style={metaStyle}>
                <span style={mutedStyle}>{t(`kind.${kindOf(engagement.kind)}`)}</span>
                {engagement.responses != null && <span style={mutedStyle}>{t('responses', { count: engagement.responses })}</span>}
                {engagement.status && (
                  <Badge tone={statusTone(STATUS_TONES, engagement.status)} dot>{statusLabel(engagement.status)}</Badge>
                )}
              </span>
            </li>
          ))}
        </ul>
        {rest > 0 && <p style={{ ...mutedStyle, marginTop: 8 }}>{t('more', { count: rest })}</p>}
      </>
    );
  }

  return (
    <Surface aria-labelledby="validation-engagements-title">
      <div style={headerStyle}>
        <h2 id="validation-engagements-title" style={titleStyle}>{t('title')}</h2>
        <p style={mutedStyle}>{t('blurb')}</p>
      </div>
      {body}
    </Surface>
  );
}
