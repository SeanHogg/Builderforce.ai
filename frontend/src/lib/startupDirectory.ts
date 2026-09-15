/**
 * Typed client for the PUBLIC startup directory — `/api/public/startups`.
 *
 * The marketplace's `company` family, the public profile page and the
 * investor-intelligence explainer all read this contract; none embeds a fetch.
 * The browser half rides `apiRequest` with `auth: 'web'` so a signed-in reader
 * is widened to the `member` tier (runway in months, the founder's contact)
 * without the read ever being gated. The server half rides `publicApiGet` for
 * the edge-rendered profile page and the sitemap, which have no session at all.
 *
 * The shapes mirror `api/src/application/investor/startupDirectory.ts` — one
 * wire format, stated on each side.
 */

import {
  LISTING_LIMITS,
  type DirectorySort,
  type RunwayVerdict,
} from '@builderforce/creation-canvas-contract';
import { apiRequest } from './apiClient';
import { publicApiGet } from './publicApi';

export interface StartupCard {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  logoUrl: string | null;
  website: string | null;
  stage: string | null;
  businessStage: string | null;
  sector: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  foundedYear: number | null;
  headcount: number | null;
  foundersCount: number | null;
  seeking: string[];
  isSeekingInvestment: boolean;
  acceptsInquiries: boolean;
  fundingGoal: number | null;
  totalFundingRaised: number | null;
  monthlyRevenue: number | null;
  runwayHealth: RunwayVerdict['health'] | null;
  runwayMonths: number | null;
  inquiryCount: number;
  listedAt: string | null;
  updatedAt: string;
}

export interface StartupProfile extends StartupCard {
  viewer: 'public' | 'member';
  investorContactName: string | null;
  investorContactEmail: string | null;
  openRounds: Array<{ name: string; round: string | null; askAmount: number | null; currency: string; status: string }>;
  financeDeclaredAt: string | null;
}

export interface DirectoryPage {
  startups: StartupCard[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** The browser's filter state. Mirrors `parseDirectoryFilters` on the server. */
export interface DirectoryQuery {
  q?: string;
  stages?: string[];
  businessStages?: string[];
  sectors?: string[];
  seeking?: string[];
  seekingInvestment?: boolean | null;
  sort?: DirectorySort;
  page?: number;
  limit?: number;
}

export function directoryQueryString(query: DirectoryQuery): string {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.stages?.length) params.set('stages', query.stages.join(','));
  if (query.businessStages?.length) params.set('businessStages', query.businessStages.join(','));
  if (query.sectors?.length) params.set('sectors', query.sectors.join(','));
  if (query.seeking?.length) params.set('seeking', query.seeking.join(','));
  if (query.seekingInvestment === true || query.seekingInvestment === false) params.set('seekingInvestment', String(query.seekingInvestment));
  if (query.sort) params.set('sort', query.sort);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  params.set('limit', String(Math.min(LISTING_LIMITS.pageMax, query.limit ?? LISTING_LIMITS.pageDefault)));
  return params.toString();
}

export interface InquiryBody {
  investorName: string;
  investorEmail: string;
  investorCompany?: string | null;
  investorTitle?: string | null;
  investorPhone?: string | null;
  interestedAmount?: number | null;
  investmentType?: string | null;
  timeframe?: string | null;
  isAccredited?: boolean;
  areasOfExpertise?: string[];
  investmentHistory?: string | null;
  message: string;
}

export interface InquiryReceipt {
  id: number;
  companyName: string;
  status: string;
  createdAt: string;
}

const BASE = '/api/public/startups';

export const publicStartupApi = {
  browse: (query: DirectoryQuery): Promise<DirectoryPage> =>
    apiRequest<DirectoryPage>(`${BASE}?${directoryQueryString(query)}`, { auth: 'web' }),
  get: (slug: string): Promise<StartupProfile> =>
    apiRequest<{ startup: StartupProfile }>(`${BASE}/${encodeURIComponent(slug)}`, { auth: 'web' }).then((r) => r.startup),
  inquire: (slug: string, body: InquiryBody): Promise<InquiryReceipt> =>
    apiRequest<{ inquiry: InquiryReceipt }>(`${BASE}/${encodeURIComponent(slug)}/inquiries`, {
      method: 'POST',
      auth: 'none',
      body: JSON.stringify(body),
    }).then((r) => r.inquiry),
};

/* ═══ Server-side readers — no session, cached by Next's data cache ═══ */

/** One listed company for the edge-rendered profile page. `null` when not listed. */
export async function getPublicStartup(slug: string): Promise<StartupProfile | null> {
  const body = await publicApiGet<{ startup: StartupProfile }>(`${BASE}/${encodeURIComponent(slug)}`, { revalidateSeconds: 600 });
  return body?.startup ?? null;
}

/** Every listed slug, for the sitemap. Newest first, capped at the page maximum
 *  times four pages — a directory larger than that gets its own sitemap index. */
export async function listPublicStartupSlugs(): Promise<string[]> {
  const pages = await Promise.all([1, 2, 3, 4].map((page) =>
    publicApiGet<DirectoryPage>(`${BASE}?${directoryQueryString({ page, limit: LISTING_LIMITS.pageMax, sort: 'newest' })}`)));
  return pages.flatMap((page) => page?.startups.map((s) => s.slug) ?? []);
}
