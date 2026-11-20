import { ROADMAP_STATUSES, TICKET_STATUS_ALIASES } from '@builderforce/agent-loop';

/**
 * The roadmap item form's write payload — pure, so the create/edit panel's rules are testable.
 *
 * The server holds a written status to the roadmap vocabulary only when the write CHANGES it,
 * so a row carrying an off-vocabulary legacy status ("in progress") stays editable. The form
 * therefore sends `status` on an edit only when the person changed it: a title-only save must
 * not rewrite (or be refused for) a stored value the select cannot show.
 */
export interface RoadmapItemDraft {
  title: string;
  horizon: string;
  status: string;
  theme: string;
  /** `YYYY-MM-DD` from the date input, or '' for none. */
  targetDate: string;
}

/**
 * The value the status select SHOWS. Display only: the stored status is read the way the
 * registry reads it — lower-cased, and a legacy delivered spelling (`done`, `released`,
 * `completed` …) shown as the `shipped` it stands for — and anything still not one of the
 * choices shows as the first choice.
 */
export function roadmapStatusForDisplay(status: string): string {
  return roadmapStatusChoice(status) ?? ROADMAP_STATUSES[0];
}

/** The vocabulary value a stored status reads as (lower-cased, legacy alias resolved), or null when it is none of them. */
function roadmapStatusChoice(status: string): string | null {
  const lower = status.trim().toLowerCase();
  const value = TICKET_STATUS_ALIASES.roadmap?.[lower] ?? lower;
  return (ROADMAP_STATUSES as readonly string[]).includes(value) ? value : null;
}

/**
 * True when a STORED status (non-empty) reads as none of the choices — e.g. "in progress". The
 * select then shows it as a disabled placeholder rather than as the first choice, so picking any
 * real status (the first one included) is a change the form writes back. An empty status (a new
 * item) is not off-vocabulary: it starts on the first choice.
 */
export function roadmapStatusIsOffVocabulary(status: string): boolean {
  return status.trim() !== '' && roadmapStatusChoice(status) === null;
}

/** The body a create (`isEdit` false: always carries the status) or an edit (status only when changed) sends. */
export function roadmapItemBody(draft: RoadmapItemDraft, opts: { isEdit: boolean; statusChanged: boolean }): Record<string, unknown> {
  return {
    title: draft.title.trim(),
    horizon: draft.horizon,
    ...(!opts.isEdit || opts.statusChanged ? { status: roadmapStatusForDisplay(draft.status) } : {}),
    theme: draft.theme.trim() || null,
    targetDate: draft.targetDate ? new Date(draft.targetDate).toISOString() : null,
  };
}
