/**
 * The lifecycle every campaign channel shares, stated as DATA.
 *
 * An email/SMS campaign (`marketing_campaigns`) and a social campaign
 * (`social_campaigns`) are the same act — author, arm, go out, settle — and had
 * each written "may this be edited / started / is it in flight" out as inline
 * string checks. The stored vocabularies differ, so each channel keeps its own
 * statuses and says which neutral PHASE each one is; the rules are then asked of
 * the phase, in one place, and the two cannot drift apart.
 *
 *   draft      authored, not going anywhere yet
 *   armed      waiting for a time (social only — an email waits as a `draft`
 *              with `scheduled_at` set, so its `waits` phase is `draft`)
 *   in_flight  going out right now, advanced batch by batch
 *   done       finished and delivered — history, never rewritten
 *   failed     finished without delivering
 *
 * Where the channels truly disagree the difference is a table cell, not a branch:
 * a failed social campaign may be edited and re-run; a failed email may not.
 * Stored strings are the DB's — nothing here renames a status.
 */

export type CampaignKind = 'email' | 'social';
export type CampaignPhase = 'draft' | 'armed' | 'in_flight' | 'done' | 'failed';

const EMAIL_PHASES = { draft: 'draft', sending: 'in_flight', sent: 'done', failed: 'failed' } as const satisfies Record<string, CampaignPhase>;
const SOCIAL_PHASES = {
  draft: 'draft', scheduled: 'armed', publishing: 'in_flight', published: 'done', failed: 'failed',
} as const satisfies Record<string, CampaignPhase>;

export type EmailCampaignStatus = keyof typeof EMAIL_PHASES;
export type SocialCampaignStatus = keyof typeof SOCIAL_PHASES;

interface Lifecycle {
  /** Stored status → phase. */
  phases: Readonly<Record<string, CampaignPhase>>;
  /** Phases whose content may still be edited. */
  editable: readonly CampaignPhase[];
  /** The phase a campaign with a send time waits in until the sweep finds it due. */
  waits: CampaignPhase;
  /** Allowed moves between stored statuses; staying put is not a transition. */
  next: Readonly<Record<string, readonly string[]>>;
}

const LIFECYCLE: Readonly<Record<CampaignKind, Lifecycle>> = {
  email: {
    phases: EMAIL_PHASES,
    editable: ['draft'],
    waits: 'draft',
    next: { draft: ['sending'], sending: ['sent', 'failed'], sent: [], failed: [] },
  },
  social: {
    phases: SOCIAL_PHASES,
    editable: ['draft', 'armed', 'failed'],
    waits: 'armed',
    next: {
      draft: ['scheduled', 'publishing'],
      scheduled: ['draft', 'publishing'],
      publishing: ['published', 'failed'],
      published: [],
      failed: ['draft', 'scheduled', 'publishing'],
    },
  },
};

/** The phase a stored status is in, or `undefined` for a string this channel never writes. */
export function phaseOf(kind: CampaignKind, status: string): CampaignPhase | undefined {
  return LIFECYCLE[kind].phases[status];
}

/** Every stored status in a phase — for SQL predicates, so they are derived, not retyped. */
export function statusesIn(kind: CampaignKind, phase: CampaignPhase): string[] {
  return Object.entries(LIFECYCLE[kind].phases).filter(([, p]) => p === phase).map(([status]) => status);
}

/** Stored statuses whose content may be edited — the SQL twin of `mayEdit`. */
export function editableStatuses(kind: CampaignKind): string[] {
  return LIFECYCLE[kind].editable.flatMap((phase) => statusesIn(kind, phase));
}

/** Stored statuses the sweep looks in for a campaign whose send time has arrived. */
export function dueStatuses(kind: CampaignKind): string[] {
  return statusesIn(kind, LIFECYCLE[kind].waits);
}

export function isInFlight(kind: CampaignKind, status: string): boolean {
  return phaseOf(kind, status) === 'in_flight';
}

export function isArmed(kind: CampaignKind, status: string): boolean {
  return phaseOf(kind, status) === 'armed';
}

/** Delivered and final — what the world already saw. */
export function isDone(kind: CampaignKind, status: string): boolean {
  return phaseOf(kind, status) === 'done';
}

export function mayEdit(kind: CampaignKind, status: string): boolean {
  const phase = phaseOf(kind, status);
  return phase !== undefined && LIFECYCLE[kind].editable.includes(phase);
}

/** May go out from here — i.e. the table lets this status move to an in-flight one. */
export function mayStart(kind: CampaignKind, status: string): boolean {
  return (LIFECYCLE[kind].next[status] ?? []).some((to) => isInFlight(kind, to));
}

export function canTransition(kind: CampaignKind, from: string, to: string): boolean {
  return (LIFECYCLE[kind].next[from] ?? []).includes(to);
}

/** The status an authored campaign rests in: armed when it has a send time (social), else draft. */
export function restingStatus(kind: CampaignKind, hasSendTime: boolean): string {
  return hasSendTime ? statusesIn(kind, 'armed')[0] ?? 'draft' : 'draft';
}
