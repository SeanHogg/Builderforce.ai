'use client';

/**
 * The listing wizard — three steps over one company, saved as it goes.
 *
 * ── SAVED PER STEP, NOT AT THE END ──────────────────────────────────────────
 * BurnRateOS's stepper held everything in memory and wrote the company on the
 * final "complete" call, so a founder who left after step two had typed for ten
 * minutes and owned nothing. Here step one CREATES the company (or updates it),
 * step two declares the money, step three writes the visibility fields — three
 * writers, three saves, and closing the tab after any of them loses nothing.
 *
 * ── THE DOOR OUT IS THE LISTING'S OWN ACTION ────────────────────────────────
 * The last step ends on "list it", which is the publish TRANSITION the server
 * gates on completeness. A refusal names the missing fields, and the wizard
 * jumps back to the step that holds them.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { faultMessage } from '@/lib/apiClient';
import { investorApi, type StartupListing, type StartupListingPatch } from '@/lib/investorApi';
import { buttonStyle, errorStyle, mutedStyle, primaryButtonStyle } from '@/components/investor/investorStyles';
import type { RunwayInputs } from '../RunwayCalculator';
import { CompanyBasicsStep } from './CompanyBasicsStep';
import { FinanceContextStep } from './FinanceContextStep';
import { VisibilityStep } from './VisibilityStep';
import { LISTING_STEPS, nextStep, previousStep, type ListingStepId } from './listingSteps';

/** Which step each REQUIRED field is edited on — how a publish refusal knows where to send the founder. */
const STEP_FOR_FIELD: Record<string, ListingStepId> = {
  name: 'basics', tagline: 'basics', description: 'basics', stage: 'basics', sector: 'basics', country: 'basics',
};

function draftFrom(listing: StartupListing | null): StartupListingPatch {
  if (!listing) return { allowInvestorInquiries: true, seeking: [] };
  return {
    name: listing.name,
    website: listing.website,
    tagline: listing.tagline,
    description: listing.description,
    logoUrl: listing.logoUrl,
    stage: listing.stage,
    businessStage: listing.businessStage,
    sector: listing.sector,
    city: listing.city,
    region: listing.region,
    country: listing.country,
    foundedYear: listing.foundedAt ? new Date(listing.foundedAt).getUTCFullYear() : null,
    headcount: listing.headcount,
    foundersCount: listing.foundersCount,
    seeking: listing.seeking,
    fundingGoal: listing.fundingGoal,
    totalFundingRaised: listing.totalFundingRaised,
    isSeekingInvestment: listing.isSeekingInvestment,
    allowInvestorInquiries: listing.allowInvestorInquiries,
    investorContactName: listing.investorContactName,
    investorContactEmail: listing.investorContactEmail,
  };
}

function financeFrom(listing: StartupListing | null): RunwayInputs {
  return {
    cashOnHand: listing?.finance.cashOnHand ?? null,
    monthlyBudget: listing?.finance.monthlyBudget ?? null,
    monthlyRevenue: listing?.finance.monthlyRevenue ?? null,
    teamCost: listing?.finance.teamCost ?? null,
  };
}

export function StartupListingWizard({
  listing,
  onSaved,
  onListed,
  onCancel,
}: {
  /** The company being edited, or null to create one on the first save. */
  listing: StartupListing | null;
  /** Fired after every successful write with the fresh facet. */
  onSaved: (listing: StartupListing) => void;
  /** Fired when the publish transition succeeds. */
  onListed: (listing: StartupListing) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('investor.listing');
  const [step, setStep] = useState<ListingStepId>('basics');
  const [draft, setDraft] = useState<StartupListingPatch>(() => draftFrom(listing));
  const [finance, setFinance] = useState<RunwayInputs>(() => financeFrom(listing));
  const [companyId, setCompanyId] = useState<number | null>(listing?.companyId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = LISTING_STEPS.findIndex((s) => s.id === step);
  const canLeaveBasics = Boolean(draft.name?.trim());

  /** Step 1 writes the company — created on first save, patched after. */
  const saveBasics = useCallback(async (): Promise<StartupListing | null> => {
    if (!draft.name?.trim()) return null;
    let id = companyId;
    if (id == null) {
      const created = await investorApi.companies.create({ name: draft.name.trim(), website: draft.website ?? null, stage: draft.stage ?? null, sector: draft.sector ?? null, country: draft.country ?? null, headcount: draft.headcount ?? null });
      id = created.id;
      setCompanyId(id);
    }
    const saved = await investorApi.listing.update(id, draft);
    onSaved(saved);
    return saved;
  }, [companyId, draft, onSaved]);

  const saveFinance = useCallback(async (): Promise<StartupListing | null> => {
    if (companyId == null) return null;
    const saved = await investorApi.listing.declareFinance(companyId, {
      cashOnHand: finance.cashOnHand,
      monthlyBudget: finance.monthlyBudget,
      monthlyRevenue: finance.monthlyRevenue,
      teamCost: finance.teamCost ?? null,
    });
    onSaved(saved);
    return saved;
  }, [companyId, finance, onSaved]);

  const saveVisibility = useCallback(async (): Promise<StartupListing | null> => {
    if (companyId == null) return null;
    const saved = await investorApi.listing.update(companyId, {
      seeking: draft.seeking ?? [],
      isSeekingInvestment: draft.isSeekingInvestment ?? false,
      allowInvestorInquiries: draft.allowInvestorInquiries ?? true,
      fundingGoal: draft.fundingGoal ?? null,
      totalFundingRaised: draft.totalFundingRaised ?? null,
      investorContactName: draft.investorContactName ?? null,
      investorContactEmail: draft.investorContactEmail ?? null,
    });
    onSaved(saved);
    return saved;
  }, [companyId, draft, onSaved]);

  const savers: Record<ListingStepId, () => Promise<StartupListing | null>> = useMemo(
    () => ({ basics: saveBasics, finance: saveFinance, visibility: saveVisibility }),
    [saveBasics, saveFinance, saveVisibility],
  );

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (cause) { setError(faultMessage(cause, t('error.save'))); } finally { setBusy(false); }
  };

  const advance = () => run(async () => {
    await savers[step]();
    const next = nextStep(step);
    if (next) setStep(next);
  });

  const back = () => { const prev = previousStep(step); if (prev) setStep(prev); };

  const publish = () => run(async () => {
    const saved = await savers.visibility();
    if (!saved) return;
    try {
      onListed(await investorApi.listing.setVisibility(saved.companyId, true));
    } catch (cause) {
      // The server names what is missing; land on the step that holds it.
      const missing = saved.completeness.missing.find((field) => STEP_FOR_FIELD[field]);
      if (missing) setStep(STEP_FOR_FIELD[missing]);
      throw cause;
    }
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }} aria-label={t('stepsLabel')}>
        {LISTING_STEPS.map((spec, index) => {
          const state = index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'todo';
          return (
            <li key={spec.id}>
              <button
                type="button"
                aria-current={state === 'current' ? 'step' : undefined}
                disabled={busy || (state === 'todo' && companyId == null)}
                onClick={() => setStep(spec.id)}
                style={{
                  ...buttonStyle,
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  borderColor: state === 'current' ? 'var(--seat-ceo)' : 'var(--border-subtle)',
                  color: state === 'todo' ? 'var(--text-muted)' : 'var(--text-primary)',
                }}
              >
                <Icon name={state === 'done' ? 'check' : spec.icon} size={14} />
                {t(`steps.${spec.labelKey}`)}
              </button>
            </li>
          );
        })}
      </ol>

      {step === 'basics' && <CompanyBasicsStep draft={draft} onChange={setDraft} />}
      {step === 'finance' && <FinanceContextStep value={finance} onChange={setFinance} />}
      {step === 'visibility' && <VisibilityStep draft={draft} onChange={setDraft} />}

      {error && <p style={errorStyle} role="alert">{error}</p>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', gap: 8 }}>
          {onCancel && <button type="button" style={buttonStyle} onClick={onCancel} disabled={busy}>{t('cancel')}</button>}
          {previousStep(step) && <button type="button" style={buttonStyle} onClick={back} disabled={busy}>{t('back')}</button>}
        </span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {busy && <span style={mutedStyle}>{t('saving')}</span>}
          {nextStep(step)
            ? <button type="button" style={primaryButtonStyle} onClick={advance} disabled={busy || (step === 'basics' && !canLeaveBasics)}>{t('saveContinue')}</button>
            : (
              <>
                <button type="button" style={buttonStyle} onClick={() => run(async () => { await savers.visibility(); })} disabled={busy}>{t('saveOnly')}</button>
                <button type="button" style={primaryButtonStyle} onClick={publish} disabled={busy}>{listing?.isPubliclyListed ? t('saveListed') : t('listNow')}</button>
              </>
            )}
        </span>
      </div>
    </div>
  );
}
