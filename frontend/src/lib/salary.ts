/**
 * The salary guide's typed reads.
 *
 * Server-only by construction: every one of these renders before a session exists
 * (a crawler, a shared link, the sitemap), so they go through `publicApiGet` —
 * which attaches no credential and caches the response in Next's data cache, so
 * rendering two hundred role×city pages makes a handful of requests rather than
 * two hundred.
 *
 * The shapes mirror `api/src/application/career/salaryDirectory.ts`. The catalog
 * lives on the server because the numbers do: a second copy of the role list here
 * would be a second thing to keep true.
 */
import { publicApiGet } from '@/lib/publicApi';
import { DEFAULT_LOCALE } from '@/i18n/config';

export interface SalaryRole { slug: string; title: string; discipline: string; family: string }
export interface SalaryCity { slug: string; name: string; query: string; region: string }

export interface SalaryCityRow {
  slug: string;
  name: string;
  region: string;
  low: number;
  median: number;
  high: number;
  vsNational: number;
}

export interface SalaryBandRow {
  seniority: string;
  low: number;
  median: number;
  high: number;
}

export interface SalaryRoleGuide {
  role: SalaryRole;
  currency: string;
  national: { low: number; median: number; high: number };
  cities: SalaryCityRow[];
  seniorities: SalaryBandRow[];
}

export interface SalaryAnalysisView {
  band: { currency: string; low: number; median: number; high: number };
  discipline: string;
  seniority: string;
  region: string;
  workMode: string;
  assumptions: string[];
  basis: string;
}

export interface SalaryCityGuide {
  role: SalaryRole;
  city: SalaryCity;
  currency: string;
  analysis: SalaryAnalysisView;
  seniorities: SalaryBandRow[];
  otherCities: SalaryCityRow[];
}

export const getSalaryDirectory = () =>
  publicApiGet<{ roles: SalaryRole[]; cities: SalaryCity[] }>('/api/salary');

export const getSalaryRoleGuide = (role: string) =>
  publicApiGet<{ guide: SalaryRoleGuide }>(`/api/salary/${encodeURIComponent(role)}`);

export const getSalaryCityGuide = (role: string, city: string) =>
  publicApiGet<{ guide: SalaryCityGuide }>(`/api/salary/${encodeURIComponent(role)}/${encodeURIComponent(city)}`);

/**
 * Whole-currency money. `Intl` with no fraction digits, because a salary band
 * shown to the cent reads as a precision the model does not have.
 */
export function money(amount: number, currency: string, locale: string = DEFAULT_LOCALE): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency, maximumFractionDigits: 0, minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString(locale)}`;
  }
}
