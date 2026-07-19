'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { activityApi, type ActivityActorType, type ActivityLogEvent } from '@/lib/builderforceApi';

/**
 * Unified activity / audit trail — the tenant-wide, append-only stream of "who did
 * what, to what, when" across the whole workforce: team members, external talent /
 * hires, and AI agents alike. Reads /api/activity/log (MANAGER+, cached). Self-
 * contained: owns its own fetch, actor filter, and keyset pagination. Rendered as
 * the audit half of the Performance tab.
 */

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

// Actor-type visual system. Colours are literal accents layered on translucent
// fills that read in BOTH themes (the fill carries the tint; text uses the accent).
const ACTOR_STYLE: Record<ActivityActorType, { color: string; glyph: string }> = {
  human:      { color: '#39d353', glyph: '👤' },
  hire:       { color: '#f5a524', glyph: '🤝' },
  cloud_agent:{ color: '#b388ff', glyph: '🤖' },
  host_agent: { color: '#8a4be0', glyph: '🖥️' },
  system:     { color: '#8b98a5', glyph: '⚙️' },
};
const ACTOR_ORDER: ActivityActorType[] = ['human', 'hire', 'cloud_agent', 'host_agent', 'system'];

// Verb → an accent so the timeline scans by change-type at a glance.
const VERB_COLOR: Record<string, string> = {
  'task.created': '#39d353',
  'task.updated': '#6366f1',
  'task.status_changed': '#3b82f6',
  'task.assigned': '#8a4be0',
  'task.moved': '#6366f1',
  'task.deleted': '#e5484d',
  'code.changed': '#26a641',
  'deploy.recorded': '#30a46c',
  'deploy.failed': '#e5484d',
  'role.assigned': '#8a4be0',
  'engagement.created': '#f5a524',
  'member.hired': '#f5a524',
  'doc.published': '#0ea5e9',
};

/**
 * The model-provenance slice an LLM-backed event carries on its free-form
 * `metadata` — written by the api's `buildModelActivityMetadata` (the ONE builder
 * shared by the Brain addressed-agent loop and the gateway default-agent turn), so
 * these key names are the wire contract. Everything is optional: most activity
 * rows (a human moving a ticket) have no model at all.
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

function initials(name: string | null): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || name[0]?.toUpperCase() || '·';
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

export function AuditTrailPanel() {
  const t = useTranslations('audit');
  const rel = useRelativeTime();
  const [events, setEvents] = useState<ActivityLogEvent[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actorType, setActorType] = useState<ActivityActorType | 'all'>('all');

  const load = useCallback((reset: boolean) => {
    if (reset) { setLoading(true); setError(null); } else { setLoadingMore(true); }
    activityApi.log({
      actorType: actorType === 'all' ? undefined : actorType,
      beforeId: reset ? undefined : cursor ?? undefined,
      limit: 40,
    })
      .then((page) => {
        setEvents((prev) => (reset ? page.events : [...prev, ...page.events]));
        setCursor(page.nextCursor);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => { setLoading(false); setLoadingMore(false); });
  }, [actorType, cursor]);

  // Reset + reload whenever the actor filter changes.
  useEffect(() => {
    setLoading(true); setError(null);
    activityApi.log({ actorType: actorType === 'all' ? undefined : actorType, limit: 40 })
      .then((page) => { setEvents(page.events); setCursor(page.nextCursor); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [actorType]);

  const verbLabel = (verb: string): string => (t.has(`verb.${verb}` as never) ? t(`verb.${verb}` as never) : verb);
  const actorLabel = (type: ActivityActorType): string => (t.has(`actor.${type}` as never) ? t(`actor.${type}` as never) : type);

  const filters: Array<ActivityActorType | 'all'> = ['all', ...ACTOR_ORDER];

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--text-strong)' }}>{t('title')}</h2>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>{t('subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {filters.map((f) => {
            const active = actorType === f;
            const accent = f === 'all' ? 'var(--accent, #6366f1)' : ACTOR_STYLE[f].color;
            return (
              <button
                key={f}
                onClick={() => setActorType(f)}
                aria-pressed={active}
                style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${active ? accent : 'var(--border-subtle)'}`,
                  background: active ? accent : 'var(--bg-base)',
                  color: active ? '#fff' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {f === 'all' ? t('filter.all') : actorLabel(f)}
              </button>
            );
          })}
        </div>
      </div>

      {loading && <div style={{ color: 'var(--muted)', fontSize: 14, padding: 8 }}>{t('loading')}</div>}
      {error && (
        <div style={{ ...cardStyle, borderColor: 'var(--danger, #e5484d)', color: 'var(--danger, #e5484d)' }}>{error}</div>
      )}

      {!loading && !error && events.length === 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 14, padding: 8 }}>{t('empty')}</div>
      )}

      {!loading && !error && events.length > 0 && (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
          {events.map((e) => {
            const as = ACTOR_STYLE[e.actorType] ?? ACTOR_STYLE.system;
            const vColor = VERB_COLOR[e.verb] ?? 'var(--text-muted)';
            const mp = readModelProvenance(e.metadata);
            const accountLabel = mp
              ? mp.byoFunded === true || mp.account === 'own'
                ? t('model.accountOwn')
                : mp.account === 'shared_byo_unused'
                  ? t('model.accountSharedUnused')
                  : mp.account === 'shared' || mp.byoFunded === false
                    ? t('model.accountShared')
                    : null
              : null;
            return (
              <li
                key={e.id}
                style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  padding: '10px 4px', borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                {/* Actor avatar chip */}
                <span
                  aria-hidden
                  title={actorLabel(e.actorType)}
                  style={{
                    flex: '0 0 auto', width: 30, height: 30, borderRadius: 999,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: as.color,
                    background: `color-mix(in srgb, ${as.color} 16%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${as.color} 40%, transparent)`,
                  }}
                >
                  {initials(e.actorName)}
                </span>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-strong)' }}>
                      {e.actorName ?? t('actor.unknown')}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999,
                      color: as.color, background: `color-mix(in srgb, ${as.color} 14%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${as.color} 34%, transparent)`,
                    }}>
                      {as.glyph} {actorLabel(e.actorType)}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: vColor,
                    }}>
                      {verbLabel(e.verb)}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }} title={new Date(e.occurredAt).toLocaleString()}>
                      {rel(e.occurredAt)}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2, wordBreak: 'break-word' }}>
                    {e.summary ?? e.targetLabel ?? '—'}
                  </div>
                  {/* WHICH MODEL ran this turn. Only LLM-backed events carry it, so the
                      row is absent (not empty) otherwise. Wraps at narrow widths and the
                      model name itself truncates, so a long `direct/vendor/model` ref
                      can never push the timeline into a horizontal scroll on mobile. */}
                  {mp && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4, maxWidth: '100%' }}>
                      <span
                        title={t('model.tooltip', { model: mp.model ?? '' })}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%',
                          fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
                          color: 'var(--text-secondary)',
                          background: 'var(--bg-hover, rgba(127,127,127,0.08))',
                          border: '1px solid var(--border-subtle)',
                          minWidth: 0, overflow: 'hidden',
                        }}
                      >
                        <span aria-hidden>◇</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {shortModel(mp.model ?? '')}
                        </span>
                      </span>
                      {mp.vendor && (
                        <span style={{
                          fontSize: 10.5, fontWeight: 500, padding: '2px 7px', borderRadius: 999,
                          color: 'var(--muted)', border: '1px solid var(--border-subtle)',
                          whiteSpace: 'nowrap',
                        }}>
                          {mp.vendor}
                        </span>
                      )}
                      {accountLabel && (
                        <span style={{
                          fontSize: 10.5, fontWeight: 500, padding: '2px 7px', borderRadius: 999,
                          color: 'var(--muted)', border: '1px dashed var(--border-subtle)',
                          whiteSpace: 'nowrap',
                        }}>
                          {accountLabel}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {!loading && !error && cursor != null && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <button
            onClick={() => load(false)}
            disabled={loadingMore}
            style={{
              fontSize: 13, padding: '8px 16px', borderRadius: 8,
              cursor: loadingMore ? 'default' : 'pointer',
              background: 'var(--bg-hover, rgba(127,127,127,0.08))',
              color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)',
              opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {loadingMore ? t('loading') : t('loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
