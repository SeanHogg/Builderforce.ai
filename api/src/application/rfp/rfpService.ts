/**
 * RFP Response orchestration (PRD 15).
 *
 * `generateRfpResponse` composes a co-branded pre-sales proposal from real platform
 * data — it does NOT free-hand the facts:
 *   1. Freshness gate (existing-project mode): if the project's newest diagnostics scan
 *      is missing or > 5 days old, re-run the deterministic system audits FIRST (a real
 *      repo code scan + feature mapping) so the capability roster is grounded, then read
 *      the roster from the architecture artifacts (rich) or the audit signals (fallback).
 *   2. Portfolio match: rank the tenant's other projects against the requirements so the
 *      response can lean on the closest existing build.
 *   3. P&L: build-out (effort × blended member rate) + agentic cost (forward estimate
 *      grounded on the project's historical LLM spend) + marketing + contingency + margin.
 *   4. Narrative: a CTO- and Product-Owner-steered `ideProxy` call writes the executive
 *      summary, phase/milestone plan, risks and dependencies (deterministic fallback).
 *   5. Branding: blend the requesting org's palette with the responder tenant's, render a
 *      self-contained branded document.
 *
 * Every external call is best-effort: a failure degrades to a deterministic path rather
 * than blocking the proposal.
 */
import { and, eq, desc, sql as dsql, inArray } from 'drizzle-orm';
import type { neon } from '@neondatabase/serverless';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { ToolService } from '../tools/ToolService';
import type { AuditRunner } from '../tools/AuditRunner';
import { listSystemAudits } from '../tools/systemAudits';
import {
  rfpRequests, rfpResponses, projects, tenants, llmUsageLog, memberProfiles, repoAnalysisArtifacts,
} from '../../infrastructure/database/schema';
import { ideProxy, readProxyChoice } from '../llm/LlmProxyService';
import { recordProxyUsage } from '../llm/usageLedger';
import { findBuiltinAgentRef, personaDirectiveFor } from './rfpAgents';
import { computeRfpCostModel, RFP_COST_DEFAULTS } from './rfpCost';
import {
  blendPalettes, normalizePalette, renderRfpDocHtml, DEFAULT_TENANT_PALETTE, DEFAULT_REQUESTER_PALETTE,
} from './rfpBranding';
import type {
  RfpResponseBody, RfpCapabilityRoster, RfpPhase, RfpNarrative, RfpPortfolioMatch, RfpScanFreshness, BrandPalette,
} from './types';

type Sql = ReturnType<typeof neon<false, false>>;

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const MILLICENTS_PER_USD = 100_000;

export interface RfpGenerateDeps {
  env: Env;
  db: Db;
  toolService: ToolService;
  auditRunner: AuditRunner;
  sql: Sql;
  secret: string;
}

// ── date helpers (server runtime — Date is available here) ────────────────────
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d;
}

// ── capability roster ─────────────────────────────────────────────────────────

/** Read the richest available capability facts for a project from the architecture
 *  analysis artifacts (business + diagnostic). Null when none exist yet. */
async function readArchitectureRoster(db: Db, tenantId: number, projectId: number): Promise<RfpCapabilityRoster | null> {
  try {
    const rows = await db
      .select({ kind: repoAnalysisArtifacts.kind, dataJson: repoAnalysisArtifacts.dataJson, createdAt: repoAnalysisArtifacts.createdAt })
      .from(repoAnalysisArtifacts)
      .where(and(
        eq(repoAnalysisArtifacts.tenantId, tenantId),
        eq(repoAnalysisArtifacts.projectId, projectId),
        inArray(repoAnalysisArtifacts.kind, ['business', 'diagnostic']),
      ))
      .orderBy(desc(repoAnalysisArtifacts.createdAt))
      .limit(20);

    const latest = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      if (latest.has(r.kind) || !r.dataJson) continue;
      try { latest.set(r.kind, JSON.parse(r.dataJson) as Record<string, unknown>); } catch { /* skip */ }
    }
    const business = latest.get('business');
    const diagnostic = latest.get('diagnostic');
    if (!business && !diagnostic) return null;

    const asStrings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 24) : [];
    const components = Array.isArray(diagnostic?.keyComponents)
      ? (diagnostic!.keyComponents as unknown[])
          .filter((k): k is { name: string; responsibility: string } => !!k && typeof k === 'object')
          .map((k) => ({ name: String((k as Record<string, unknown>).name ?? ''), responsibility: String((k as Record<string, unknown>).responsibility ?? '') }))
          .filter((k) => k.name)
          .slice(0, 24)
      : [];

    return {
      capabilities: asStrings(business?.capabilities),
      valueProps: asStrings(business?.valueProps),
      keyComponents: components,
      frameworks: asStrings(diagnostic?.frameworks),
      primaryLanguages: asStrings(diagnostic?.primaryLanguages),
      source: 'diagnostics',
    };
  } catch {
    return null;
  }
}

/** An empty audit-sourced roster — the fallback when a project has diagnostics but no
 *  architecture artifacts yet (the deterministic audits refresh the score, not a feature
 *  list). The narrative still grounds on the requirements. */
function rosterFromAuditMetrics(): RfpCapabilityRoster {
  return {
    capabilities: [],
    valueProps: [],
    keyComponents: [],
    frameworks: [],
    primaryLanguages: [],
    source: 'audit',
  };
}

// ── freshness gate ────────────────────────────────────────────────────────────

/**
 * Ensure a project's diagnostics are fresh (≤ 5 days). Reads the newest diagnostic
 * timestamp; if stale/missing, re-runs the deterministic system audits (a real repo
 * code scan + feature mapping) so the roster is grounded. Best-effort — never throws.
 */
async function ensureFreshScan(
  deps: RfpGenerateDeps,
  tenantId: number,
  projectId: number,
  userId: string,
): Promise<{ freshness: RfpScanFreshness; refreshed: boolean }> {
  const now = Date.now();
  let lastScanAt: string | null = null;
  try {
    const score = await deps.toolService.getProjectScore(deps.env, tenantId, projectId);
    for (const d of score.diagnostics) {
      if (!lastScanAt || d.createdAt > lastScanAt) lastScanAt = d.createdAt;
    }
  } catch { /* no prior scans */ }

  const ageMs = lastScanAt ? now - new Date(lastScanAt).getTime() : null;
  const ageDays = ageMs == null ? null : Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const stale = ageMs == null || ageMs > FIVE_DAYS_MS;

  let refreshed = false;
  if (stale) {
    // Re-run every system audit against the project (each is deterministic + instant:
    // a server-side repo file-tree read → feature signals → a fresh tool_runs row).
    for (const audit of listSystemAudits()) {
      try {
        await deps.auditRunner.runAudit(deps.env, deps.sql, {
          tenantId, projectId, auditId: audit.id, userId, secret: deps.secret,
        });
        refreshed = true;
      } catch { /* one audit failing must not block the proposal */ }
    }
  }

  return {
    freshness: {
      toolId: 'architecture-analysis',
      lastScanAt: refreshed ? isoDate(new Date(now)) : lastScanAt,
      ageDays: refreshed ? 0 : ageDays,
      refreshed,
    },
    refreshed,
  };
}

// ── portfolio match ───────────────────────────────────────────────────────────

/**
 * Rank a tenant's projects against an RFP's requirements so a response can lean on the
 * closest existing build. LLM-ranked (structured) with a keyword-overlap fallback.
 */
export async function matchPortfolio(
  env: Env,
  db: Db,
  tenantId: number,
  requirements: string,
  excludeProjectId?: number | null,
): Promise<RfpPortfolioMatch[]> {
  const rows = await db
    .select({ id: projects.id, name: projects.name, description: projects.description })
    .from(projects)
    .where(eq(projects.tenantId, tenantId))
    .limit(200);
  const candidates = rows.filter((r) => r.id !== excludeProjectId);
  if (candidates.length === 0) return [];

  // Keyword fallback score (also the ordering seed the model refines).
  const terms = new Set((requirements.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).slice(0, 60));
  const keywordScore = (text: string): number => {
    if (terms.size === 0) return 0;
    const hay = text.toLowerCase();
    let hits = 0;
    for (const t of terms) if (hay.includes(t)) hits++;
    return hits / terms.size;
  };
  const seeded = candidates
    .map((c) => ({ projectId: c.id, name: c.name, score: keywordScore(`${c.name} ${c.description ?? ''}`), rationale: 'Keyword overlap with the requirements.' }))
    .sort((a, b) => b.score - a.score);

  try {
    const list = candidates.slice(0, 40).map((c) => `#${c.id} ${c.name}: ${(c.description ?? '').slice(0, 200)}`).join('\n');
    const result = await ideProxy(env).complete({
      messages: [
        { role: 'system', content: 'You match an RFP to the most similar existing projects in a portfolio. Return the top matches (max 5) with a 0-1 similarity score and a <=16-word rationale. JSON only.' },
        { role: 'user', content: `RFP requirements:\n${requirements.slice(0, 2000)}\n\nPortfolio projects:\n${list}` },
      ],
      temperature: 0,
      max_tokens: 500,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'portfolio_matches', strict: true,
          schema: {
            type: 'object', additionalProperties: false, required: ['matches'],
            properties: {
              matches: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false, required: ['projectId', 'score', 'rationale'],
                  properties: {
                    projectId: { type: 'number' },
                    score: { type: 'number', minimum: 0, maximum: 1 },
                    rationale: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      useCase: 'rfp_portfolio_match',
    });
    void recordProxyUsage(db, env, { tenantId, useCase: 'rfp_portfolio_match', result });
    if (result.response.status < 400) {
      const { content } = await readProxyChoice(result);
      const parsed = JSON.parse(content) as { matches?: RfpPortfolioMatch[] };
      const validIds = new Set(candidates.map((c) => c.id));
      const nameById = new Map(candidates.map((c) => [c.id, c.name]));
      const matches = (parsed.matches ?? [])
        .filter((m) => validIds.has(Number(m.projectId)))
        .map((m) => ({ projectId: Number(m.projectId), name: nameById.get(Number(m.projectId)) ?? '', score: Math.min(Math.max(Number(m.score) || 0, 0), 1), rationale: String(m.rationale ?? '').slice(0, 160) }))
        .slice(0, 5);
      if (matches.length) return matches;
    }
  } catch { /* fall through to keyword ranking */ }

  return seeded.filter((s) => s.score > 0).slice(0, 5);
}

// ── cost basis ────────────────────────────────────────────────────────────────

/** Blended weekly build rate (USD) from the tenant's member cost rates, or the default. */
async function blendedWeeklyRateUsd(db: Db, tenantId: number): Promise<number> {
  try {
    const [row] = await db
      .select({ avgCents: dsql<number>`avg(${memberProfiles.costRateUsdCents})` })
      .from(memberProfiles)
      .where(eq(memberProfiles.tenantId, tenantId));
    const centsPerHour = Number(row?.avgCents);
    if (Number.isFinite(centsPerHour) && centsPerHour > 0) {
      return Math.round((centsPerHour / 100) * 40); // 40h week
    }
  } catch { /* default below */ }
  return RFP_COST_DEFAULTS.blendedWeeklyRateUsd;
}

/** Forward agentic-cost estimate (USD): grounded on the project's historical LLM spend,
 *  floored to a per-week minimum so greenfield/quiet projects still carry an AI cost. */
async function estimateAgenticCostUsd(db: Db, tenantId: number, projectId: number | null, effortWeeks: number): Promise<number> {
  let historicalUsd = 0;
  if (projectId != null) {
    try {
      const [row] = await db
        .select({ total: dsql<number>`coalesce(sum(${llmUsageLog.costUsdMillicents}),0)` })
        .from(llmUsageLog)
        .where(and(eq(llmUsageLog.tenantId, tenantId), eq(llmUsageLog.projectId, projectId)));
      historicalUsd = (Number(row?.total) || 0) / MILLICENTS_PER_USD;
    } catch { /* default below */ }
  }
  const floor = effortWeeks * 200; // a build of this size will burn at least this in agentic spend
  return Math.round(Math.max(historicalUsd, floor));
}

// ── narrative (LLM, persona-steered) ──────────────────────────────────────────

interface RawNarrative {
  executiveSummary: string;
  phases: { name: string; weeks: number; milestones: { name: string; offsetWeeks: number }[] }[];
  risks: { title: string; severity: 'low' | 'medium' | 'high'; mitigation: string }[];
  dependencies: { title: string; type: 'internal' | 'external' | 'third_party'; note: string }[];
}

function fallbackNarrative(requesterOrg: string, roster: RfpCapabilityRoster): RawNarrative {
  const focus = roster.capabilities[0] ?? roster.valueProps[0] ?? 'the requested solution';
  return {
    executiveSummary: `We propose to deliver ${focus} for ${requesterOrg || 'your organisation'}, drawing on our proven delivery approach. The engagement is phased to de-risk delivery, with clear milestones, a fixed commercial envelope, and joint governance throughout.`,
    phases: [
      { name: 'Discovery & alignment', weeks: 2, milestones: [{ name: 'Requirements sign-off', offsetWeeks: 2 }] },
      { name: 'Design', weeks: 3, milestones: [{ name: 'Solution design approved', offsetWeeks: 3 }] },
      { name: 'Build & integrate', weeks: 8, milestones: [{ name: 'Feature-complete', offsetWeeks: 8 }] },
      { name: 'Hardening & UAT', weeks: 3, milestones: [{ name: 'UAT passed', offsetWeeks: 3 }] },
      { name: 'Launch & handover', weeks: 1, milestones: [{ name: 'Go-live', offsetWeeks: 1 }] },
    ],
    risks: [
      { title: 'Scope ambiguity in requirements', severity: 'medium', mitigation: 'Fixed discovery phase with written sign-off before build.' },
      { title: 'Third-party integration availability', severity: 'medium', mitigation: 'Early integration spikes and sandbox access in phase 1.' },
      { title: 'Stakeholder availability for UAT', severity: 'low', mitigation: 'UAT windows agreed and calendared at kickoff.' },
    ],
    dependencies: [
      { title: 'Access to systems & test data', type: 'external', note: 'Provided by the client at kickoff.' },
      { title: 'Third-party API credentials', type: 'third_party', note: 'Required before integration phase.' },
    ],
  };
}

async function generateNarrative(
  deps: RfpGenerateDeps,
  tenantId: number,
  requesterOrg: string,
  requirements: string,
  roster: RfpCapabilityRoster,
  personaDirective: string,
): Promise<RawNarrative> {
  const fallback = fallbackNarrative(requesterOrg, roster);
  try {
    const capsLine = roster.capabilities.length ? `Our relevant capabilities: ${roster.capabilities.join(', ')}.` : '';
    const result = await ideProxy(deps.env).complete({
      messages: [
        {
          role: 'system',
          content:
            'You are co-authoring a pre-sales RFP response as a CTO and a Product Owner. Produce a concise executive summary (<=120 words), a phased delivery plan (each phase has a name, a duration in weeks, and milestones with an offset in weeks from the phase start), the key delivery risks (severity low|medium|high + a mitigation), and the external/third-party dependencies. Ground everything in the requirements and our stated capabilities — no invented product features. JSON only.\n\n' +
            personaDirective,
        },
        { role: 'user', content: `Requesting organisation: ${requesterOrg || 'the client'}\n\nRFP requirements:\n${requirements.slice(0, 4000)}\n\n${capsLine}` },
      ],
      temperature: 0.3,
      max_tokens: 1200,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'rfp_narrative', strict: true,
          schema: {
            type: 'object', additionalProperties: false,
            required: ['executiveSummary', 'phases', 'risks', 'dependencies'],
            properties: {
              executiveSummary: { type: 'string' },
              phases: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false, required: ['name', 'weeks', 'milestones'],
                  properties: {
                    name: { type: 'string' }, weeks: { type: 'number', minimum: 1, maximum: 52 },
                    milestones: {
                      type: 'array',
                      items: { type: 'object', additionalProperties: false, required: ['name', 'offsetWeeks'], properties: { name: { type: 'string' }, offsetWeeks: { type: 'number', minimum: 0, maximum: 104 } } },
                    },
                  },
                },
              },
              risks: {
                type: 'array',
                items: { type: 'object', additionalProperties: false, required: ['title', 'severity', 'mitigation'], properties: { title: { type: 'string' }, severity: { type: 'string', enum: ['low', 'medium', 'high'] }, mitigation: { type: 'string' } } },
              },
              dependencies: {
                type: 'array',
                items: { type: 'object', additionalProperties: false, required: ['title', 'type', 'note'], properties: { title: { type: 'string' }, type: { type: 'string', enum: ['internal', 'external', 'third_party'] }, note: { type: 'string' } } },
              },
            },
          },
        },
      },
      useCase: 'rfp_narrative',
    });
    void recordProxyUsage(deps.db, deps.env, { tenantId, useCase: 'rfp_narrative', result });
    if (result.response.status >= 400) return fallback;
    const { content } = await readProxyChoice(result);
    if (!content) return fallback;
    const parsed = JSON.parse(content) as RawNarrative;
    if (!parsed.executiveSummary || !Array.isArray(parsed.phases) || parsed.phases.length === 0) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

/** Schedule the raw (week-relative) phases onto absolute dates from a start date. */
function schedulePhases(raw: RawNarrative['phases'], start: Date): { phases: RfpPhase[]; weeks: number; end: Date } {
  let cursor = new Date(start.getTime());
  const phases: RfpPhase[] = [];
  for (const p of raw) {
    const weeks = Math.max(1, Math.round(Number(p.weeks) || 1));
    const phaseStart = new Date(cursor.getTime());
    const phaseEnd = addDays(phaseStart, weeks * 7);
    phases.push({
      name: p.name,
      startDate: isoDate(phaseStart),
      endDate: isoDate(phaseEnd),
      milestones: (p.milestones ?? []).map((m) => ({ name: m.name, date: isoDate(addDays(phaseStart, (Number(m.offsetWeeks) || 0) * 7)) })),
    });
    cursor = phaseEnd;
  }
  const totalWeeks = raw.reduce((s, p) => s + Math.max(1, Math.round(Number(p.weeks) || 1)), 0);
  return { phases, weeks: totalWeeks, end: cursor };
}

// ── orchestration ─────────────────────────────────────────────────────────────

export interface GenerateResult {
  responseId: string;
  body: RfpResponseBody;
  quotedPriceUsdCents: number;
  marginPct: number;
  scanRefreshed: boolean;
  generatedBy: { cto: string | null; productOwner: string | null };
  docHtml: string;
}

export async function generateRfpResponse(
  deps: RfpGenerateDeps,
  args: { tenantId: number; requestId: string; userId: string },
): Promise<GenerateResult | null> {
  const { db, env } = deps;
  const { tenantId, requestId, userId } = args;

  const [request] = await db
    .select()
    .from(rfpRequests)
    .where(and(eq(rfpRequests.id, requestId), eq(rfpRequests.tenantId, tenantId)))
    .limit(1);
  if (!request) return null;

  const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const tenantName = tenant?.name ?? 'Our team';

  // Palettes: requester from the request, tenant from a stored default.
  const requesterPalette: BrandPalette = normalizePalette(request.requesterBrand, DEFAULT_REQUESTER_PALETTE);
  const tenantPalette: BrandPalette = normalizePalette(null, DEFAULT_TENANT_PALETTE);
  const blended = blendPalettes(requesterPalette, tenantPalette);

  const isExisting = request.sourceMode === 'existing_project' && request.basedOnProjectId != null;
  const projectId = isExisting ? (request.basedOnProjectId as number) : null;

  // 1. Grounding + freshness gate.
  let roster: RfpCapabilityRoster;
  let scanFreshness: RfpScanFreshness | undefined;
  let scanRefreshed = false;
  let projectName: string | undefined;

  if (isExisting && projectId != null) {
    const [proj] = await db.select({ name: projects.name, description: projects.description }).from(projects).where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId))).limit(1);
    projectName = proj?.name;
    const gate = await ensureFreshScan(deps, tenantId, projectId, userId);
    scanFreshness = gate.freshness;
    scanRefreshed = gate.refreshed;
    roster = (await readArchitectureRoster(db, tenantId, projectId))
      ?? rosterFromAuditMetrics();
  } else {
    roster = { capabilities: [], valueProps: [], keyComponents: [], frameworks: [], primaryLanguages: [], source: 'greenfield' };
  }

  // 2. Portfolio match (always useful; excludes the grounding project).
  const requirements = request.requirements ?? '';
  const portfolioMatches = await matchPortfolio(env, db, tenantId, requirements, projectId);

  // 3. Persona-steered narrative (CTO + Product Owner).
  const [cto, productOwner] = await Promise.all([
    findBuiltinAgentRef(db, tenantId, 'cto'),
    findBuiltinAgentRef(db, tenantId, 'product_owner'),
  ]);
  const personaDirective = [personaDirectiveFor(cto), personaDirectiveFor(productOwner)].filter(Boolean).join('\n');
  const raw = await generateNarrative(deps, tenantId, request.requesterOrgName ?? '', requirements, roster, personaDirective);

  // 4. Schedule phases + timeline.
  const start = new Date();
  const { phases, weeks, end } = schedulePhases(raw.phases, start);
  const effortWeeks = Math.max(1, weeks);

  // 5. P&L.
  const [weeklyRate, agenticCostUsd] = await Promise.all([
    blendedWeeklyRateUsd(db, tenantId),
    estimateAgenticCostUsd(db, tenantId, projectId, effortWeeks),
  ]);
  const costModel = computeRfpCostModel({
    effortWeeks,
    blendedWeeklyRateUsd: weeklyRate,
    agenticCostUsd,
    marginPct: request.marginPct ?? undefined,
    marketingPct: request.marketingPct ?? undefined,
    contingencyPct: request.contingencyPct ?? undefined,
  });

  // 6. Assemble the body.
  const body: RfpResponseBody = {
    executiveSummary: raw.executiveSummary,
    grounding: {
      mode: isExisting ? 'existing' : 'new',
      projectId: projectId ?? undefined,
      projectName,
      scanFreshness,
    },
    capabilityRoster: roster,
    costModel,
    plan: { phases },
    risks: raw.risks ?? [],
    dependencies: raw.dependencies ?? [],
    timeline: { startDate: isoDate(start), endDate: isoDate(end), weeks: effortWeeks },
    branding: { requester: requesterPalette, tenant: tenantPalette, blended },
    portfolioMatches,
  };

  // 7. Render branded doc.
  const docHtml = renderRfpDocHtml({
    title: request.title,
    requesterOrgName: request.requesterOrgName ?? '',
    tenantName,
    body,
    generatedAtIso: isoDate(start),
  });

  const quotedPriceUsdCents = Math.round(costModel.quotedPriceUsd * 100);
  const generatedBy = { cto: cto?.id ?? null, productOwner: productOwner?.id ?? null };

  // 8. Persist.
  const [row] = await db.insert(rfpResponses).values({
    tenantId,
    segmentId: request.segmentId ?? null,
    requestId,
    projectId: projectId ?? null,
    status: 'ready',
    body,
    docHtml,
    quotedPriceUsdCents,
    marginPct: costModel.marginPct,
    scanRefreshed,
    generatedBy,
    createdBy: userId,
  }).returning({ id: rfpResponses.id });

  // Mark the request ready.
  await db.update(rfpRequests).set({ status: 'ready', updatedAt: new Date() }).where(and(eq(rfpRequests.id, requestId), eq(rfpRequests.tenantId, tenantId)));

  return {
    responseId: row!.id,
    body,
    quotedPriceUsdCents,
    marginPct: costModel.marginPct,
    scanRefreshed,
    generatedBy,
    docHtml,
  };
}
