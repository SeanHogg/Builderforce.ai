/** Executive use cases and the live domain evidence behind them — prepare a migrated use case, read a domain, sync the company profile, map competitors, refresh a live metric. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { C_SUITE_CANVAS_USE_CASES, C_SUITE_USE_CASE_IDS, cSuiteCanvasOwner, cSuiteCanvasWorkflow, resolveExecutiveUseCaseId } from '@/lib/templates/promptUseCases';
import { DOMAINS, getDomainItems, getDomainMetrics, getDomainSummary, getEntityRows, getScopeEntities, isDomain } from '@/lib/kernel/kernelApi';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { sanitizeCreationObjectPatch } from '../creationObjectRegistry';
import type { CreationNodeData } from '../types';
import { analyzeCompetitorGeography, competitorSitesFrom } from '@/lib/competitorGeo';
import { mapObjectFields } from '@/lib/canvasGeo';
import type { CanvasActionContext } from './context';

export function canvasExecutiveActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, fmt, inFlightUseCaseIdRef, persistence, stage, t } = ctx;
  return [{
    name: 'canvas_prepare_executive_use_case',
    description: 'Prepare one of the 48 migrated executive use cases for execution on this Canvas. Call this first when the prompt contains a legacy dotted use-case id. It returns the exact operation, completion condition, permitted existing Canvas outputs, and live evidence from the already-owning Builderforce domains. It never creates schema or mutates canonical domain data.',
    parameters: {
      type: 'object', required: ['useCaseId'], additionalProperties: false,
      properties: {
        useCaseId: { type: 'string', enum: C_SUITE_CANVAS_USE_CASES.map((item) => item.id) },
        days: { type: 'number', minimum: 1, maximum: 365 },
        limit: { type: 'number', minimum: 1, maximum: 100 },
      },
    },
    run: async (raw: unknown) => {
      const args = raw as { useCaseId?: unknown; days?: unknown; limit?: unknown };
      // Resolved tolerantly, and against the contract THIS TURN is running when
      // the args carry nothing usable — see `resolveExecutiveUseCaseId` for why
      // that is safe for this tool and not in general. A run died here on a
      // model typing `useCas1eId`, with the right value under the wrong key.
      const resolvedId = resolveExecutiveUseCaseId(raw, inFlightUseCaseIdRef.current);
      const useCase = C_SUITE_CANVAS_USE_CASES.find((candidate) => candidate.id === resolvedId);
      const workflow = useCase ? cSuiteCanvasWorkflow(useCase) : null;
      const owner = useCase ? cSuiteCanvasOwner(useCase) : null;
      if (!useCase || !workflow || !owner) {
        // The error names the way out. The dead-end version ("Unknown executive
        // Canvas use case.") told the model nothing it could act on, so it
        // stopped rather than retrying — the turn's real cause of death.
        return {
          error: 'Unknown executive Canvas use case.',
          hint: 'Call this again with `useCaseId` set to one of the listed ids, spelled exactly.',
          validUseCaseIds: [...C_SUITE_USE_CASE_IDS],
        };
      }
      const contract = {
        id: useCase.id,
        label: useCase.label,
        stages: owner.stages,
        operation: workflow.operation,
        evidence: workflow.evidence,
        domains: owner.domains,
        entityTerms: workflow.entityTerms,
        allowedOutputs: workflow.outputs,
        completion: workflow.completion,
        confirmTarget: workflow.confirmTarget === true,
        noNewTables: true,
        // ADVERTISED AND ENFORCED, from the same declaration. `canvas_add_object` and
        // `canvas_update_object` refuse this use case's own output kinds until these
        // have run, so the list below is what the turn must do rather than what it
        // ought to — see `ExecutiveCanvasWorkflow.requiredTools`.
        ...(workflow.requiredTools?.length ? {
          requiredTools: workflow.requiredTools,
          requiredToolsNote: `Call ${workflow.requiredTools.join(' and ')} BEFORE authoring the output. The canvas refuses to create ${workflow.outputs.join('/')} until it has run — every number on the card must be a measurement it returned, never one you inferred from the documents in context.`,
        } : {}),
      };
      if (workflow.evidence === 'web') return {
        contract,
        evidenceStatus: 'research_required',
        next: 'Use builtin_web_search and builtin_web_fetch, preserve source URLs in a dataset, then author only the allowed Canvas outputs.',
      };
      if (workflow.evidence === 'canvas') return {
        contract,
        evidenceStatus: 'canvas_snapshot_available',
        next: workflow.confirmTarget
          ? 'Read the selected target in full with canvas_read_object before changing it; preserve every field outside the requested change.'
          : 'Use the current Canvas snapshot and canvas_read_object/canvas_read_snapshot when more detail is needed.',
      };
      if (persistence !== 'server') return {
        contract,
        evidenceStatus: 'saved_session_required',
        error: 'This use case requires live tenant-scoped Builderforce domain data. Save or claim the Creation Canvas before executing it.',
      };
      const days = Math.max(1, Math.min(365, Math.floor(Number(args.days) || 30)));
      const limit = Math.max(1, Math.min(100, Math.floor(Number(args.limit) || 50)));
      const normalizedTerms = workflow.entityTerms.map((term) => term.toLocaleLowerCase().replaceAll('-', '_'));
      const domains = await Promise.all(owner.domains.map(async (domain) => {
        const [summary, entities, items, metrics] = await Promise.all([
          getDomainSummary(domain), getScopeEntities(domain), getDomainItems(domain, { limit }), getDomainMetrics(domain, days),
        ]);
        const matches = entities.filter((entity) => {
          const name = entity.name.toLocaleLowerCase();
          return entity.readable && normalizedTerms.some((term) => name.includes(term) || term.includes(name));
        }).sort((left, right) => right.count - left.count).slice(0, 4);
        const entityEvidence = await Promise.all(matches.map(async (entity) => {
          try {
            const page = await getEntityRows(domain, entity.name, { limit: Math.min(limit, 50) });
            return { entity, rows: page.rows, total: page.total };
          } catch (error) {
            return { entity, rows: [], total: entity.count, error: toolErrorMessage(error, 'Entity rows unavailable') };
          }
        }));
        return { domain, summary, matchedEntities: entityEvidence, items, metrics };
      }));
      return {
        contract,
        evidenceStatus: domains.some((domain) => domain.summary.itemCount > 0 || domain.metrics.length > 0 || domain.matchedEntities.some((entity) => entity.total > 0)) ? 'available' : 'empty',
        domains,
        instruction: 'Create or update an allowed Canvas output only from these rows, metrics and registered objects. State missing evidence inside the artifact; never fill it with example values.',
      };
    },
  },   {
    name: 'canvas_read_domain',
    description: 'Read real, tenant-scoped Builderforce domain data for an executive Canvas request. Use this before authoring a C-suite dashboard, report, chart, table, KPI, forecast, register, company view, or risk rollup. Returns the domain summary, registered entity catalog with row counts, recent objects, metric series, and—when entity is supplied—the selected entity rows. Never invent a value when this result has no supporting row or metric.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        domain: { type: 'string', enum: [...DOMAINS], description: 'Builderforce owner domain. Marketing maps to growth; agile maps to delivery; CRM maps to revenue; operations maps to people; product/company maps to investor or delivery according to the requested record.' },
        entity: { type: 'string', description: 'Optional entity name returned by the domain catalog, for example expenses, validation_dashboards, or people_employees.' },
        days: { type: 'number', minimum: 1, maximum: 365, description: 'Metric lookback window. Defaults to 30.' },
        limit: { type: 'number', minimum: 1, maximum: 200, description: 'Maximum recent objects or entity rows. Defaults to 50.' },
      },
      required: ['domain'],
    },
    run: async (raw: unknown) => {
      if (persistence !== 'server') return { error: 'Executive domain data requires a saved, authenticated Creation Canvas session.' };
      const args = raw as { domain?: unknown; entity?: unknown; days?: unknown; limit?: unknown };
      const domain = typeof args.domain === 'string' && isDomain(args.domain) ? args.domain : null;
      if (!domain) return { error: `Choose a supported domain: ${DOMAINS.join(', ')}` };
      const days = Math.max(1, Math.min(365, Math.floor(Number(args.days) || 30)));
      const limit = Math.max(1, Math.min(200, Math.floor(Number(args.limit) || 50)));
      const [summary, entities, items, metrics] = await Promise.all([
        getDomainSummary(domain), getScopeEntities(domain), getDomainItems(domain, { limit }), getDomainMetrics(domain, days),
      ]);
      const entity = typeof args.entity === 'string' ? args.entity.trim() : '';
      if (!entity) return { domain, summary, entities, items, metrics };
      const descriptor = entities.find((candidate) => candidate.name === entity);
      if (!descriptor) return { error: `Entity '${entity}' is not owned by ${domain}.`, domain, summary, entities, items, metrics };
      if (!descriptor.readable) return { error: `Entity '${entity}' is intentionally not available through the generic tenant reader.`, domain, summary, entity: descriptor, items, metrics };
      const page = await getEntityRows(domain, entity, { limit });
      return { domain, summary, entity: descriptor, rows: page.rows, total: page.total, items, metrics };
    },
  },   {
    // ── The founder objects ──────────────────────────────────────────────────
    //
    // "Use my existing business details" only means something if the details are
    // reachable. This writes the investor seat's `companies` row onto a `company`
    // object so the rest of the analysis is authored against the real business
    // rather than against whatever the user retyped into the prompt.
    //
    // It is a WRITE-TO-BOARD layered on the read `canvas_read_domain` already
    // performs — the relationship `canvas_add_diagnostic` has to `GET /api/tools`
    // — not a second way to read a tenant's company.
    name: 'canvas_sync_company_profile',
    description: 'Put the signed-in tenant\'s own business details on the canvas as a `company` object. Call this FIRST whenever the user says "my business", "our company", "my existing business details", or asks for analysis grounded in who they are. Creates the object when absent and refreshes it when present. If the tenant has no company record the result says so — author a `company` object with canvas_add_object from what the user tells you instead of inventing one.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'Existing company object to refresh. Omit to create one.' },
        x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: () => true,
    run: async (raw: unknown) => {
      if (persistence !== 'server') {
        return { error: 'Reading your saved business details needs a signed-in Creation Canvas session. Ask the user for the company name, sector, stage and markets served, then author a `company` object with canvas_add_object — do not invent them.' };
      }
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; x?: number; y?: number };
      const page = await getEntityRows('investor', 'companies', { limit: 25 });
      // The tenant's OWN business is the portfolio-flagged row if one is marked, else the
      // only row. Several unflagged rows is genuinely ambiguous — a CRM's worth of
      // companies is the normal state of that table — so it asks rather than guessing,
      // because picking a customer's company as "your business" poisons every downstream
      // object in the analysis.
      const rows = page.rows as Array<Record<string, unknown>>;
      if (!rows.length) {
        return { companyFound: false, reason: 'no-company-record', instruction: 'This tenant has no company record. Ask the user for their business details and author a `company` object with canvas_add_object. Never invent them.' };
      }
      const owned = rows.filter((row) => row.isPortfolio !== true);
      const candidates = owned.length ? owned : rows;
      const row = candidates.length === 1 ? candidates[0] : null;
      if (!row) {
        return {
          companyFound: false, reason: 'ambiguous',
          companies: candidates.slice(0, 20).map((candidate) => ({ id: candidate.id, name: candidate.name })),
          instruction: 'Several companies are on this tenant. Ask the user which one is their own business before authoring anything against it.',
        };
      }
      const fields: Record<string, unknown> = {
        title: String(row.name ?? 'Company'),
        status: String(row.stage ?? 'Active'),
        ...(row.name ? { legalName: String(row.name) } : {}),
        ...(row.sector ? { sector: String(row.sector) } : {}),
        ...(row.stage ? { stage: String(row.stage) } : {}),
        ...(row.website ? { website: String(row.website) } : {}),
        ...(row.headcount != null ? { headcount: String(row.headcount) } : {}),
        ...(row.arr != null ? { arr: `${row.arr}${row.currency ? ` ${row.currency}` : ''}` } : {}),
        ...(row.country ? { geography: [String(row.country)] } : {}),
        summary: `Synced from the investor seat's company record on ${new Date().toISOString().slice(0, 10)}.`,
      };
      const patch = sanitizeCreationObjectPatch('company', fields);
      const existing = args.objectId
        ? stage.nodes().find((node) => node.id === args.objectId)
        : stage.nodes().find((node) => node.data.kind === 'company');
      if (existing) {
        stage.updateObject(t('founderCompanySynced', { title: String(fields.title) }), existing.id, patch);
        return { ok: true, proposed: true, companyFound: true, object: { id: existing.id, kind: 'company', title: fields.title, updated: true } };
      }
      const node = stage.createObject('company', args);
      node.data = { ...node.data, ...patch } as CreationNodeData;
      stage.addObject(t('founderCompanySynced', { title: String(fields.title) }), node);
      return { ok: true, proposed: true, companyFound: true, object: { id: node.id, kind: 'company', title: fields.title } };
    },
  },   {
    // Turns the competitor objects on the board into a real geographic analysis: a
    // `map` object built through the SAME `mapObjectFields` every other plot uses,
    // plus the density and coverage-gap tables that are the actual deliverable.
    name: 'canvas_map_competitors',
    description: 'Plot every `competitor` object on this canvas onto a map and analyse the geography: competitor density by metro, and the metros in the market with NO competitor presence. Call this after researching competitors and writing their `locations` (each with lat/lng from builtin_geo_geocode). Returns the coverage gaps — the white space — which is the part of a geographic market analysis a founder is actually buying. Competitors whose locations have no coordinates are named in the result so you can say which rival is missing geography rather than quietly plotting fewer.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        market: { type: 'string', description: 'The market being analysed, e.g. "Florida". Drives which reference metros coverage gaps are measured against.' },
        title: { type: 'string', description: 'Title for the map object.' },
        coverageRadiusMiles: { type: 'number', minimum: 1, maximum: 500, description: 'How close a competitor site must be to count as covering a metro. Defaults to 40.' },
        x: { type: 'number' }, y: { type: 'number' },
      },
      required: ['market'],
    },
    mutates: () => true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { market?: string; title?: string; coverageRadiusMiles?: number; x?: number; y?: number };
      const market = typeof args.market === 'string' ? args.market.trim() : '';
      if (!market) return { error: 'Pass the market being analysed, e.g. "Florida".' };
      const competitorNodes = stage.nodes().filter((node) => node.data.kind === 'competitor');
      if (!competitorNodes.length) {
        return { error: 'No competitor objects are on this canvas yet. Research the market with builtin_web_search, resolve each site with builtin_geo_geocode, then create one `competitor` object per rival with canvas_add_object before mapping.' };
      }
      const analysis = analyzeCompetitorGeography({
        sites: competitorNodes.flatMap((node) => competitorSitesFrom(node.data.title, node.data.locations)),
        allCompetitors: competitorNodes.map((node) => node.data.title),
        market,
        ...(typeof args.coverageRadiusMiles === 'number' ? { coverageRadiusMiles: args.coverageRadiusMiles } : {}),
      });
      if (!analysis.points.length) {
        return {
          error: `None of the ${competitorNodes.length} competitor object(s) on this canvas has a location with usable lat/lng. Resolve each competitor's city with builtin_geo_geocode and write the coordinates back with canvas_update_object into locations: [{name, city, region, lat, lng}], then call this again.`,
          unmappedCompetitors: analysis.unmappedCompetitors,
        };
      }
      const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 160) : `${market} competitor landscape`;
      const gapSummary = analysis.marketKnown
        ? analysis.gaps.length
          ? `${analysis.gaps.length} metro(s) with no competitor within the coverage radius: ${analysis.gaps.slice(0, 5).map((gap) => gap.metro).join(', ')}.`
          : 'Every reference metro in this market has a competitor inside the coverage radius.'
        : `No reference metros are known for "${market}", so competitor density is clustered by stated city and no coverage gaps are computed.`;
      const fields = mapObjectFields({
        title,
        status: t('founderCompetitorMapStatus', { count: analysis.points.length }),
        summary: `${analysis.mappedCompetitors.length} competitor(s) plotted across ${analysis.clusters.length} area(s). ${gapSummary}`,
        points: analysis.points,
        columns: { latitude: 'lat', longitude: 'lng', label: 'competitor', value: null },
        sourceDatasetId: '',
        ...(analysis.region ? { region: analysis.region } : {}),
        regionName: market,
      });
      const patch = sanitizeCreationObjectPatch('map', fields);
      const node = stage.createObject('map', args);
      node.data = { ...node.data, ...patch } as CreationNodeData;
      stage.addObject(t('founderCompetitorMapProposal', { title }), node);
      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'map', title },
        market,
        marketKnown: analysis.marketKnown,
        clusters: analysis.clusters,
        coverageGaps: analysis.gaps,
        mappedCompetitors: analysis.mappedCompetitors,
        unmappedCompetitors: analysis.unmappedCompetitors,
        instruction: 'Report the coverage gaps as the finding. Where a gap exists, say which competitor is nearest and how far, so the user can judge whether it is genuinely uncontested or merely underserved. Never describe an unmapped competitor as absent from a region — it has no coordinates, which is not the same thing.',
      };
    },
  },   {
    // The LIVE half. See the `liveMetric` note in the contract.
    name: 'canvas_refresh_live_metric',
    description: 'Re-read the domain metric a `liveMetric` object is bound to, and write the current value, trend and series onto it. Use this instead of authoring a number by hand whenever the board already carries a bound metric — a runway, burn, pipeline or lead figure typed into a card is wrong the next morning and cannot be asked again. Available metric keys come from the domain manifest; bind with the `binding` field, e.g. "finance.runway_months".',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The liveMetric object to refresh. Omit when exactly one is on the board.' },
        binding: { type: 'string', description: 'Override or set the binding, e.g. "finance.runway_months", "revenue.pipeline", "growth.leads".' },
        days: { type: 'number', minimum: 1, maximum: 365, description: 'Lookback window for the series. Defaults to 30.' },
      },
    },
    mutates: () => true,
    run: async (raw: unknown) => {
      if (persistence !== 'server') return { error: 'Live metrics read tenant domain data, which needs a signed-in, saved Creation Canvas session.' };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; binding?: string; days?: number };
      const candidates = stage.nodes().filter((node) => node.data.kind === 'liveMetric');
      const target = args.objectId ? candidates.find((node) => node.id === args.objectId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!target) {
        return { error: candidates.length
          ? `Specify which live metric to refresh. On this canvas: ${candidates.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No liveMetric object is on this canvas. Create one with canvas_add_object and set its `binding` to a domain metric key.' };
      }
      const binding = (typeof args.binding === 'string' && args.binding.trim() ? args.binding : String(target.data.binding ?? '')).trim();
      const [domainPart] = binding.split('.');
      if (!binding || !domainPart || !isDomain(domainPart)) {
        return { error: `"${binding || '(unset)'}" is not a bound domain metric. Use "<domain>.<metric>" where domain is one of: ${DOMAINS.join(', ')}. Read the available metric keys for a domain with canvas_read_domain.` };
      }
      const days = Math.max(1, Math.min(365, Math.floor(Number(args.days) || 30)));
      const series = await getDomainMetrics(domainPart, days);
      const match = series.find((entry) => entry.metric === binding);
      if (!match) {
        return {
          error: `The ${domainPart} domain does not report "${binding}" over the last ${days} days. Metrics it does report: ${series.map((entry) => entry.metric).join(', ') || '(none yet)'}.`,
          availableMetrics: series.map((entry) => entry.metric),
        };
      }
      const points = match.points.slice(-90);
      const latest = points.at(-1) ?? null;
      if (!latest) {
        return { error: `"${binding}" has no observations in the last ${days} days, so there is no value to write. Say so rather than reporting a zero.` };
      }
      const first = points[0];
      const delta = points.length > 1 ? latest.value - first.value : null;
      const fields: Record<string, unknown> = {
        status: t('founderMetricLive'),
        value: fmt.number(latest.value),
        binding,
        ...(match.unit ? { unit: match.unit } : {}),
        ...(delta != null ? { trend: `${delta >= 0 ? '+' : ''}${fmt.number(delta)} vs ${days}d ago` } : {}),
        series: points.map((point) => ({ at: point.at, value: point.value })),
        fetchedAt: new Date().toISOString(),
      };
      const patch = sanitizeCreationObjectPatch('liveMetric', fields);
      stage.updateObject(t('founderMetricRefreshed', { title: target.data.title }), target.id, patch);
      return {
        ok: true, proposed: true,
        object: { id: target.id, kind: 'liveMetric', title: target.data.title },
        binding, value: latest.value, unit: match.unit, observedAt: latest.at, pointCount: points.length,
        instruction: 'This value was read from the tenant\'s own domain data just now. Report it with its as-of instant. If a trigger on this board watches this metric, call canvas_evaluate_triggers so a breach is reported in the same turn.',
      };
    },
  }];
}
