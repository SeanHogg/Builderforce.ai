/**
 * Tax routes — /api/tax
 *
 *   GET   /profile          → my own W-9/W-8 profile (self-service)
 *   PUT   /profile          → submit or amend it; the tax id is WRITE-ONLY
 *   GET   /options          → the entity / id types a form offers
 *   GET   /years            → every year with payouts        (manager+)
 *   GET   /report/:year     → the 1099 year-end report       (manager+)
 *   GET   /report/:year.csv → the filer-ready CSV            (manager+)
 *
 * ── THE TWO AUDIENCES ───────────────────────────────────────────────────────
 * A tax profile is SELF-SERVICE: a payee submits their own W-9 and nobody else
 * reads it back. The report is a MANAGER surface: it lists every recipient's
 * legal name, address and tax-id last-four, which is the workspace's most
 * sensitive aggregate. Those are different gates on the same router, so the role
 * middleware is attached per-route rather than to `*` — an `r.use('*')` here
 * would lock a freelancer out of their own form.
 *
 * The routes take application ports and never a table (`check:layering`), and
 * the static `/report/...` segments are registered before any wildcard so Hono
 * cannot match a literal path against `/:id`.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  getTaxProfile,
  saveTaxProfile,
  taxProfileOptions,
  type TaxProfileInput,
} from '../../application/finance/taxProfile';
import {
  buildTaxYearReport,
  listTaxYears,
  taxYearReportFilename,
  taxYearReportToCsv,
} from '../../application/finance/taxReport';
import { exportContentMeta } from '../../application/export/tabularExport';

/** The fields a caller may set. Anything else in the body is ignored. */
const PROFILE_FIELDS = [
  'entityType', 'legalName', 'businessName',
  'addressLine1', 'addressLine2', 'addressCity', 'addressRegion',
  'addressPostalCode', 'addressCountry', 'taxResidencyCountry',
  'taxIdType', 'taxId',
] as const;

/**
 * Take only the known fields, preserving the `undefined` / present distinction
 * the application layer uses to tell "not mentioned" from "deliberately blank".
 */
function readProfileBody(body: Record<string, unknown>): TaxProfileInput {
  const input: Record<string, unknown> = {};
  for (const field of PROFILE_FIELDS) {
    if (field in body) input[field] = body[field];
  }
  return input as TaxProfileInput;
}

export function createTaxRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  r.use('*', authMiddleware);

  const managerOnly = requireRole(TenantRole.MANAGER);

  /** The form's select options. Data, so the UI holds no second copy of them. */
  r.get('/options', (c) => c.json(taxProfileOptions()));

  r.get('/profile', async (c) => c.json(
    await getTaxProfile(db, c.env as Env, c.get('tenantId') as number, c.get('userId') as string),
  ));

  r.put('/profile', async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const profile = await saveTaxProfile(
      db, c.env as Env, c.get('tenantId') as number, c.get('userId') as string,
      readProfileBody(body),
    );
    // The response is the PROFILE, which by construction carries only the tax
    // id's last four — the submitted value is never echoed back.
    return c.json(profile);
  });

  r.get('/years', managerOnly, async (c) => c.json({
    years: await listTaxYears(db, c.env as Env, c.get('tenantId') as number),
  }));

  /** The CSV download. Registered BEFORE `/report/:year` so the literal
   *  `.csv` suffix cannot be swallowed by the JSON route's parameter. */
  r.get('/report/:year/csv', managerOnly, async (c) => {
    const year = Number(c.req.param('year'));
    // `onlyReportable=false` is the reconciliation view — every recipient,
    // including those under the threshold, with the audit reason for each.
    const onlyReportable = c.req.query('all') !== 'true';
    const report = await buildTaxYearReport(db, c.env as Env, c.get('tenantId') as number, year)
      .catch(() => null);
    if (!report) return c.json({ error: 'That is not a reportable tax year.' }, 400);

    const { contentType } = exportContentMeta('csv');
    return new Response(taxYearReportToCsv(report, { onlyReportable }), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${taxYearReportFilename(year, onlyReportable)}"`,
      },
    });
  });

  r.get('/report/:year', managerOnly, async (c) => {
    const year = Number(c.req.param('year'));
    const report = await buildTaxYearReport(db, c.env as Env, c.get('tenantId') as number, year)
      .catch(() => null);
    return report
      ? c.json(report)
      : c.json({ error: 'That is not a reportable tax year.' }, 400);
  });

  return r;
}
