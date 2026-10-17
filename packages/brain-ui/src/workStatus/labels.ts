/**
 * The copy of the `/` menu's Status tab — account, usage meters, Evermind. Hosts pass a
 * localized bundle; English defaults keep it readable unmapped. Placeholders:
 * `{version}`, `{used}`, `{limit}`, `{unit}`.
 *
 * Meter names are keyed by the server's meter key, so a new meter shows its own name
 * the moment a host maps it — and an unmapped key still reads as words, never as a
 * raw `snake_case` id.
 */
export interface WorkStatusLabels {
  loading: string;
  account: string;
  plan: string;
  resets: string;
  /** Beside the plan when every limit is lifted for a superadmin operator. */
  limitsLifted: string;
  limitsLiftedHint: string;
  usage: string;
  usageEmpty: string;
  unlimited: string;
  /** "{used} / {limit} {unit}". */
  meterOf: string;
  upgrade: string;
  managePlan: string;
  /** Billing states other than active, by key. */
  billing: Record<string, string>;
  /** Plan tiers, by key. */
  plans: Record<string, string>;
  meters: Record<string, string>;
  units: Record<string, string>;
  evermind: string;
  /** "v{version}". */
  evermindVersion: string;
  evermindLearning: string;
  evermindFrozen: string;
  evermindAnswersOn: string;
  evermindAnswersOff: string;
  evermindHint: string;
}

export const DEFAULT_WORK_STATUS_LABELS: WorkStatusLabels = {
  loading: 'Loading account…',
  account: 'Account',
  plan: 'Plan',
  resets: 'Resets',
  limitsLifted: 'limits lifted',
  limitsLiftedHint: 'You are a superadmin operator, so every limit is lifted for you — the plan’s own limits still apply to its members.',
  usage: 'Usage',
  usageEmpty: 'No usage meters for this plan.',
  unlimited: 'Unlimited',
  meterOf: '{used} / {limit} {unit}',
  upgrade: 'Upgrade',
  managePlan: 'Manage plan',
  billing: { past_due: 'Past due', canceled: 'Canceled', trialing: 'Trial', incomplete: 'Incomplete' },
  plans: { free: 'Free', pro: 'Pro', teams: 'Teams', enterprise: 'Enterprise' },
  meters: {
    ai_tokens: 'AI tokens',
    cloud_runs: 'Cloud runs',
    stage_sandbox_runs: 'Sandbox runs',
    ingestion: 'Ingestion',
    error_events: 'Error events',
    outbound_fetches: 'Outbound fetches',
    feedback_submissions: 'Feedback',
    replay_recordings: 'Recordings',
  },
  units: { tokens: 'tokens', bytes: 'bytes', runs: 'runs', events: 'events', fetches: 'fetches', submissions: 'submissions', sandbox_runs: 'runs', recordings: 'recordings' },
  evermind: 'Evermind',
  evermindVersion: 'v{version}',
  evermindLearning: 'Learning',
  evermindFrozen: 'Not learning',
  evermindAnswersOn: 'Answers on',
  evermindAnswersOff: 'Answers off',
  evermindHint: 'Learning: this project’s chats teach its Evermind. Answers: whether the Evermind may answer for a paid model. Change both in the Evermind view.',
};

export function workStatusLabels(overrides?: Partial<WorkStatusLabels>): WorkStatusLabels {
  if (!overrides) return DEFAULT_WORK_STATUS_LABELS;
  const d = DEFAULT_WORK_STATUS_LABELS;
  return {
    ...d,
    ...overrides,
    billing: { ...d.billing, ...overrides.billing },
    plans: { ...d.plans, ...overrides.plans },
    meters: { ...d.meters, ...overrides.meters },
    units: { ...d.units, ...overrides.units },
  };
}

/** A key's display name: the mapped label, else its words (never a raw `snake_case` id). */
export function labelForKey(map: Record<string, string>, key: string): string {
  return map[key] ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
