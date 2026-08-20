'use client';

/**
 * The client's shortlist — people this workspace saved, before anyone was hired.
 *
 * The supply-side mirror of the seeker's "Saved" tab. Lists are VALUES on the join
 * (`list_name`), not rows in a lists table, so switching between "react leads" and
 * "backup DBAs" is a filter and creating one is typing a name — see `savedTalent.ts` for
 * why an empty list is deliberately not representable.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import { listSavedTalent, unsaveTalent, type SavedTalentEntry } from '@/lib/freelancerApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)', padding: 14, minWidth: 0,
};

export function ShortlistPanel({ onInvite }: { onInvite?: (entry: SavedTalentEntry) => void }) {
  const t = useTranslations('talent');
  const { formatCents } = useMoneyFormat();
  const [items, setItems] = useState<SavedTalentEntry[]>([]);
  const [lists, setLists] = useState<Array<{ name: string; count: number }>>([]);
  const [list, setList] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listSavedTalent(list || undefined);
      setItems(result.items);
      setLists(result.lists);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shortlist.loadError'));
    } finally {
      setLoading(false);
    }
  }, [list, t]);

  useEffect(() => { void load(); }, [load]);

  const remove = async (entry: SavedTalentEntry) => {
    setBusy(entry.id);
    setError(null);
    try {
      await unsaveTalent(entry.freelancerUserId, entry.listName);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shortlist.failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div>
        <h3 style={{ margin: '0 0 4px', fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('shortlist.heading')}
        </h3>
        <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', maxWidth: '65ch' }}>
          {t('shortlist.explainer')}
        </p>
      </div>

      {lists.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setList('')}
            style={{
              padding: '5px 12px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
              fontSize: 'var(--font-size-small)', fontWeight: 600,
              background: list === '' ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
              border: `1px solid ${list === '' ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
              color: 'var(--text-primary)',
            }}
          >
            {t('shortlist.allLists')}
          </button>
          {lists.map((entry) => (
            <button
              key={entry.name}
              type="button"
              onClick={() => setList(entry.name)}
              style={{
                padding: '5px 12px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
                fontSize: 'var(--font-size-small)', fontWeight: 600,
                background: list === entry.name ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
                border: `1px solid ${list === entry.name ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                color: 'var(--text-primary)',
              }}
            >
              {entry.name} ({entry.count})
            </button>
          ))}
        </div>
      )}

      {error && <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)' }}>{error}</div>}
      {loading && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('shortlist.loading')}</p>}

      {!loading && items.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
          {t('shortlist.empty')}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))' }}>
          {items.map((entry) => (
            <div key={entry.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <Link
                  href={`/talent/${entry.freelancerUserId}`}
                  style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)', textDecoration: 'none', overflowWrap: 'anywhere', minWidth: 0 }}
                >
                  {entry.displayName ?? t('match.unnamed')}
                </Link>
                <button
                  type="button"
                  disabled={busy === entry.id}
                  aria-label={t('shortlist.remove')}
                  onClick={() => void remove(entry)}
                  style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, flexShrink: 0 }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              {entry.headline && (
                <p style={{ margin: '4px 0 6px', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{entry.headline}</p>
              )}
              <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
                {entry.hourlyRateCents != null && `${formatCents(entry.hourlyRateCents, { currency: entry.currency, maximumFractionDigits: 0 })}${t('perHour')}`}
                {entry.rating != null && entry.ratingCount > 0 && ` · ${entry.rating.toFixed(1)} (${entry.ratingCount})`}
              </div>
              {entry.note && (
                <p style={{ margin: '8px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', fontStyle: 'italic' }}>{entry.note}</p>
              )}
              {entry.skills.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {entry.skills.slice(0, 5).map((skill) => (
                    <span key={skill} style={{ fontSize: 'var(--font-size-eyebrow)', padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                      {skill}
                    </span>
                  ))}
                </div>
              )}
              {onInvite && (
                <button
                  type="button"
                  onClick={() => onInvite(entry)}
                  style={{
                    marginTop: 12, padding: '6px 14px', borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--coral-bright)', background: 'var(--surface-coral-soft)',
                    color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)', fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {t('invite.action')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
