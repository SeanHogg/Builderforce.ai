'use client';

/**
 * PersonaSelector — the settings surface for the LATERAL lens-persona dimension
 * of the 2D RBAC. The user picks the organizational role(s) they play (CEO / CFO
 * / CTO / CISO / PMO / EM / IC) and which is PRIMARY. The persona reshapes which
 * insight lenses are highlighted / ordered — it is NOT an access grant (every
 * lens stays role-gated), which the copy states plainly.
 *
 * Theme-token styled, responsive, and fully localized (namespace `personaLens`).
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { PERSONAS, LENS_ROUTES, lensesFor, type Persona } from '@/lib/lensPersona';
import { memberPersonasApi } from '@/lib/personaCadenceApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20,
};
const title: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 };

export default function PersonaSelector() {
  const t = useTranslations('personaLens');

  const [selected, setSelected] = useState<Set<Persona>>(new Set(['ic']));
  const [primary, setPrimary] = useState<Persona>('ic');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await memberPersonasApi.get();
      const set = new Set<Persona>(r.personas.length ? r.personas : ['ic']);
      setSelected(set);
      setPrimary(r.primary ?? 'ic');
    } catch {
      /* keep defaults — first-time user with no personas yet */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = (p: Persona) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) {
        if (next.size === 1) return next; // keep at least one
        next.delete(p);
        if (primary === p) setPrimary([...next][0]);
      } else {
        next.add(p);
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true); setNotice('');
    try {
      const list = [...selected];
      const prim = list.includes(primary) ? primary : list[0];
      const r = await memberPersonasApi.set(list, prim);
      setPrimary(r.primary);
      setNotice(t('saved'));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const highlightLenses = lensesFor(primary);

  return (
    <div style={{ ...card }}>
      <div style={title}>{t('title')}</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('subtitle')}</p>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : (
        <>
          {/* Persona chips — toggle membership; radio sets the primary. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
            {PERSONAS.map((p) => {
              const on = selected.has(p);
              const isPrimary = primary === p;
              return (
                <div
                  key={p}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10,
                    border: `1px solid ${on ? 'var(--accent, #6366f1)' : 'var(--border-subtle)'}`,
                    background: on ? 'color-mix(in srgb, var(--accent, #6366f1) 12%, transparent)' : 'var(--bg-elevated)',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                  onClick={() => toggle(p)}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t(`personas.${p}`)}</span>
                  {on && (
                    <label
                      onClick={(e) => e.stopPropagation()}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}
                    >
                      <input
                        type="radio"
                        name="primary-persona"
                        checked={isPrimary}
                        onChange={() => setPrimary(p)}
                      />
                      {t('primary')}
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          {/* Which lenses the primary persona highlights (view-shaping preview). */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {t('highlightsFor', { persona: t(`personas.${primary}`) })}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {highlightLenses.map((lens, i) => (
                <Link
                  key={lens}
                  href={LENS_ROUTES[lens].href}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, textDecoration: 'none',
                    color: i === 0 ? '#fff' : 'var(--text-secondary)',
                    background: i === 0 ? 'var(--accent, #6366f1)' : 'var(--bg-elevated)',
                    border: `1px solid ${i === 0 ? 'transparent' : 'var(--border-subtle)'}`,
                  }}
                >
                  {t(`lenses.${lens}`)}{i === 0 ? ` · ${t('home')}` : ''}
                </Link>
              ))}
            </div>
          </div>

          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
            {t('viewShapingNote')}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {notice && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{notice}</span>}
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                background: 'var(--accent, #6366f1)', color: '#fff', border: 'none', opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
