/**
 * The hand-typed mutable fields of every kind that is NOT spec-driven — split out of
 * `creationObjectRegistry.ts` so the registry stops being the file every new field edits.
 * Spec-driven vocabularies derive theirs from their one declaration and are spread in
 * by the registry's `MUTABLE_FIELDS`; the `satisfies` below is the exhaustiveness check.
 */

import type { CreationObjectKind } from './types';
import type { AcademicObjectKind, CareerObjectKind, DataScienceObjectKind, FounderObjectKind, HiringObjectKind, LegalObjectKind, MarketingObjectKind, OperationsObjectKind, PeopleObjectKind, SellMotionObjectKind, SharedObjectKind } from '@builderforce/creation-canvas-contract';
import type { DataArchitectureKind } from '@/lib/dataArchitectureObjects';

export const BASE_MUTABLE_FIELDS = {
  // NOT `steps`. Brain authored a free-form step list here while a server-side
  // compiler existed to lower it. That compiler is gone, so a list written onto a card
  // with no editor would be an instruction with no surface — Brain authors `flowStep`
  // objects instead (below), which is what "add a switch on status" should have drawn
  // all along. The two controls stay writable because a legacy card carries them onto
  // the frame when it is opened.
  workflow: ['content', 'approvalMode', 'runTarget'],
  // The step itself, its typed config, and the two declared data contracts the
  // compiler lowers into real nodes. Brain authors all five: "add a switch on
  // status" is a patch, not a modal. See `flowStepObject.ts` for each shape.
  // `content` is the same free-text note every other kind accepts, read generically
  // off `data.content` wherever a preview is shown (`objectPreviewText`).
  flowStep: ['content', 'stepKind', 'stepConfig', 'stepInputs', 'stepOutputs'],
  // `abTestKey`/`variantKey` are the SPLIT half of the `experiment` binding: an
  // experiment names the test, and the page names which arm of it this page IS. Without
  // the pair, "bind experiment to `ab_tests`" would give the card a live exposure count
  // and still leave nothing on the board that says which page a visitor was shown.
  website: ['content', 'websiteHeadline', 'websiteBody', 'websiteCta', 'websiteAccent', 'websiteTheme', 'activeWebsitePageId', 'viewport', 'pages', 'subdomain', 'url', 'siteUrl', 'pathUrl', 'abTestKey', 'variantKey'],
  // A Builder object owns a real workspace: the scaffold lives in R2 and the
  // whole Builder surface (files, editor, dev server, checks, publish) opens on
  // Canvas. `modality` picks its starter template. The `ideProjectId` field is a
  // legacy persistence name retained until that data contract is migrated.
  build: ['content', 'modality', 'template', 'ideProjectId', 'storageProjectId', 'storageProjectPublicId', 'containerProjectId', 'fileCount', 'previewUrl', 'subdomain', 'url', 'siteUrl', 'pathUrl'],
  chat: ['content', 'aiResponse', 'messages', 'trace'],
  // `classifications`, `dataContract` and `lineage` are governance state Brain
  // MAY author: a PII tag it proposes is only useful if it can be written back.
  // `fetchedAt` is what makes staleness computable rather than guessed.
  // `fixtureCases` labels each generated row with the edge it exercises, so a failing
  // fixture can say WHICH boundary broke rather than "row 14".
  // `dataUse` is the governance ENVELOPE — declared purposes, lawful basis, retention.
  // `classifications` described what the rows ARE and nothing bound that description to
  // a USE, so nothing stopped a dataset tagged as personal data becoming a fine-tune
  // corpus. `battlecard.doNotSay` already proves a restriction can travel with an
  // object; this is the same move for personal data, read by `checkDataUse`.
  //
  // `basis` and `datasetVersion` are the reproducibility half: which rows, how many of
  // them, and which version of this dataset produced everything downstream.
  dataset: ['content', 'columns', 'rows', 'sampleRows', 'rowCount', 'profile', 'summary', 'fileName', 'mimeType', 'classifications', 'dataContract', 'violations', 'fetchedAt', 'lineage', 'producedAt', 'sourceUri', 'fixtureCases', 'dataUse', 'basis', 'datasetVersion'],
  table: ['content', 'columns', 'rows', 'rowCount', 'sampleRows', 'highlightRules', 'summary', 'sourceDatasetId', 'sources', 'classifications', 'lineage', 'producedAt', 'fetchedAt', 'basis'],
  spreadsheet: ['content', 'columns', 'rows', 'formulas', 'rowCount', 'highlightRules', 'summary'],
  // `widgets` is the dashboard's own model (see lib/canvasDashboard): an ordered list
  // where the chart kind is a VALUE, so a dashboard can hold any number of charts of
  // any type. `kpis` / `chartLabels` / `chartValues` remain the flat wire format the
  // model and canvas_query_dataset author in, and are folded into widgets on read.
  // `lineage`/`producedAt` are on every derived artifact for one reason: a chart
  // that records WHICH dataset it came from but not HOW can never be recomputed,
  // and can never say it has gone stale because its source moved. The transform
  // travels with the artifact — see lib/canvasLineage.
  // `basis` and the interval fields are the uncertainty half. A board rendered a point
  // estimate with identical visual authority at n = 12 and n = 1,200,000, and a chart
  // computed over a truncated frame looked exactly like one computed over the whole
  // file. `intervals` is per-series {low, high}; `sampleSize` is the n the reader needs
  // to judge any of it.
  chart: ['content', 'chartType', 'chartTitle', 'xAxisLabel', 'yAxisLabel', 'chartLabels', 'chartValues', 'kpis', 'widgets', 'sources', 'summary', 'sourceDatasetId', 'lineage', 'producedAt', 'metricId', 'basis', 'intervals', 'sampleSize'],
  map: ['content', 'mapPoints', 'mapTitle', 'mapValueLabel', 'mapRegion', 'mapRegionName', 'mapOutline', 'mapAttribution', 'sources', 'summary', 'sourceDatasetId', 'lineage', 'producedAt'],
  kpi: ['content', 'value', 'target', 'unit', 'trend', 'sources', 'summary', 'sourceDatasetId', 'lineage', 'producedAt', 'metricId', 'basis', 'ciLow', 'ciHigh', 'sampleSize'],
  dashboard: ['content', 'kpis', 'chartLabels', 'chartValues', 'widgets', 'sources', 'fetchedAt', 'dateRange', 'chartTitle', 'xAxisLabel', 'yAxisLabel', 'summary', 'sourceDatasetId', 'lineage', 'producedAt', 'basis'],
  report: ['content', 'markdown', 'chartLabels', 'chartValues', 'widgets', 'sources', 'lineage', 'producedAt'],
  // An evaluation used to grade ONE RESPONSE: criteria in, a pass rate out. That is a
  // percentage with a denominator nobody can defend in a review, and — because nothing
  // gated on it — a number that could not stop a bad model shipping. The fields added
  // here are the difference between grading an answer and evaluating a system:
  //   • `goldenDatasetId` — the eval set it is scored against, so the cases have an
  //     origin other than the model writing its own and marking them.
  //   • `judgeModel` / `judgeVersion` — WHO scored it. An unrecorded judge makes two
  //     runs incomparable, because the scorer may have changed between them.
  //   • `slices` — per-segment results. An aggregate that hides a failing slice is the
  //     single most common way a model ships broken for a subgroup.
  //   • `baselineEvaluationId` + `gate` — what it must beat, and whether falling short
  //     blocks the publish action. `workflow.approvalMode` already proves the pattern.
  //   • `costPerCase` / `latencyMs` — quality that costs ten times as much is a
  //     different answer, and the board could not see the price.
  evaluation: ['content', 'criteria', 'verdict', 'gaps', 'recommendations', 'sources', 'testResults', 'passRate', 'runCount', 'lastRunAt', 'goldenDatasetId', 'judgeModel', 'judgeVersion', 'slices', 'baselineEvaluationId', 'baselinePassRate', 'gate', 'costPerCase', 'latencyMs', 'subjectObjectId'],
  projectComparison: ['content', 'projects', 'sources', 'fetchedAt', 'recommendations'],
  roadmap: ['content', 'items', 'milestones', 'sources'],
  note: ['content', 'markdown'],
  prototype: ['content', 'websiteHeadline', 'websiteBody', 'websiteCta', 'websiteAccent', 'websiteTheme', 'activeWebsitePageId', 'viewport', 'pages', 'abTestKey', 'variantKey'],
  code: ['content', 'code', 'language', 'path'],
  browser: ['content', 'url', 'viewport', 'pageTitle'],
  repository: ['content', 'url', 'branch'],
  pullRequest: ['content', 'url', 'number', 'branch', 'baseBranch', 'author', 'mergedAt'],
  ciRun: ['content', 'url', 'branch', 'commitSha', 'conclusion', 'startedAt', 'finishedAt'],
  deployment: ['content', 'environmentName', 'version', 'url', 'deployedAt', 'deployedBy'],
  productionIncident: ['content', 'severity', 'startedAt', 'resolvedAt', 'owner', 'postmortemUrl'],
  deliveryRollup: [
    'content', 'scopeKind', 'scopeId', 'totalTasks', 'completedCount', 'openCount',
    'avgCycleTimeHours', 'throughputPerWeek', 'agentLlmCostUsd',
    'deploymentFrequencyPerDay', 'leadTimeHours', 'changeFailureRatePct', 'mttrHours',
    'avgOkrProgress', 'fetchedAt',
  ],
  environment: ['content', 'environmentUrl', 'environmentKind', 'branch'],
  selection: ['content', 'code', 'language', 'path', 'range'],
  // `auditFindings` is the accessibility/performance verdict of a fetched page. It
  // lands on `diagnostics` rather than on a kind of its own because that is exactly
  // what a diagnostic IS here — scored findings plus next steps — and a second
  // "audit" kind would be a per-feature copy of a shape that already exists.
  diagnostics: ['content', 'diagnostics', 'findings', 'checks', 'items', 'severity', 'result', 'results', 'summary', 'verdict', 'nextSteps', 'recommendations', 'actions', 'remediation', 'path', 'qualityScore', 'qualityLabel', 'qualityHeadline', 'diagnosticCount', 'gapCount', 'auditFindings', 'auditScore', 'auditPassed', 'auditTarget'],
  terminal: ['content', 'exitCode'],
  service: ['content', 'url', 'port', 'viewport', 'pageTitle'],
  // LLM work is bought by the token, and this object had no tokens on it. The platform
  // records every one — `agent_inference_logs`, `run_model_outcomes`, `llm_usage_log` —
  // and none of it reached the surface where the architecture is CHOSEN, so the board
  // could not answer "what does this cost at a million requests a month", which is the
  // question that decides whether an LLM feature ships at all. `projectedMonthlyCost` is
  // derived from the rest rather than typed, so a card cannot quote a price that
  // disagrees with its own inputs.
  course: ['content', 'course', 'exportStandards'],
  // `attempts` is absent on purpose: it is the learner's record of what they
  // actually answered, and a model that could write it could report mastery
  // nobody demonstrated. Only the practice card appends to it.
  practice: ['content', 'practiceMode', 'questions', 'sourceObjectId', 'summary'],
  guidedTour: ['content', 'tour'],
  project: ['content', 'projectLens', 'sources', 'qualityScore', 'qualityLabel', 'qualityHeadline', 'diagnosticCount', 'gapCount', 'diagnostics', 'recommendations', 'qualityUpdatedAt'],
  salesPipeline: ['content', 'ownerUserId', 'stages', 'pipelineCounts', 'recommendations', 'sources'],
  salesContact: ['content', 'ownerUserId', 'contactId', 'email', 'company', 'market', 'stage', 'lastTouchAt'],
  salesCampaign: ['content', 'ownerUserId', 'campaignId', 'market', 'subject', 'sent', 'replies', 'scheduledAt'],
  targetMarket: ['content', 'ownerUserId', 'market', 'segments', 'channels', 'recommendations', 'sources'],
  salesGoal: ['content', 'ownerUserId', 'outreachTarget', 'contactsTarget', 'meetingsTarget', 'revenueGoalCents', 'referralLink', 'salesLink', 'progress', 'recommendations'],
  salesMeeting: ['content', 'ownerUserId', 'contactId', 'scheduledAt', 'durationMinutes', 'attendees', 'meetingUrl'],
  // `messages` is the last read, kept so the tile is not blank while it
  // refreshes; `filter` is what makes the view reproducible on the next refresh
  // and is the reason an inbox is an OBJECT rather than a chat answer.
  inbox: ['content', 'connectionId', 'accountEmail', 'provider', 'filter', 'messages', 'unreadCount', 'fetchedAt', 'summary'],
  email: ['content', 'messageId', 'connectionId', 'accountEmail', 'from', 'fromName', 'to', 'subject', 'receivedAt', 'bodyText', 'unread', 'hasAttachments', 'webUrl', 'summary'],
  // `audienceId`/`audienceName` are the BINDING, and they are the only audience fields
  // here on purpose. The size, the suppression count and the lawful basis are NOT copied
  // onto the campaign: they are read at render time off the `audience` card this binds
  // to, so nothing an LLM patch can write is able to assert that nobody unsubscribed.
  // A count the model could type is a count the model could type to zero, and zero is
  // what unblocks the send. See `marketing.ts` and `campaignSendReadiness()` below.
  emailCampaign: ['content', 'campaignId', 'audienceId', 'audienceName', 'templateId', 'subject', 'bodyHtml', 'transport', 'senderIdentityId', 'mailboxConnectionId', 'connectorConnectionId', 'fromName', 'recipients', 'sent', 'failed', 'opened', 'clicked', 'blockers'],
  emailTemplate: ['content', 'templateId', 'subject', 'bodyHtml', 'mergeFields', 'assetId', 'logoUrl'],
  // `posts` is the last read, kept so the tile is not blank while it refreshes;
  // `filter` is what makes the view reproducible on the next refresh, and
  // `engagement`/`topPost` are the insight the tile leads with rather than a raw list.
  socialFeed: ['content', 'filter', 'posts', 'accounts', 'networks', 'engagement', 'topPost', 'postCount', 'fetchedAt', 'summary'],
  socialPost: ['content', 'postId', 'connectionId', 'network', 'accountName', 'authorName', 'text', 'permalink', 'publishedAt', 'metrics', 'mediaUrls', 'thumbnailUrl', 'summary'],
  socialCampaign: ['content', 'campaignId', 'body', 'linkUrl', 'mediaUrls', 'variants', 'targets', 'posts', 'scheduledAt', 'publishedCount', 'failedCount', 'blockers'],
  // `startDate`/`dueDate`/`storyPoints`/`sprintId` mirror `tasksApi.update`'s scheduling
  // triple plus sprint assignment (see its own note on why the client type used to omit
  // them) — without these here a task's estimate/schedule was writable through the API
  // but invisible to both Brain and the inspector that edits everything else about it.
  task: ['content', 'role', 'assignee', 'agentName', 'agentRef', 'priority', 'acceptanceCriteria', 'taskKey', 'prdTitle', 'prdStatus', 'prdSummary', 'prdCount', 'startDate', 'dueDate', 'storyPoints', 'sprintId'],
  prd: ['content', 'markdown', 'requirements', 'userStories'],
  release: ['content', 'items', 'milestones', 'releaseDate'],
  mockup: ['content', 'items', 'viewport', 'sources', 'deliveryProjectRef', 'deliveryProjectName', 'mockupAgentRef', 'mockupAgentName'],
  mockupSet: ['content', 'items', 'sources'],
  featureSummary: ['content', 'items', 'sources'],
  pitch: ['content', 'competitionId', 'beats', 'sources', 'summary'],
  pitchScorecard: ['content', 'competitionId', 'criteria', 'recommendations', 'sources', 'summary'],
  pitchQa: ['content', 'competitionId', 'questions', 'sources', 'summary'],
  pitchApplication: ['content', 'competitionId', 'answers', 'eligibility', 'category', 'sources', 'summary'],
  staff: ['content', 'role', 'focus', 'accent'],
  team: ['content', 'participants', 'summary'],
  // A role had an ORG representation and no COST one, so the board could draw the
  // headcount that consumes most of a budget and could never total it. `loadedCost` is
  // salary plus employer taxes, benefits and equipment — the number a plan actually
  // spends — and `startAt` is what stops a plan overstating the year by counting a
  // month-11 hire as twelve months of cost. These are the SAME facts `headcountPlan`
  // rolls up, held once on the role rather than copied into the plan.
  role: ['content', 'role', 'responsibilities', 'currency', 'salary', 'loadedCost', 'startAt', 'level', 'team', 'headcountStatus'],
  standup: ['content', 'participants', 'summary'],
  agent: ['content', 'model', 'personality', 'instructions', 'tools', 'autonomy', 'testPrompt', 'testExpected', 'testResponse', 'testStatus', 'testHistory'],
  voice: ['content', 'transcript', 'voiceId', 'audioUrl'],
  video: ['content', 'prompt', 'videoUrl', 'duration', 'modelSlug', 'maxFrames', 'frameCount', 'videoWidth', 'videoHeight', 'generatedFrames', 'mediaKind', 'capabilityId', 'videoTimeline', 'videoSources', 'selectedVideoClipId', 'renderedVideoUrl', 'renderedVideoStorageKey', 'renderedVideoMimeType', 'youtubeVideoId', 'youtubeUrl', 'youtubePrivacyStatus',
    // The server render still running for this movie — kept on the object so the
    // render outlives the tab that started it (`useServerMovieRender`).
    'serverRenderJobId',
    // The resumable YouTube upload still going up — kept on the object for the same
    // reason, so the link lands for whoever opens it next (`useYouTubeUpload`).
    'youtubeUploadId',
    // A video with no captions cannot lawfully be distributed to a class (WCAG 1.2.2),
    // and until this field existed the board had nowhere to record that they exist.
    'captionsUrl',
    // A RECORDED walkthrough carries two things an imported file cannot: when each
    // sentence was said, and which seconds are worth returning to. `talktrack` holds
    // both (see `talktrack.ts`); `transcript` is the same narration flattened to
    // prose, which is what Brain reads and what a search matches — the same pairing
    // `podcast` and `voice` already have.
    'talktrack', 'transcript'],
  image: ['content', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'mcpServer', 'mcpTool', 'mcpArguments'],
  animation: ['content', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'duration', 'mcpServer', 'mcpTool', 'mcpArguments'],
  podcast: ['content', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'duration', 'transcript', 'mcpServer', 'mcpTool', 'mcpArguments'],
  comic: ['content', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'pages', 'mcpServer', 'mcpTool', 'mcpArguments'],
  game: ['content', 'prompt', 'gamePlatform', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'mcpServer', 'mcpTool', 'mcpArguments'],
  cad: ['content', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'cadState', 'units', 'mcpServer', 'mcpTool', 'mcpArguments'],
  model3d: ['content', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'modelState', 'units', 'mcpServer', 'mcpTool', 'mcpArguments'],
  // Hand-authored (see the registry entry): no `mediaKind`/`capabilityId`/`mcpTool`
  // siblings — `world` is the whole authored state, same as `website`/`document`.
  world: ['content', 'world'],
  // A preset by name, or the whole design; and when it was last chosen as the room.
  room: ['content', 'roomLayout', 'roomDesign', 'activatedAt'],
  // AI generation, not authoring: the whole `CanvasSceneSpec` (model, prompt, params,
  // Mamba state, produced clip) lives under the one `scene` field — same single-field
  // shape `world` uses, for the same reason.
  scene: ['content', 'scene'],
  // `tailoredFor` names the `job` this variant was cut for, by that card's title. It is
  // the only thing that distinguishes nine résumés from nine unlabelled files, and it is
  // a REFERENCE rather than a copy of the posting for the reason `jobApplication.jobRef`
  // is: correcting the role on the posting must not leave nine variants quoting the old
  // one. Empty on the master résumé, which is what makes the master identifiable.
  resume: ['content', 'markdown', 'resumeDocument', 'tailoredFor', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'resumeId', 'fileName', 'mimeType', 'fileSize', 'mcpServer', 'mcpTool', 'mcpArguments'],
  template: ['content', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'templateCategory', 'outputFormat', 'thumbnailUrl', 'mcpServer', 'mcpTool', 'mcpArguments'],
  document: ['content', 'markdown', 'sources'],
  slides: ['content', 'markdown', 'items', 'sources'],
  diagram: ['content', 'markdown', 'diagram', 'diagramXml', 'diagramFormat', 'sources', 'sourceImageIds', 'fileName', 'mimeType'],
  knowledge: ['content', 'markdown', 'sources'],
  file: ['content', 'fileName', 'mimeType', 'url', 'fileSize', 'summary'],
  url: ['content', 'url', 'sources', 'viewport', 'pageTitle'],
  // `presentationOrder` is authorable so a model asked to "set up a walkthrough" can
  // number the frames rather than describing the order it would like — the sequence is
  // derived from this field and from nothing else editable.
  frame: ['content', 'framePurpose', 'frameColor', 'frameBorder', 'presentationOrder', 'approvalMode', 'runTarget'],
  // `stickyShape` records what the object was on the board it came FROM — a Miro
  // `shape` imports as a sticky with its geometry remembered, so a re-export can put
  // the rectangle back and a reader can see it was never a note. It is authorable
  // because a person may legitimately turn a sticky into a rounded card.
  sticky: ['content', 'stickyColor', 'stickyShape'],
  drawing: ['content', 'points', 'drawingWidth', 'drawingHeight', 'stroke', 'strokeWidth'],
  comment: ['content', 'resolved', 'mentions'],
  // `duration`/`remaining`/`running` were three fields nothing read: the card had no
  // clock, so a model could write "running: true" onto a card that never moved. The
  // shared model is `durationMs` + `startedAt` + `baseElapsedMs`, and all three are
  // authorable so a model asked to "put a five-minute timer on this" can set the box
  // AND start it — see `CanvasClockBody` for why liveness is these two numbers.
  timer: ['content', 'durationMs', 'startedAt', 'baseElapsedMs'],
  stopwatch: ['content', 'startedAt', 'baseElapsedMs'],
  // The reference IS the object. Authorable, because "embed the onboarding SOP here" is
  // a request a model can satisfy once it has the document's id.
  transclusion: ['content', 'documentId'],
  // `componentId` is authorable so "put the hiring pipeline on this board" is a
  // request the Brain can satisfy — it resolves against the same registry the
  // picker reads, and an id nothing registers renders as unavailable rather than
  // as a blank card.
  component: ['content', 'componentId'],
  mcp: ['content', 'toolName', 'operation', 'arguments'],
  evermind: ['content', 'model', 'instructions', 'teacherModel', 'inferenceEnabled', 'evermindVersion', 'evermindSeeded', 'contributions', 'pendingContributions', 'recentLearnings', 'trainingLoss', 'learningMode', 'lastLearnedAt', 'quarantinedAt', 'quarantineReason', 'evalPoint', 'stages', 'sources'],
  // ── The QA objects ─────────────────────────────────────────────────────────
  // `gateVerdict`, `passRate` and `lastRunAt` are absent from the authorable list on
  // purpose, and it is the same rule `practice.attempts` follows: a model that could
  // write its own gate verdict could report a release as green that nothing ran. Those
  // are written by `planGateVerdict` from the runs on the board, never by a patch.
  testPlan: ['content', 'targetUrl', 'routes', 'exitCriteria', 'summary', 'sources', 'planSlug'],
  // `spec` IS authorable — a person may paste a spec they already have — but every
  // canvas path that changes `steps` re-lowers it through `relowerCase`, so the two
  // cannot drift while the board owns the case.
  testCase: ['content', 'targetUrl', 'route', 'steps', 'spec', 'priority', 'intent', 'caseId', 'summary', 'sources'],
  testRun: ['content', 'targetUrl', 'results', 'browser', 'commitSha', 'startedAt', 'finishedAt', 'summary', 'explorationId', 'planObjectId'],
  defect: ['content', 'severity', 'defectType', 'route', 'targetUrl', 'expected', 'actual', 'reproSteps', 'fingerprint', 'caseId', 'evidenceUrl', 'assignee', 'resolution', 'summary', 'journal'],
  // Every spec-driven vocabulary is excluded here because its mutable fields are DERIVED
  // from its one declaration rather than retyped — that derivation is the whole point of
  // `specObjects.ts`. The exclusion list grows by one name per vocabulary, and the
  // annotation still fails to compile for any kind that is in neither half.
} as const satisfies Record<
  Exclude<
    CreationObjectKind,
    // The data-architecture kinds belong here for the same reason as the rest: their
    // mutable fields are DERIVED from `DATA_ARCHITECTURE_SPECS` and spread in below.
    // Their omission made this annotation demand six entries the object above is not
    // supposed to carry, so the exhaustiveness check it exists to perform could not
    // compile at all — a guard that fails for every kind protects none of them.
    FounderObjectKind | AcademicObjectKind | HiringObjectKind | PeopleObjectKind | SharedObjectKind | DataArchitectureKind | DataScienceObjectKind | OperationsObjectKind | LegalObjectKind | SellMotionObjectKind | CareerObjectKind | MarketingObjectKind | 'llm'
  >,
  readonly string[]
>;
