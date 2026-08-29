'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Formatter } from '@/i18n/format';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { useRole, hasMinRole } from '@/lib/rbac';
import { rfpApi, type RfpRequestListRow, type RfpRequestInput, type BrandPalette } from '@/lib/builderforceApi';
import { BrandPaletteEditor } from './BrandPaletteEditor';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { useFormat } from "@/i18n/useFormat";
import { faultMessage } from '@/lib/apiClient';

/**
 * RfpContent — the RFP/RFQ Response surface, rendered as a tab UNDER Projects
 * (not a top-level menu item). Lists incoming requests with their latest generated
 * proposal summary, and creates a new request (co-brand colours, requirements,
 * greenfield-or-existing grounding, P&L knobs) via the canonical SlideOutPanel.
 *
 * It also owns the RESPONDER side of the co-branding — the tenant's own palette,
 * stored on the tenant row rather than defaulted per render, so two tenants no
 * longer send identically-coloured proposals. Both palettes are edited through
 * the same `BrandPaletteEditor`, which can read colours off a website or a logo
 * instead of asking someone to eyedrop a screenshot.
 *
 * Writes are gated to developer+ (mirrors the server requireRole); the tenant
 * palette is manager+. Localized + themed.
 */

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

/**
 * The proposal DOCUMENT's palette, not this app's.
 *
 * These five colours are written into a standalone `.html` the customer opens
 * outside BuilderForce (see `DocumentSection`: it renders into an isolated
 * `srcDoc` iframe and downloads as a file), so a token here resolves to nothing
 * — which is what had happened: `text` was `var(--bg-elevated)`, i.e. WHITE ink
 * on a white page anywhere the variable did resolve, and invalid where it did
 * not. Literals are correct here, and only here.
 */
const DEFAULT_BRAND: BrandPalette = {
  primary: '#334155', secondary: '#64748b', accent: '#0ea5e9', text: '#0f172a', background: '#ffffff', logoUrl: '',
};

const EMPTY: RfpRequestInput = {
  title: '', requesterOrgName: '', requesterBrand: { ...DEFAULT_BRAND },
  requirements: '', sourceMode: 'new', basedOnProjectId: null,
  marginPct: 0.25, marketingPct: 0.12, contingencyPct: 0.1, dueDate: null,
};

function money(fmt: Formatter, cents: number | null | undefined): string {
  if (cents == null) return '—';
  return fmt.money(Math.round(cents / 100));
}

export default function RfpContent() {
  const fmt = useFormat();
  const t = useTranslations('rfpPage');
  const router = useRouter();
  const role = useRole();
  const canManage = hasMinRole(role, 'developer');

  const [rows, setRows] = useState<RfpRequestListRow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<RfpRequestInput>(EMPTY);
  const [saving, setSaving] = useState(false);

  const canBrand = hasMinRole(role, 'manager');
  const [brandOpen, setBrandOpen] = useState(false);
  const [brand, setBrand] = useState<BrandPalette | null>(null);
  const [brandIsDefault, setBrandIsDefault] = useState(true);
  const [savingBrand, setSavingBrand] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    rfpApi.list()
      .then((r) => setRows(r.requests))
      .catch((e: unknown) => setError(faultMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchProjects().then(setProjects).catch(() => setProjects([])); }, []);
  useEffect(() => {
    rfpApi.getBrand()
      .then((r) => { setBrand(r.palette); setBrandIsDefault(r.isDefault); })
      .catch(() => setBrand(null));
  }, []);

  const saveBrand = async () => {
    if (!brand) return;
    setSavingBrand(true);
    setError(null);
    try {
      const saved = await rfpApi.setBrand(brand);
      setBrand(saved.palette);
      setBrandIsDefault(false);
      setBrandOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingBrand(false);
    }
  };

  const openCreate = () => { setDraft({ ...EMPTY, requesterBrand: { ...DEFAULT_BRAND } }); setPanelOpen(true); };

  const setRequesterBrand = (patch: Partial<BrandPalette>) =>
    setDraft((d) => ({ ...d, requesterBrand: { ...(d.requesterBrand ?? DEFAULT_BRAND), ...patch } }));

  const create = async () => {
    if (!draft.title?.trim()) { setError(t('validation')); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await rfpApi.createRequest(draft);
      setPanelOpen(false);
      router.push(`/projects/rfp/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const statusLabel = (s: string) => t(`status.${s}`);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'clamp(20px,3vw,26px)', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>{t('title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0, maxWidth: 640 }}>{t('subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setBrandOpen(true)} disabled={!canBrand} title={canBrand ? undefined : t('needManager')}>
            {brandIsDefault ? t('brand.setYours') : t('brand.yours')}
          </button>
          <button type="button" className="btn btn-primary" onClick={openCreate} disabled={!canManage} title={canManage ? undefined : t('needDeveloper')}>
            {t('newRequest')}
          </button>
        </div>
      </div>

      {loading && <div style={card}>{t('loading')}</div>}
      {error && <div style={{ ...card, borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>}

      {!loading && !error && (
        rows.length === 0 ? (
          <div style={{ ...card, color: 'var(--text-muted)' }}>{t('empty')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => router.push(`/projects/rfp/${r.id}`)}
                style={{ ...card, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15 }}>{r.title}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{statusLabel(r.status)}</span>
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  {r.requesterOrgName || t('noOrg')} · {r.sourceMode === 'existing_project' ? t('sourceExisting') : t('sourceNew')}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {r.latestResponse ? t('quoted', { price: money(fmt, r.latestResponse.quotedPriceUsdCents) }) : t('notGenerated')}
                  </span>
                  {r.latestResponse?.scanRefreshed && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)' }}>{t('scanFresh')}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )
      )}

      <SlideOutPanel open={panelOpen} onClose={() => setPanelOpen(false)} title={t('newRequest')} widthStorageKey="rfp-new-request">
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label={t('field.title')}>
            <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={t('field.titlePlaceholder')} />
          </Field>
          <Field label={t('field.requesterOrg')}>
            <input className="input" value={draft.requesterOrgName ?? ''} onChange={(e) => setDraft({ ...draft, requesterOrgName: e.target.value })} placeholder={t('field.requesterOrgPlaceholder')} />
          </Field>

          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('field.requesterBrand')}</span>
            <BrandPaletteEditor
              value={draft.requesterBrand ?? DEFAULT_BRAND}
              onChange={setRequesterBrand}
              hint={t('field.requesterBrandHint')}
            />
          </div>

          <Field label={t('field.requirements')}>
            <textarea className="input" style={{ minHeight: 120 }} value={draft.requirements ?? ''} onChange={(e) => setDraft({ ...draft, requirements: e.target.value })} placeholder={t('field.requirementsPlaceholder')} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label={t('field.sourceMode')}>
              <Select className="input" value={draft.sourceMode} onChange={(e) => setDraft({ ...draft, sourceMode: e.target.value as 'new' | 'existing_project' })}>
                <option value="new">{t('sourceNew')}</option>
                <option value="existing_project">{t('sourceExisting')}</option>
              </Select>
            </Field>
            {draft.sourceMode === 'existing_project' && (
              <Field label={t('field.project')}>
                <Select className="input" value={draft.basedOnProjectId ?? ''} onChange={(e) => setDraft({ ...draft, basedOnProjectId: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">{t('field.selectProject')}</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
            )}
          </div>

          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('field.economics')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 6 }}>
              <PctField label={t('field.margin')} value={draft.marginPct} onChange={(v) => setDraft({ ...draft, marginPct: v })} />
              <PctField label={t('field.marketing')} value={draft.marketingPct} onChange={(v) => setDraft({ ...draft, marketingPct: v })} />
              <PctField label={t('field.contingency')} value={draft.contingencyPct} onChange={(v) => setDraft({ ...draft, contingencyPct: v })} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn-primary" onClick={create} disabled={saving || !canManage}>
              {saving ? t('creating') : t('create')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setPanelOpen(false)}>{t('cancel')}</button>
          </div>
        </div>
      </SlideOutPanel>

      <SlideOutPanel open={brandOpen} onClose={() => setBrandOpen(false)} title={t('brand.yours')} widthStorageKey="rfp-brand">
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {brand ? (
            <>
              <BrandPaletteEditor
                value={brand}
                onChange={(patch) => setBrand((b) => (b ? { ...b, ...patch } : b))}
                hint={t('brand.yoursHint')}
                disabled={!canBrand}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="button" className="btn btn-primary" onClick={saveBrand} disabled={savingBrand || !canBrand}>
                  {savingBrand ? t('creating') : t('brand.save')}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setBrandOpen(false)}>{t('cancel')}</button>
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</p>
          )}
        </div>
      </SlideOutPanel>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </label>
  );
}

function PctField({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</span>
      <input
        className="input"
        type="number"
        min={0}
        max={90}
        step={1}
        value={value == null ? '' : Math.round(value * 100)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value) / 100)}
        placeholder="%"
      />
    </label>
  );
}
