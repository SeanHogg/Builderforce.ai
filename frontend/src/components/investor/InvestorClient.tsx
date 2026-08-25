'use client';

/**
 * The CEO's raise — one client boundary over six sub-views (IN-3).
 *
 * ── ONE CLIENT BOUNDARY ─────────────────────────────────────────────────────
 * This is the only `'use client'` file in the investor surface. `CompaniesView`,
 * `RoundView`, `InvestorsView`, `DataRoomView`, `DiligenceView` and `PackView`
 * are ordinary modules pulled into the client bundle by being imported here —
 * the directive marks the BOUNDARY, and repeating it on every leaf adds files to
 * a ratchet without adding meaning.
 *
 * ── THE SHELL OWNS THE INDEX, THIS OWNS THE BODY ────────────────────────────
 * `investor` declares its sub-views in `navGroups.ts`, so the vertical index
 * column down the panel's left edge is rendered globally by `ShellIndex` and this
 * file never draws a tab bar of its own. Signed in, the route opens as a
 * `SlideOutPanel` OVER the canvas (§11.4.5) — the session keeps running, and
 * closing the panel returns to the board rather than to a page.
 *
 * ── ONE COMPANY SELECTION ACROSS EVERY SUB-VIEW ─────────────────────────────
 * Five of the six sub-views are company-scoped, so the selection is state HERE
 * and travels in `?company=`. That is deliberate: a founder switching from
 * Diligence to the Pack must not have to re-pick the company they were just
 * looking at, and a link to "the diligence gaps for Acme" has to be a URL rather
 * than a click path.
 *
 * ── ONE LOAD, SHARED ────────────────────────────────────────────────────────
 * The detail, the investor grants, the analytics, the rooms and the packs are
 * fetched once per company here and passed down. Each sub-view fetching its own
 * copy would mean five reads of the same company on every tab change, and five
 * places for "is this stale" to be answered differently.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { Select } from '@/components/Select';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { listDataRooms, type DataRoomSummary } from '@/lib/founderOpsApi';
import {
  investorApi,
  type CompanyDetail,
  type CompanyInvestorAnalytics,
  type CompanySummary,
  type InvestorGrantSummary,
  type PackSummary,
} from '@/lib/investorApi';
import { CompaniesView } from './CompaniesView';
import { RoundView } from './RoundView';
import { InvestorsView } from './InvestorsView';
import { DataRoomView } from './DataRoomView';
import { DiligenceView } from './DiligenceView';
import { PackView } from './PackView';
import { errorStyle, labelStyle, message, mutedStyle, rowStyle, sectionStyle } from './investorStyles';

/** The five per-company reads, stamped with the company they were read for. */
interface CompanyBundle {
  companyId: number;
  detail: CompanyDetail | null;
  investors: InvestorGrantSummary[];
  analytics: CompanyInvestorAnalytics | null;
  packs: PackSummary[];
  rooms: DataRoomSummary[];
}

// Module-level empties so a sub-view's props are referentially stable between
// renders while no company is loaded — a fresh `[]` each render would defeat
// every memo below it.
const EMPTY_INVESTORS: InvestorGrantSummary[] = [];
const EMPTY_PACKS: PackSummary[] = [];
const EMPTY_ROOMS: DataRoomSummary[] = [];

export default function InvestorClient() {
  const t = useTranslations('investor');
  const allowed = useRequireAuth();
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get('tab') ?? '';
  const companyFromUrl = params.get('company');

  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(companyFromUrl ? Number(companyFromUrl) : null);
  /**
   * The five per-company reads, as ONE piece of state stamped with the company
   * they belong to.
   *
   * Five `useState`s cleared by an effect is the shape this started as, and it
   * was wrong twice over: it wrote state synchronously inside an effect (the
   * cascading-render defect `react-hooks/set-state-in-effect` names), and while a
   * switch was in flight it rendered the PREVIOUS company's investors under the
   * NEW company's name. Stamping the bundle answers both — `loaded` is only ever
   * written from a resolved promise, and "is this the company on screen" becomes
   * a comparison rather than a clear.
   */
  const [loaded, setLoaded] = useState<CompanyBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by any write, which is what re-reads the company. A counter rather
  // than a per-writer callback, so a sub-view says "something changed" without
  // knowing which of the five reads it invalidated.
  const [revision, setRevision] = useState(0);

  /** Never sets `loading` true: it starts true, and a refetch after a write keeps
   *  the list on screen rather than flashing "Loading…" over content that is
   *  about to be replaced by nearly the same content. */
  const loadCompanies = useCallback(() => {
    investorApi.companies
      .list()
      .then((rows) => {
        setCompanies(rows);
        // A company is chosen for the reader when they have not chosen one:
        // landing on a picker with nothing selected makes five of the six
        // sub-views look empty when they are not.
        setCompanyId((current) => current ?? rows[0]?.id ?? null);
        setError(null);
      })
      .catch((cause: unknown) => setError(message(cause, t('error.companies'))))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { if (allowed) loadCompanies(); }, [allowed, loadCompanies, revision]);

  useEffect(() => {
    if (!allowed || companyId == null) return undefined;
    let cancelled = false;
    // One read per company, in parallel. Every failure degrades to an empty
    // section rather than blanking the surface: a workspace whose analytics call
    // fails still has a company, and saying so beats an error page.
    Promise.allSettled([
      investorApi.companies.get(companyId),
      investorApi.investors.list(companyId),
      investorApi.investors.analytics(companyId),
      investorApi.pack.list(companyId),
      listDataRooms(),
    ])
      .then(([detailResult, investorsResult, analyticsResult, packsResult, roomsResult]) => {
        if (cancelled) return;
        setLoaded({
          companyId,
          detail: detailResult.status === 'fulfilled' ? detailResult.value : null,
          investors: investorsResult.status === 'fulfilled' ? investorsResult.value : [],
          analytics: analyticsResult.status === 'fulfilled' ? analyticsResult.value : null,
          packs: packsResult.status === 'fulfilled' ? packsResult.value : [],
          rooms: roomsResult.status === 'fulfilled' ? roomsResult.value : [],
        });
        setError(detailResult.status === 'rejected' ? message(detailResult.reason, t('error.company')) : null);
      });
    return () => { cancelled = true; };
  }, [allowed, companyId, revision, t]);

  // DERIVED, not cleared: a bundle stamped with a different company is not this
  // company's data, so it is not shown as if it were.
  const current = loaded?.companyId === companyId ? loaded : null;
  const detail = current?.detail ?? null;
  const investors = current?.investors ?? EMPTY_INVESTORS;
  const analytics = current?.analytics ?? null;
  const packs = current?.packs ?? EMPTY_PACKS;
  const rooms = current?.rooms ?? EMPTY_ROOMS;
  const detailLoading = companyId != null && current == null;

  /** Selecting a company is a URL change, so the choice survives a reload and a
   *  shared link opens on the same company. `replace`, not `push`: switching
   *  company is not a step the Back button should have to walk through. */
  const selectCompany = useCallback((id: number) => {
    setCompanyId(id);
    const next = new URLSearchParams(params.toString());
    next.set('company', String(id));
    router.replace(`/investor?${next.toString()}`);
  }, [params, router]);

  const changed = useCallback(() => setRevision((n) => n + 1), []);

  const selected = useMemo(
    () => companies.find((company) => company.id === companyId) ?? null,
    [companies, companyId],
  );

  if (!allowed) return null;

  return (
    <PageContainer>
      <div style={sectionStyle}>
        <div style={rowStyle}>
          <div>
            <h1 style={{ margin: 0, fontSize: 'var(--font-size-section)' }}>{t('title')}</h1>
            <p style={mutedStyle}>{t('subtitle')}</p>
          </div>
          {/* The selector is on every tab because five of the six are
              company-scoped. Hidden on Companies, where the list IS the
              selector and a second one beside it would be two controls for one
              choice. */}
          {tab !== '' && companies.length > 0 && (
            <div style={{ minWidth: 220 }}>
              <label style={labelStyle} htmlFor="investor-company">{t('common.company')}</label>
              <Select
                id="investor-company"
                value={companyId != null ? String(companyId) : ''}
                onChange={(e) => selectCompany(Number(e.target.value))}
              >
                {companies.map((company) => (
                  <option key={company.id} value={String(company.id)}>{company.name}</option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {error && <p style={errorStyle} role="alert">{error}</p>}
        {loading && companies.length === 0 && <p style={mutedStyle}>{t('common.loading')}</p>}

        {tab === '' && (
          <CompaniesView
            companies={companies}
            selectedId={companyId}
            onSelect={selectCompany}
            onCreated={(company) => { setCompanyId(company.id); changed(); }}
            detail={detail}
            detailLoading={detailLoading}
            onDetailChanged={changed}
          />
        )}
        {tab === 'round' && <RoundView detail={detail} investors={investors} />}
        {tab === 'investors' && (
          <InvestorsView detail={detail} investors={investors} analytics={analytics} onChanged={changed} />
        )}
        {tab === 'dataroom' && <DataRoomView detail={detail} rooms={rooms} onChanged={changed} />}
        {tab === 'diligence' && <DiligenceView detail={detail} />}
        {tab === 'pack' && <PackView detail={detail} packs={packs} onChanged={changed} />}

        {/* Named for the reader rather than assumed: a workspace with no company
            yet lands on Companies whatever tab the URL asked for, because every
            other sub-view is about a company that does not exist. */}
        {companies.length === 0 && !loading && tab !== '' && (
          <p style={mutedStyle}>{t('common.noCompanies')}</p>
        )}
        {selected == null && companies.length > 0 && tab !== '' && (
          <p style={mutedStyle}>{t('common.pickCompany')}</p>
        )}
      </div>
    </PageContainer>
  );
}
