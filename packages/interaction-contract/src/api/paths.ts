/** Insights API contract — paths (PRD 33). Re-exported by `../api.ts`; see its header. */
/**
 * Path table. API routers mount these; `replayApi.ts` calls them. `:x`
 * segments are filled by the client. All `/api/replay/*` reads take
 * `?site=<siteId>`.
 */
export const REPLAY_PATHS = {
  ingestConfig: '/api/replay-ingest/v1/config',
  ingestChunks: '/api/replay-ingest/v1/chunks',
  sites: '/api/replay/sites',
  site: '/api/replay/sites/:siteId',
  siteVerify: '/api/replay/sites/:siteId/verify',
  recordings: '/api/replay/recordings',
  recording: '/api/replay/recordings/:recordingId',
  recordingChunk: '/api/replay/recordings/:recordingId/chunks/:seq',
  releases: '/api/replay/releases',
  release: '/api/replay/releases/:releaseKey',
  kpis: '/api/replay/kpis',
  issues: '/api/replay/issues',
  issue: '/api/replay/issues/:issueId',
  live: '/api/replay/live',
  usage: '/api/replay/usage',
  heatGrid: '/api/replay/heatmap/grid',
  heatElements: '/api/replay/heatmap/elements',
  heatScroll: '/api/replay/heatmap/scroll',
  heatRoutes: '/api/replay/heatmap/routes',
  heatInsights: '/api/replay/heatmap/insights',
  heatSnapshot: '/api/replay/heatmap/snapshot',
  recordingExport: '/api/replay/recordings/:recordingId/export',
  exportStatus: '/api/replay/exports/:exportId',
  exportDownload: '/api/replay/exports/:exportId/download',
  projectSite: '/api/projects/:projectId/replay/site',
  capabilityState: '/api/capabilities/:slug/state',
  capabilityPacks: '/api/capabilities/session-replay/packs',
  capabilityPackCheckout: '/api/capabilities/session-replay/packs/:packId/checkout',
  opsSummary: '/api/admin/replay-ops/summary',
  // S4c analysis parity
  segments: '/api/replay/segments',
  segment: '/api/replay/segments/:segmentId',
  filterOptions: '/api/replay/filter-options',
  overview: '/api/replay/overview',
  smartEvents: '/api/replay/smart-events',
  smartEvent: '/api/replay/smart-events/:eventId',
  smartEventPreview: '/api/replay/smart-events/preview',
  funnels: '/api/replay/funnels',
  funnel: '/api/replay/funnels/:funnelId',
  funnelEvaluate: '/api/replay/funnels/:funnelId/evaluate',
  flow: '/api/replay/flow',
  /** POST. */
  recordingSummary: '/api/replay/recordings/:recordingId/summary',
  /** POST. */
  segmentSummary: '/api/replay/summary',
  // S4d method link
  /** GET — `ReplayTicketEffectDto` for a ticket raised from a replay moment. */
  ticketEffect: '/api/replay/ticket-effect/:taskId',
  /** POST, superadmin — seeds "The method" funnel + its four smart events on a site. */
  opsSeedMethodFunnel: '/api/admin/replay-ops/sites/:siteId/seed-method-funnel',
  // S4e prescriptions
  /** GET `?site&area&status&f.*` — `ReplayPrescriptionDto[]`, ranked. */
  prescriptions: '/api/replay/prescriptions',
  /** GET — one `ReplayPrescriptionDto`. */
  prescription: '/api/replay/prescriptions/:prescriptionId',
  /** POST — `:action` ∈ `REPLAY_PRESCRIPTION_ROUTE_ACTIONS`; body `ReplayPrescriptionActionInput`. */
  prescriptionAction: '/api/replay/prescriptions/:prescriptionId/:action',
  /** POST — "Find fixes now" (once an hour per site); `ReplayPrescriptionSweepResultDto`. */
  prescriptionSweep: '/api/replay/prescriptions/sweep',
  /** GET — `ReplayReleaseReportDto`. */
  releaseReport: '/api/replay/releases/:releaseKey/report',
} as const;
