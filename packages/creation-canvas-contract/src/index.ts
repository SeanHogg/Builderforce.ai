/** Shared, transport-neutral Creation Canvas contract used by web and VSIX. */
export * from './video';
export * from './canvasTools';

export const CREATION_OBJECT_KINDS = [
  'workflow', 'project', 'website', 'build', 'dashboard', 'chat', 'agent', 'staff', 'evaluation', 'dataset',
  'table', 'spreadsheet', 'chart', 'map', 'report', 'kpi', 'prototype', 'code', 'browser', 'llm', 'voice', 'video',
  'image', 'animation', 'podcast', 'comic', 'game', 'cad', 'model3d', 'resume', 'template',
  'document', 'slides', 'diagram', 'knowledge', 'file', 'url', 'note', 'drawing', 'frame', 'comment', 'timer',
  'roadmap', 'prd', 'release', 'task', 'mockup', 'mockupSet', 'featureSummary', 'team', 'role', 'mcp',
  'evermind', 'projectComparison', 'standup',
  'pitch', 'pitchScorecard', 'pitchQa', 'pitchApplication',
  'repository', 'selection', 'diagnostics', 'terminal', 'service',
  'salesPipeline', 'salesContact', 'salesCampaign', 'targetMarket', 'salesGoal', 'salesMeeting',
  // A connected mailbox and one message out of it. Two kinds rather than one
  // because they answer different questions: an `inbox` is a LIVE, filtered view
  // that re-reads, while an `email` is a single message pinned to the board so it
  // can be annotated, connected to a task, and still be there tomorrow after it
  // has scrolled out of the live view.
  'inbox', 'email',
  // A marketing campaign and the template it renders — the canvas half of
  // "draft this, then send it to that list".
  'emailCampaign', 'emailTemplate',
  // A standards-based learning experience authored and completed on the canvas.
  'course',
  // A reusable, target-aware product onboarding design. It stays provider-neutral:
  // the Canvas authors the contract and each delivery surface supplies its anchors.
  'guidedTour',
] as const;

export type CreationObjectKind = typeof CREATION_OBJECT_KINDS[number];

/** Provider-neutral creative capabilities owned by Builderforce. Canvas, Brain,
 * MCP, web, and VS Code consume this contract; execution providers are adapters
 * and are never encoded into saved objects. */
export const CREATIVE_CAPABILITIES = [
  { kind: 'video', capabilityId: 'creative.video', mediaKind: 'video', outputs: ['MP4', 'WebM'] },
  { kind: 'voice', capabilityId: 'creative.voice', mediaKind: 'voice', outputs: ['MP3', 'WAV'] },
  { kind: 'document', capabilityId: 'creative.document', mediaKind: 'document', outputs: ['DOCX', 'PDF', 'Markdown'] },
  { kind: 'slides', capabilityId: 'creative.presentation', mediaKind: 'presentation', outputs: ['PPTX', 'PDF'] },
  { kind: 'diagram', capabilityId: 'creative.diagram', mediaKind: 'diagram', outputs: ['Draw.io XML', 'Mermaid', 'SVG'] },
  { kind: 'file', capabilityId: 'creative.file', mediaKind: 'file', outputs: ['Original', 'ZIP'] },
  { kind: 'image', capabilityId: 'creative.image', mediaKind: 'image', outputs: ['PNG', 'JPG', 'SVG', 'PSD'] },
  { kind: 'animation', capabilityId: 'creative.animation', mediaKind: 'animation', outputs: ['HTML', 'SVG', 'GIF', 'Animated WebP', 'APNG', 'MP4'] },
  { kind: 'podcast', capabilityId: 'creative.podcast', mediaKind: 'podcast', outputs: ['Markdown script', 'MP3', 'M4A', 'OGG', 'WAV', 'MP4'] },
  { kind: 'comic', capabilityId: 'creative.comic', mediaKind: 'comic', outputs: ['SVG', 'PNG strip', 'PDF', 'CBZ'] },
  // Named for what the game targets actually produce (api application/game/gameTarget).
  // `HTML5 ZIP` and `Web embed` were advertised here and implemented nowhere.
  { kind: 'game', capabilityId: 'creative.game', mediaKind: 'game', outputs: ['HTML', 'Web app', 'Android APK', 'iOS app', 'Roblox place'] },
  { kind: 'cad', capabilityId: 'creative.cad', mediaKind: 'cad', outputs: ['SVG', 'DXF', 'PDF'] },
  { kind: 'model3d', capabilityId: 'creative.model3d', mediaKind: 'model3d', outputs: ['STL', 'OBJ', 'STEP', 'GLB'] },
  { kind: 'resume', capabilityId: 'creative.resume', mediaKind: 'document', outputs: ['HTML', 'Markdown', 'PDF', 'DOCX'] },
  { kind: 'template', capabilityId: 'creative.template', mediaKind: 'template', outputs: ['JSON', 'Template defaults'] },
] as const satisfies ReadonlyArray<{ kind: CreationObjectKind; capabilityId: string; mediaKind: string; outputs: readonly string[] }>;

export type CreativeCapability = typeof CREATIVE_CAPABILITIES[number];

export const CREATION_CONNECTION_KINDS = [
  'data', 'control', 'reference', 'presentation', 'delivery', 'membership',
] as const;

export type CreationConnectionKind = typeof CREATION_CONNECTION_KINDS[number];

export const CREATION_COMMAND_TYPES = [
  'graph.replace', 'object.add', 'object.update', 'object.move', 'object.delete',
  'connection.add', 'connection.delete', 'viewport.set',
] as const;

export type CreationCommandType = typeof CREATION_COMMAND_TYPES[number];

export function isCreationObjectKind(value: unknown): value is CreationObjectKind {
  return typeof value === 'string' && (CREATION_OBJECT_KINDS as readonly string[]).includes(value);
}

export function isCreationCommandType(value: unknown): value is CreationCommandType {
  return typeof value === 'string' && (CREATION_COMMAND_TYPES as readonly string[]).includes(value);
}

export function isCreationConnectionKind(value: unknown): value is CreationConnectionKind {
  return typeof value === 'string' && (CREATION_CONNECTION_KINDS as readonly string[]).includes(value);
}
