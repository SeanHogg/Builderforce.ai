/**
 * What a card offers BESIDE its body — its badges, its schedule, its messages and the
 * panels they open.
 *
 * ── WHY ONE MODULE ───────────────────────────────────────────────────────────────
 * These four look unrelated and are one thing: they are every affordance a node has that
 * is not "draw the object". Built separately they would each have invented their own
 * answer to the same three questions — where does the badge sit, what opens, and how does
 * a panel know which node it belongs to — and the card would have grown four independent
 * popover implementations that disagree on placement and on how Escape works.
 *
 * So the badges are DATA, the panels are DATA, and the card renders whatever this returns.
 * Adding an affordance later is a row here plus a body in `CanvasNodePanel`; it is never a
 * fifth `useState` on a 2,500-line component.
 *
 * ── WHY THE PANELS ARE ANCHORED AND NOT A RAIL ───────────────────────────────────
 * The inspector is a full-height right rail forty controls deep with nothing tying it to
 * the card it configures. On a board with fifteen cards, "which one am I editing" is
 * answered only by remembering what you clicked. An anchored panel answers it by being
 * beside the thing — which is the whole reason every scenario editor worth copying puts
 * it there.
 */

import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

/* ══════════════════════════════════════════════════════════════════════════════════
   MESSAGES — what is wrong with this object, ON this object
   ══════════════════════════════════════════════════════════════════════════════════ */

export type CanvasNodeSeverity = 'error' | 'warning' | 'info';

export interface CanvasNodeMessage {
  id: string;
  severity: CanvasNodeSeverity;
  /** Already-localized sentence. Derived messages carry a key instead — see below. */
  text?: string;
  /** Catalog key under `creationCanvas.nodeMessage`, for messages this module derives. */
  textKey?: string;
  /** Where the fix is. A message that names a problem and not its cure is a complaint. */
  actionHref?: string;
  actionLabelKey?: string;
}

/** Severity order, worst first — the badge reports the WORST thing on the card, because a
 *  card that says "2" without saying how bad is a card you have to open to triage. */
const SEVERITY_RANK: Readonly<Record<CanvasNodeSeverity, number>> = { error: 0, warning: 1, info: 2 };

function isSeverity(value: unknown): value is CanvasNodeSeverity {
  return value === 'error' || value === 'warning' || value === 'info';
}

/**
 * Every message on this object, worst first.
 *
 * TWO sources, deliberately merged here rather than at the call site:
 *
 *   - AUTHORED — `data.messages`, written by a tool run, a compile, a publish attempt or
 *     Brain itself. This is how "no credential attached, this step will be skipped" gets
 *     onto the step that will be skipped.
 *   - DERIVED — facts the board can see for itself. Today that is the empty shell: an
 *     object with a title and no content, which is the single most common way a canvas
 *     ends up looking finished and being empty.
 *
 * Derived messages carry a KEY, not a sentence, because `emptyShellProblem` in the object
 * registry writes for the MODEL — it is an instruction telling Brain what to send — and
 * putting that string in front of a person would be showing them a prompt.
 */
export function canvasNodeMessages(
  data: { readonly [key: string]: unknown },
  derived: { emptyShell?: boolean } = {},
): readonly CanvasNodeMessage[] {
  const messages: CanvasNodeMessage[] = [];
  const authored = Array.isArray(data.messages) ? data.messages : [];
  for (const [index, entry] of authored.entries()) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    if (!text) continue;
    messages.push({
      id: typeof row.id === 'string' ? row.id : `authored-${index}`,
      severity: isSeverity(row.severity) ? row.severity : 'info',
      text,
      ...(typeof row.actionHref === 'string' ? { actionHref: row.actionHref } : {}),
    });
  }
  if (derived.emptyShell) {
    messages.push({ id: 'empty-shell', severity: 'warning', textKey: 'emptyShell' });
  }
  return [...messages].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** The severity the badge is tinted with — the worst one present. */
export function canvasNodeWorstSeverity(messages: readonly CanvasNodeMessage[]): CanvasNodeSeverity | null {
  return messages.length ? messages[0].severity : null;
}

/* ══════════════════════════════════════════════════════════════════════════════════
   SCHEDULE — when this step runs on its own
   ══════════════════════════════════════════════════════════════════════════════════ */

/**
 * The intervals a step can be put on.
 *
 * A list rather than a free number field, and the reason is cost rather than taste: every
 * entry here is a poll against whatever the step touches, and "every 1 minute" on a
 * fifteen-step board is 21,600 runs a day. The floor is fifteen minutes, which is also
 * the floor the platform's own cron work-gate is tuned for.
 */
export const CANVAS_SCHEDULE_INTERVALS = [15, 30, 60, 180, 720, 1440] as const;

export type CanvasScheduleInterval = (typeof CANVAS_SCHEDULE_INTERVALS)[number];

export interface CanvasNodeSchedule {
  enabled: boolean;
  everyMinutes: CanvasScheduleInterval;
  /** Local clock window, `HH:MM`. Absent means any hour. */
  fromHour?: string;
  toHour?: string;
  /** Weekdays only. The commonest single restriction, so it is a switch and not a picker. */
  weekdaysOnly?: boolean;
}

export const DEFAULT_CANVAS_SCHEDULE: CanvasNodeSchedule = { enabled: false, everyMinutes: 15 };

function isInterval(value: unknown): value is CanvasScheduleInterval {
  return typeof value === 'number' && (CANVAS_SCHEDULE_INTERVALS as readonly number[]).includes(value);
}

/**
 * This object's schedule, defaulted rather than migrated — the same rule node density
 * follows, for the same reason: objects are authored by models and templates as well as
 * by people, and a board must render whatever arrives.
 */
export function canvasNodeSchedule(data: { readonly [key: string]: unknown }): CanvasNodeSchedule {
  const raw = data.schedule;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_CANVAS_SCHEDULE;
  const row = raw as Record<string, unknown>;
  return {
    enabled: row.enabled === true,
    everyMinutes: isInterval(row.everyMinutes) ? row.everyMinutes : DEFAULT_CANVAS_SCHEDULE.everyMinutes,
    ...(typeof row.fromHour === 'string' ? { fromHour: row.fromHour } : {}),
    ...(typeof row.toHour === 'string' ? { toHour: row.toHour } : {}),
    ...(row.weekdaysOnly === true ? { weekdaysOnly: true } : {}),
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════
   PANELS — what opens beside the card
   ══════════════════════════════════════════════════════════════════════════════════ */

export type CanvasNodePanelId = 'config' | 'schedule' | 'messages' | 'persona';

/**
 * The kinds that are PEOPLE.
 *
 * `agent` is a custom agent this tenant wrote; `staff` is a built-in seat from the role
 * catalog. They get the same panel with the same fields and differ only in what is
 * read-only, which is exactly what keeps `psychometric-persona` one trait engine with two
 * doors in rather than two half-implementations that drift on what a trait means.
 */
const PERSON_KINDS: ReadonlySet<string> = new Set(['agent', 'staff']);

export function isCanvasPersonKind(kind: CreationObjectKind | string): boolean {
  return PERSON_KINDS.has(kind);
}

/** Whether a person on this board came from the role catalog or was written here. */
export function canvasPersonOrigin(kind: CreationObjectKind | string): 'builtin' | 'custom' {
  return kind === 'staff' ? 'builtin' : 'custom';
}

export interface CanvasNodePanelDef {
  id: CanvasNodePanelId;
  /** Catalog key under `creationCanvas.nodePanel` for the panel's title. */
  titleKey: string;
  /** Whether the panel has an Advanced section to hide the long tail behind. */
  advanced: boolean;
}

export const CANVAS_NODE_PANELS: readonly CanvasNodePanelDef[] = [
  { id: 'config', titleKey: 'config', advanced: true },
  { id: 'schedule', titleKey: 'schedule', advanced: true },
  // Messages has no Advanced section: everything on it is the point. A collapsed
  // "advanced" list of the errors that will skip this step is an absurd object.
  { id: 'messages', titleKey: 'messages', advanced: false },
  { id: 'persona', titleKey: 'persona', advanced: true },
];

const PANEL_BY_ID = new Map(CANVAS_NODE_PANELS.map((def) => [def.id, def]));

export function canvasNodePanel(id: CanvasNodePanelId): CanvasNodePanelDef {
  const def = PANEL_BY_ID.get(id);
  if (!def) throw new Error(`Unknown canvas node panel: ${id}`);
  return def;
}

/**
 * The panel a card's settings button opens.
 *
 * A person opens their persona; everything else opens its config. Asked here rather than
 * branched at the card, so the card never has to know which kinds are people.
 */
export function canvasNodeSettingsPanel(kind: CreationObjectKind | string): CanvasNodePanelId {
  return isCanvasPersonKind(kind) ? 'persona' : 'config';
}
