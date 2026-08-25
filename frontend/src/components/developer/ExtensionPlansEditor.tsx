/**
 * A PACKAGE'S PRICE LIST — the publisher's half of PRD 24 §5.4.
 *
 * ── WHY THE WHOLE LIST IS EDITED AND SAVED AT ONCE ──────────────────────────
 * The endpoint is a PUT for the reason the service gives: per-plan mutations would
 * each need their own ordering, their own conflict story and their own answer to
 * "what happens to the customers on the plan you just deleted". Editing the list
 * as one value removes all three questions, and it is also what a person doing
 * this actually wants — a price list is reviewed as a whole before it goes live.
 *
 * ── THE GATE IS SHOWN, NOT HIDDEN ───────────────────────────────────────────
 * A publisher who is not identity-verified cannot charge (`mayCharge`, PRD 24 §9
 * decision 2). The form is still rendered, disabled, with the reason stated —
 * because a missing form teaches nobody what to do next, while a disabled one
 * with "verify your identity first" beside it does. The server refuses regardless;
 * this is the explanation, not the enforcement.
 *
 * ── MONEY IS ENTERED IN THE UNIT PEOPLE THINK IN ────────────────────────────
 * Fields are in whole currency units and converted to cents at the boundary, once,
 * here. A publisher typing 9 means nine dollars; a form that stored 9 cents would
 * be wrong in the direction that is not noticed until a customer's invoice.
 *
 * ── NO `use client` DIRECTIVE, DELIBERATELY ─────────────────────────────────
 * Imported only by `DeveloperPortalContent`, which is already the boundary. A
 * module imported by a client module IS client code either way, so the directive
 * would mark nothing and change nothing except the architecture ratchet's count —
 * the finding its own changelog records three separate times.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { developerApi, type ExtensionPlan, type ExtensionPricing } from '@/lib/builderforceApi';

type Props = {
  packageId: string;
  /** The publisher's trust tier. Only `identity_verified` may charge. */
  publisherState: string;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
};

const muted: React.CSSProperties = { fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' };

const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 'var(--font-size-small)',
  background: 'var(--bg-elevated, var(--bg-base))',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  minHeight: 36,
};

const button: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  background: 'var(--surface-interactive)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  minHeight: 36,
};

const quiet: React.CSSProperties = { ...button, background: 'none' };

/** A row as the FORM holds it: whole currency units, because that is what a
 *  person types. Converted to cents exactly once, on save. */
type PlanDraft = {
  code: string;
  name: string;
  price: string;
  interval: 'month' | 'year';
  includedUnits: string;
  meteredRate: string;
  unitLabel: string;
};

const EMPTY_DRAFT: PlanDraft = {
  code: '',
  name: '',
  price: '',
  interval: 'month',
  includedUnits: '0',
  meteredRate: '',
  unitLabel: '',
};

const toDraft = (plan: ExtensionPlan): PlanDraft => ({
  code: plan.code,
  name: plan.name,
  price: plan.priceCents ? String(plan.priceCents / 100) : '',
  interval: plan.interval === 'year' ? 'year' : 'month',
  includedUnits: String(plan.includedUnits),
  meteredRate: plan.meteredRateCents ? String(plan.meteredRateCents / 100) : '',
  unitLabel: plan.unitLabel,
});

/** Whole currency units → cents. A blank or unreadable field is zero, never NaN:
 *  a NaN would reach the server as `null` and be stored as a free plan. */
function toCents(value: string): number {
  const n = Number(value.trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

function toUnits(value: string): number {
  const n = Number(value.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

const toPlan = (d: PlanDraft): ExtensionPlan => ({
  code: d.code.trim().toLowerCase(),
  name: d.name.trim(),
  description: null,
  priceCents: toCents(d.price),
  interval: d.interval,
  includedUnits: toUnits(d.includedUnits),
  meteredRateCents: toCents(d.meteredRate),
  unitLabel: d.unitLabel.trim() || 'unit',
});

export function ExtensionPlansEditor({ packageId, publisherState, busy, onRun }: Props) {
  const t = useTranslations('developerPortal.publish.plans');
  const [pricing, setPricing] = useState<ExtensionPricing | null>(null);
  const [drafts, setDrafts] = useState<PlanDraft[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const mayCharge = publisherState === 'identity_verified';

  useEffect(() => {
    let cancelled = false;
    void developerApi.plans(packageId)
      .then((p) => {
        if (cancelled) return;
        setPricing(p);
        setDrafts(p.plans.map(toDraft));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : t('loadFailed'));
      });
    return () => { cancelled = true; };
  }, [packageId, t]);

  const set = (index: number, patch: Partial<PlanDraft>) =>
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  const save = () =>
    onRun(`plans:${packageId}`, async () => {
      const saved = await developerApi.setPlans(packageId, drafts.map(toPlan), pricing?.currency);
      setPricing(saved);
      // Re-seeded from what the SERVER kept, not from what was typed. The parser
      // drops a plan it cannot read and clamps what it can, so showing the draft
      // back would tell a publisher they had saved something they had not.
      setDrafts(saved.plans.map(toDraft));
    });

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <strong style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-primary)' }}>{t('title')}</strong>
      <p style={{ ...muted, maxWidth: '70ch' }}>{t('hint')}</p>
      {!mayCharge && (
        <p role="note" style={{ ...muted, color: 'var(--coral-bright)' }}>{t('needsIdentity')}</p>
      )}
      {loadError && <p role="alert" style={{ ...muted, color: 'var(--coral-bright)' }}>{loadError}</p>}

      {drafts.length === 0 && <p style={muted}>{t('empty')}</p>}

      {drafts.map((d, i) => (
        <fieldset
          key={`plan-${i}`}
          disabled={!mayCharge}
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: 12,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
            gap: 10,
          }}
        >
          <legend style={muted}>{d.name || t('newPlan')}</legend>
          <label style={muted}>
            {t('code')}
            <input style={input} value={d.code} onChange={(e) => set(i, { code: e.target.value })} />
          </label>
          <label style={muted}>
            {t('name')}
            <input style={input} value={d.name} onChange={(e) => set(i, { name: e.target.value })} />
          </label>
          <label style={muted}>
            {t('price')}
            <input style={input} inputMode="decimal" value={d.price} onChange={(e) => set(i, { price: e.target.value })} />
          </label>
          <label style={muted}>
            {t('interval')}
            <select
              style={input}
              value={d.interval}
              onChange={(e) => set(i, { interval: e.target.value === 'year' ? 'year' : 'month' })}
            >
              {/* A native <option> needs its own opaque colours: the popup is drawn
                  by the OS and does not inherit the page's theme. */}
              <option value="month" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>{t('month')}</option>
              <option value="year" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>{t('year')}</option>
            </select>
          </label>
          <label style={muted}>
            {t('unitLabel')}
            <input style={input} value={d.unitLabel} onChange={(e) => set(i, { unitLabel: e.target.value })} placeholder={t('unitPlaceholder')} />
          </label>
          <label style={muted}>
            {t('included')}
            <input style={input} inputMode="numeric" value={d.includedUnits} onChange={(e) => set(i, { includedUnits: e.target.value })} />
          </label>
          <label style={muted}>
            {t('meteredRate')}
            <input style={input} inputMode="decimal" value={d.meteredRate} onChange={(e) => set(i, { meteredRate: e.target.value })} />
          </label>
          <button
            type="button"
            style={quiet}
            onClick={() => setDrafts((prev) => prev.filter((_, idx) => idx !== i))}
          >
            {t('remove')}
          </button>
        </fieldset>
      ))}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          style={quiet}
          disabled={!mayCharge}
          onClick={() => setDrafts((prev) => [...prev, { ...EMPTY_DRAFT }])}
        >
          {t('add')}
        </button>
        <button
          type="button"
          style={button}
          disabled={!mayCharge || busy === `plans:${packageId}`}
          onClick={() => void save()}
        >
          {t('save')}
        </button>
      </div>
    </div>
  );
}
