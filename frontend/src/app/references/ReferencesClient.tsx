'use client';

/**
 * The reference list, and the share links issued from it.
 *
 * Client-rooted because it is a workspace of a person's own private data: every
 * read carries their session, and nothing here is indexable. The marketing story
 * for logged-out visitors is handled by the route's teaser, not by this component.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Surface } from '@/components/ui';
import { Select } from '@/components/Select';
import { ReferenceCard } from '@/components/references/ReferenceCard';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import {
  referencesApi,
  type ProfessionalReference,
  type ReferenceShare,
  type ReferenceStatus,
} from '@/lib/referencesApi';

const STATUSES: readonly ReferenceStatus[] = ['draft', 'requested', 'confirmed', 'declined'];

const field: React.CSSProperties = {
  padding: '9px 12px', fontSize: 'var(--font-size-body)', background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)', width: '100%', fontFamily: 'inherit',
};

const EMPTY_DRAFT = { name: '', relationship: '', company: '', title: '', email: '', phone: '', canSpeakTo: '' };

export default function ReferencesClient() {
  const t = useTranslations('references');
  const [references, setReferences] = useState<ProfessionalReference[]>([]);
  const [shares, setShares] = useState<ReferenceShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeContact, setIncludeContact] = useState(false);
  /** The just-issued link. Not recoverable once this component unmounts. */
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const { copied, copy } = useCopyToClipboard(1500);

  const shareUrl = (token: string) =>
    typeof window === 'undefined' ? `/references/shared/${token}` : `${window.location.origin}/references/shared/${token}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, shareList] = await Promise.all([referencesApi.list(), referencesApi.listShares()]);
      setReferences(list);
      setShares(shareList);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('actionFailed')); }
    finally { setBusy(false); }
  };

  const add = async () => {
    if (!draft.name.trim()) { setError(t('nameRequired')); return; }
    await act(async () => {
      await referencesApi.create(draft);
      setDraft({ ...EMPTY_DRAFT });
    });
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const share = async () => {
    if (selected.size === 0) { setError(t('selectToShare')); return; }
    await act(async () => {
      // The raw token exists in this response and nowhere else — only its hash is
      // stored — so the URL is held here and shown until the person navigates away.
      const issued = await referencesApi.createShare({ referenceIds: [...selected], includeContact });
      setIssuedUrl(shareUrl(issued.token));
      setSelected(new Set());
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── Add ─────────────────────────────────────────────────────────────── */}
      <Surface style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('addTitle')}
        </h2>
        <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('addSubtitle')}</p>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <input style={field} placeholder={t('field.name')} value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          <input style={field} placeholder={t('field.title')} value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
          <input style={field} placeholder={t('field.company')} value={draft.company}
            onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))} />
          <input style={field} placeholder={t('field.email')} value={draft.email}
            onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
          <input style={field} placeholder={t('field.phone')} value={draft.phone}
            onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
          <input style={field} placeholder={t('field.relationship')} value={draft.relationship}
            onChange={(e) => setDraft((d) => ({ ...d, relationship: e.target.value }))} />
        </div>
        <textarea style={{ ...field, resize: 'vertical' }} rows={3} placeholder={t('field.canSpeakTo')}
          value={draft.canSpeakTo} onChange={(e) => setDraft((d) => ({ ...d, canSpeakTo: e.target.value }))} />
        <div>
          <Button variant="primary" size="sm" onClick={add} disabled={busy}>{t('add')}</Button>
        </div>
      </Surface>

      {error && <p role="alert" style={{ color: 'var(--error-text)', fontSize: 'var(--font-size-small)', margin: 0 }}>{error}</p>}
      {loading && <p style={{ color: 'var(--text-muted)' }}>{t('loading')}</p>}

      {!loading && references.length === 0 && (
        <Surface style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('empty')}</Surface>
      )}

      {/* ── The list ────────────────────────────────────────────────────────── */}
      {references.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('listTitle', { count: references.length })}
          </h2>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {references.map((reference) => (
              <div key={reference.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <ReferenceCard
                  reference={reference}
                  statusLabel={t(`status.${reference.status}`)}
                  canSpeakToLabel={t('canSpeakTo')}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
                    <input type="checkbox" checked={selected.has(reference.id)} onChange={() => toggleSelected(reference.id)} />
                    {t('includeInShare')}
                  </label>
                  <Select
                    value={reference.status}
                    onChange={(e) => act(() => referencesApi.update(reference.id, { status: e.target.value as ReferenceStatus }))}
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                        {t(`status.${status}`)}
                      </option>
                    ))}
                  </Select>
                  <Button variant="secondary" size="sm" onClick={() => act(() => referencesApi.remove(reference.id))} disabled={busy}>
                    {t('remove')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Shares ──────────────────────────────────────────────────────────── */}
      {references.length > 0 && (
        <Surface style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('shareTitle')}
          </h2>
          <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('shareSubtitle')}</p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={includeContact} onChange={(e) => setIncludeContact(e.target.checked)} />
            {t('includeContact')}
          </label>
          <div>
            <Button variant="primary" size="sm" onClick={share} disabled={busy}>
              {t('createShare', { count: selected.size })}
            </Button>
          </div>

          {issuedUrl && (
            <div style={{
              display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
              border: '1px solid var(--success)', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-elevated)', padding: '10px 12px',
            }}>
              <span style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--success-text, var(--success))' }}>
                {t('linkOnce')}
              </span>
              <code style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                {issuedUrl}
              </code>
              <Button variant="primary" size="sm" onClick={() => copy(issuedUrl)}>
                {copied ? t('copied') : t('copy')}
              </Button>
            </div>
          )}

          {shares.filter((s) => !s.revokedAt).map((s) => (
            <div key={s.id} style={{
              display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
              borderTop: '1px solid var(--border-subtle)', paddingTop: 10,
            }}>
              <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-primary)' }}>
                {s.label || t('untitledShare')}
              </span>
              <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
                {t('shareMeta', { count: s.referenceIds.length, views: s.viewCount })}
              </span>
              <Button variant="secondary" size="sm" onClick={() => act(() => referencesApi.revokeShare(s.id))} disabled={busy}>
                {t('revoke')}
              </Button>
            </div>
          ))}
        </Surface>
      )}
    </div>
  );
}
