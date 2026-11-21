import { useCallback, useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import type { ActivityActorType, ActivityLogEvent } from '@/lib/builderforceApi';
import { useFormat } from '@/i18n/useFormat';
import { initialsOf } from '@/lib/initials';

/**
 * The activity / audit trail as a Collection (PRD 47). READ-ONLY
 * (`entity: null`): the log is append-only. Card mode is the timeline entry
 * (avatar, actor, verb, summary, model provenance); List mode is the same event
 * as sortable columns.
 */

// Actor-type visual system: token accents on translucent fills that read in BOTH themes.
export const ACTOR_STYLE: Record<ActivityActorType, { color: string; glyph: string }> = {
  human:      { color: 'var(--emerald-bright)', glyph: '👤' },
  hire:       { color: 'var(--amber-bright)', glyph: '🤝' },
  cloud_agent:{ color: 'var(--violet-bright)', glyph: '🤖' },
  host_agent: { color: 'var(--purple-bright)', glyph: '🖥️' },
  system:     { color: 'var(--text-muted)', glyph: '⚙️' },
};
export const ACTOR_ORDER: ActivityActorType[] = ['human', 'hire', 'cloud_agent', 'host_agent', 'system'];

// Verb → an accent so the timeline scans by change-type at a glance.
const VERB_COLOR: Record<string, string> = {
  'task.created': 'var(--emerald-bright)',
  'task.updated': 'var(--indigo-bright)',
  'task.status_changed': 'var(--coral-bright)',
  'task.assigned': 'var(--purple-bright)',
  'task.moved': 'var(--indigo-bright)',
  'task.deleted': 'var(--error)',
  'code.changed': 'var(--success)',
  'deploy.recorded': 'var(--teal-bright)',
  'deploy.failed': 'var(--error)',
  'role.assigned': 'var(--purple-bright)',
  'engagement.created': 'var(--amber-bright)',
  'member.hired': 'var(--amber-bright)',
  'doc.published': 'var(--sky-bright)',
};

/**
 * The model-provenance slice an LLM-backed event carries on its free-form
 * `metadata` — written by the api's `buildModelActivityMetadata`, so these key
 * names are the wire contract. Most rows (a human moving a ticket) have no model.
 */
interface ModelProvenance {
  model?: string;
  vendor?: string;
  account?: string;
  byoFunded?: boolean;
}

/** Narrow the `unknown` metadata to the model slice — no `any`, no trust in shape. */
function readModelProvenance(metadata: unknown): ModelProvenance | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const m = metadata as Record<string, unknown>;
  const model = typeof m.model === 'string' && m.model.trim() ? m.model.trim() : undefined;
  if (!model) return null; // no model ⇒ nothing to chip
  return {
    model,
    vendor: typeof m.vendor === 'string' && m.vendor.trim() ? m.vendor.trim() : undefined,
    account: typeof m.account === 'string' ? m.account : undefined,
    byoFunded: typeof m.byoFunded === 'boolean' ? m.byoFunded : undefined,
  };
}

/** Strip the vendor/namespace prefix so the chip shows `claude-opus-4-8`, not
 *  `direct/anthropic/claude-opus-4-8`, while the title keeps the full ref. */
function shortModel(model: string): string {
  const tail = model.split('/').pop() ?? model;
  return tail.length > 34 ? `${tail.slice(0, 33)}…` : tail;
}

function useRelativeTime() {
  const locale = useLocale();
  const rtf = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }), [locale]);
  return useCallback((iso: string): string => {
    const then = new Date(iso).getTime();
    const diffSec = Math.round((then - Date.now()) / 1000);
    const abs = Math.abs(diffSec);
    if (abs < 60) return rtf.format(Math.round(diffSec), 'second');
    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
    if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), 'day');
    if (abs < 31536000) return rtf.format(Math.round(diffSec / 2592000), 'month');
    return rtf.format(Math.round(diffSec / 31536000), 'year');
  }, [rtf]);
}

/** Localized actor-type label (falls back to the raw type). */
export function useActorLabel() {
  const t = useTranslations('audit');
  return useCallback(
    (type: ActivityActorType): string => (t.has(`actor.${type}` as never) ? t(`actor.${type}` as never) : type),
    [t],
  );
}

const chip: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 500, padding: '2px 7px', borderRadius: 'var(--radius-full)',
  color: 'var(--muted)', border: '1px solid var(--border-subtle)', whiteSpace: 'nowrap',
};

export const auditSearch = (e: ActivityLogEvent) => `${e.actorName ?? ''} ${e.verb} ${e.summary ?? ''} ${e.targetLabel ?? ''}`;

export function useAuditDescriptor(): CollectionDescriptor<ActivityLogEvent> {
  const t = useTranslations('audit');
  const fmt = useFormat();
  const rel = useRelativeTime();
  const actorLabel = useActorLabel();
  return useMemo<CollectionDescriptor<ActivityLogEvent>>(() => {
    const verbLabel = (verb: string): string => (t.has(`verb.${verb}` as never) ? t(`verb.${verb}` as never) : verb);
    const style = (e: ActivityLogEvent) => ACTOR_STYLE[e.actorType] ?? ACTOR_STYLE.system;
    const accountLabel = (mp: ModelProvenance): string | null =>
      mp.byoFunded === true || mp.account === 'own'
        ? t('model.accountOwn')
        : mp.account === 'shared_byo_unused'
          ? t('model.accountSharedUnused')
          : mp.account === 'shared' || mp.byoFunded === false
            ? t('model.accountShared')
            : null;

    const avatar = (e: ActivityLogEvent) => {
      const as = style(e);
      return (
        <span aria-hidden title={actorLabel(e.actorType)} style={{
          flex: '0 0 auto', width: 30, height: 30, borderRadius: 'var(--radius-full)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, color: as.color,
          background: `color-mix(in srgb, ${as.color} 16%, transparent)`,
          border: `1px solid color-mix(in srgb, ${as.color} 40%, transparent)`,
        }}>
          {initialsOf(e.actorName, '·')}
        </span>
      );
    };
    const actorBadge = (e: ActivityLogEvent) => {
      const as = style(e);
      return (
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 'var(--radius-full)', whiteSpace: 'nowrap',
          color: as.color, background: `color-mix(in srgb, ${as.color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${as.color} 34%, transparent)`,
        }}>
          <Icon source={as.glyph} size={14} /> {actorLabel(e.actorType)}
        </span>
      );
    };
    const verb = (e: ActivityLogEvent) => (
      <span style={{ fontSize: 11, fontWeight: 600, color: VERB_COLOR[e.verb] ?? 'var(--text-muted)' }}>{verbLabel(e.verb)}</span>
    );
    const when = (e: ActivityLogEvent) => (
      <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }} title={fmt.dateTime(e.occurredAt)}>{rel(e.occurredAt)}</span>
    );
    // WHICH MODEL ran this turn. Only LLM-backed events carry it, so the chips are
    // absent (not empty) otherwise. Wraps and truncates so a long ref never forces
    // a horizontal scroll on mobile.
    const model = (e: ActivityLogEvent) => {
      const mp = readModelProvenance(e.metadata);
      if (!mp) return null;
      const account = accountLabel(mp);
      return (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', maxWidth: '100%' }}>
          <span title={t('model.tooltip', { model: mp.model ?? '' })} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%',
            fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--radius-full)',
            color: 'var(--text-secondary)', background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)',
            minWidth: 0, overflow: 'hidden',
          }}>
            <span aria-hidden><Icon source="◇" size="1em" /></span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortModel(mp.model ?? '')}</span>
          </span>
          {mp.vendor && <span style={chip}>{mp.vendor}</span>}
          {account && <span style={{ ...chip, border: '1px dashed var(--border-subtle)' }}>{account}</span>}
        </div>
      );
    };
    const summary = (e: ActivityLogEvent) => e.summary ?? e.targetLabel ?? '—';
    const actorName = (e: ActivityLogEvent) => e.actorName ?? t('actor.unknown');

    return {
      entity: null,
      surfaceKey: 'workforce.performance.audit',
      rowId: (e) => String(e.id),
      label: (e) => `${actorName(e)} ${verbLabel(e.verb)}`,
      defaultView: 'card',
      defaultSort: { key: 'when', dir: 'desc' },
      emptyKey: 'emptyAudit',
      columns: [
        { key: 'when', header: t('col.when'), compare: (a, b) => a.id - b.id, cell: when },
        { key: 'actor', header: t('col.actor'), compare: (a, b) => actorName(a).localeCompare(actorName(b)), cell: (e) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{avatar(e)}<span style={{ fontWeight: 600 }}>{actorName(e)}</span></span>
        ) },
        { key: 'type', header: t('col.type'), compare: (a, b) => a.actorType.localeCompare(b.actorType), cell: actorBadge },
        { key: 'action', header: t('col.action'), compare: (a, b) => verbLabel(a.verb).localeCompare(verbLabel(b.verb)), cell: verb },
        { key: 'summary', header: t('col.summary'), cell: (e) => <span style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{summary(e)}</span> },
        { key: 'model', header: t('col.model'), cell: model },
      ],
      card: (e) => (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12, minWidth: 0 }}>
          {avatar(e)}
          <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-strong)' }}>{actorName(e)}</span>
              {actorBadge(e)}
              <span style={{ marginLeft: 'auto' }}>{when(e)}</span>
            </div>
            {verb(e)}
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{summary(e)}</div>
            {model(e)}
          </div>
        </div>
      ),
    };
  }, [t, fmt, rel, actorLabel]);
}
