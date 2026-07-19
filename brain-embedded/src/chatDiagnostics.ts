/**
 * chatDiagnostics — a pure serializer for the "Copy diagnostics" action.
 *
 * The plain transcript (turns + tool I/O) answers "what did the model say?"; this
 * answers "what STATE was this chat in?" — the identity + wiring facts you otherwise
 * have to guess at from screenshots: the chat's own project, the tenant, the project
 * Evermind head (version / mode / learned / queued / last-learned), the learn-gate
 * outcome for the last turn, the agents invited into the chat, and the linked tickets.
 *
 * It is the fix for a whole class of "even after N fixes I can't tell what's wrong"
 * loops: the #1 real cause of "Learning · Connected yet nothing learns" is that the
 * CHAT is bound to a different project (or none) than the panel shows — a fact invisible
 * in the UI but dumped plainly here, with a Signals section that names the likely cause.
 *
 * Pure + host-agnostic (no fetch, no DOM): every surface gathers the data its own way
 * and calls this ONE renderer, so the copied report is identical on web and in VS Code.
 */

/** The project Evermind head/activity snapshot, as the panel reads it. */
export interface ChatDiagnosticsEvermind {
  version: number;
  mode: string;
  inferenceEnabled?: boolean;
  teacherModel?: string | null;
  /** Merged contributions to date — the panel's "Learned". */
  contributions?: number;
  /** Queued-but-not-yet-merged contributions — the panel's "Queued". */
  pending?: number;
  /** ISO timestamp of the last merge, or null if never — the panel's "Last learned". */
  lastLearnedAt?: string | null;
}

/** One metered resource, mirroring the `/api/consumption` meter snapshot shape. */
export interface ChatDiagnosticsMeter {
  /** 'ai_tokens' | 'ingestion' | 'error_events' | 'outbound_fetches' | 'cloud_runs' */
  key: string;
  /** 'tokens' | 'bytes' | 'events' | 'fetches' | 'runs' */
  unit: string;
  used: number;
  /** Monthly allowance; -1 = unlimited. */
  limit: number;
  unlimited: boolean;
  /** Remaining this month; -1 when unlimited. */
  remaining: number;
  /** 0–100; 0 when unlimited. */
  percentUsed: number;
}

/**
 * WHO the user is to the platform and WHAT they are allowed to spend — the half of
 * "why is this chat behaving like that?" that identity + Evermind state can't answer.
 *
 * The motivating case is a brand-new signup: free plan, no card, a small token
 * allowance and no premium/frontier entitlement. From the outside that looks
 * indistinguishable from a broken install ("it picked a weak model", "it stopped
 * answering") — so the report states the plan, the billing status, the month-to-date
 * meters, and the model entitlement explicitly, and the Signals section names the
 * consequence rather than leaving the reader to infer it.
 */
export interface ChatDiagnosticsAccount {
  /** Effective plan key ('free' | 'pro' | …) as the API resolves it. */
  plan?: string | null;
  /** Billing status ('none' = no payment method on file, 'trialing', 'active', …). */
  billingStatus?: string | null;
  /** Current metering period — when the allowances reset. */
  periodStart?: string | null;
  resetsAt?: string | null;
  /** Month-to-date usage vs allowance for every metered resource. */
  meters?: ChatDiagnosticsMeter[];
  /** The model in force for this chat (absent ⇒ the gateway routes per turn). */
  model?: string | null;
  /** Which purse funds `model`: 'byo:<vendor>' | 'plan' | 'premium' | 'auto'. */
  modelFunding?: string | null;
  /** Whether the plan entitles the tenant to premium/frontier models. */
  canUsePremiumModels?: boolean;
  /** How many models the plan pool currently offers. */
  planModelCount?: number;
  /** Connected bring-your-own provider keys (empty ⇒ every turn is plan-funded). */
  byoProviders?: string[];
  /** Client build + gateway it is talking to, so a report pins the exact surface. */
  extensionVersion?: string | null;
  baseUrl?: string | null;
}

/**
 * WHICH purse funds a model, as a machine key: `auto` (no pin — the gateway routes per
 * turn), `byo:<vendor>` (the tenant's own connected account), `plan` (in the plan pool,
 * included), or `premium` (metered at cost + per-request fee).
 *
 * ONE decision, two consumers: the chat header renders a localized sentence from it and
 * the diagnostics report records it. Kept here (not in a UI file) so the sentence a user
 * READS and the key a support report SHOWS can never disagree.
 */
export function classifyModelFunding(
  model: string | null | undefined,
  surface: { data?: Array<{ id?: string }>; byo?: { models?: Array<{ id?: string; vendor?: string }> } } | null | undefined,
): string {
  if (!model) return 'auto';
  const byo = (surface?.byo?.models ?? []).find((m) => m.id === model);
  if (byo?.vendor) return `byo:${byo.vendor}`;
  if ((surface?.data ?? []).some((m) => m.id === model)) return 'plan';
  return 'premium';
}

/** Everything the diagnostics block needs — already gathered by the host (pure in). */
export interface ChatDiagnosticsData {
  surface?: string;
  chatId?: number | null;
  chatTitle?: string | null;
  /** 'shared' | 'locked' — who can see the chat. */
  chatVisibility?: string | null;
  /** The chat's OWN project (what the learn gate keys on), or null when unattached. */
  projectId?: number | null;
  projectName?: string | null;
  /** The project the surrounding UI/panel is showing, when it differs from the chat's. */
  selectedProjectId?: number | null;
  tenantId?: number | string | null;
  userId?: string | null;
  /** The project Evermind head for the CHAT's project (not the selected one). */
  evermind?: ChatDiagnosticsEvermind | null;
  /** The server learn-gate outcome for the most recent assistant turn, if known. */
  lastLearn?: { learned: boolean; version: number; reason?: string | null } | null;
  agents?: Array<{ agentRef: string; role: string }>;
  tickets?: Array<{ kind: string; ref: string; label?: string; linkType?: string; status?: string }>;
  /** Plan, quota and model entitlement for the signed-in tenant (see the interface). */
  account?: ChatDiagnosticsAccount | null;
}

function fmtProject(id: number | null | undefined, name?: string | null): string {
  if (id == null) return 'none';
  return name ? `${name} (#${id})` : `#${id}`;
}

/** Human label per meter key — unknown keys fall back to the raw key. */
const METER_LABEL: Record<string, string> = {
  ai_tokens: 'AI tokens',
  ingestion: 'Data ingested',
  error_events: 'Error events',
  outbound_fetches: 'Web fetches',
  cloud_runs: 'Cloud runs',
};

/** Render a meter amount in its own unit (bytes get scaled; everything else counts). */
function fmtMeterValue(value: number, unit: string): string {
  if (value < 0) return '∞';
  if (unit !== 'bytes') return value.toLocaleString('en-US');
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = value / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

/** "12,345 / 250,000 tokens (5%) · 237,655 left" — or "… (unlimited)". */
function fmtMeter(m: ChatDiagnosticsMeter): string {
  const label = METER_LABEL[m.key] ?? m.key;
  if (m.unlimited) return `${label}: ${fmtMeterValue(m.used, m.unit)} used (unlimited)`;
  return `${label}: ${fmtMeterValue(m.used, m.unit)} / ${fmtMeterValue(m.limit, m.unit)}`
    + ` (${m.percentUsed}%) · ${fmtMeterValue(m.remaining, m.unit)} left`;
}

/** The token meter is the one that actually stops a chat mid-turn (gateway 429). */
function tokenMeter(a: ChatDiagnosticsAccount | null | undefined): ChatDiagnosticsMeter | undefined {
  return (a?.meters ?? []).find((m) => m.key === 'ai_tokens');
}

/**
 * Compute the actionable "why isn't this working?" signals from the raw facts, so the
 * report NAMES the likely cause instead of leaving the reader to correlate numbers.
 * Ordered most-actionable first. Returns [] when nothing is obviously wrong.
 */
function diagnosticsSignals(d: ChatDiagnosticsData): string[] {
  const out: string[] = [];
  const ev = d.evermind;

  // #1 real cause: the chat isn't bound to a project (the learn gate keys on the
  // CHAT's projectId, not the panel's selected project).
  if (d.projectId == null || d.lastLearn?.reason === 'not-attached') {
    out.push(
      '⚠️ Chat is NOT attached to a project (chat.projectId is null). The learn gate keys on the CHAT\'s project, so this chat contributes NOTHING to any Evermind — even though the panel shows the selected project as connected. Attach the chat to a project (or re-open it so the self-heal adopts the active project).',
    );
  } else if (d.selectedProjectId != null && d.selectedProjectId !== d.projectId) {
    out.push(
      `⚠️ Chat's project (#${d.projectId}) differs from the panel's selected project (#${d.selectedProjectId}). The Evermind panel reflects the SELECTED project; this chat feeds project #${d.projectId}. They are different models — compare the versions below.`,
    );
  }

  if (ev && ev.version < 1) {
    out.push(
      `⚠️ The chat's project Evermind is UNSEEDED (v0). Until a base model is seeded (version ≥ 1) the gate returns "not-seeded" and no turn contributes. This is why a learn step can report v0.`,
    );
  }
  if (ev && ev.version >= 1 && ev.mode !== 'connected') {
    out.push(`⚠️ The chat's project Evermind is "${ev.mode}" (not connected) — read-only, so turns don't contribute.`);
  }
  if (d.lastLearn && d.lastLearn.learned && ev && ev.version >= 1 && d.lastLearn.version !== ev.version) {
    out.push(
      `⚠️ Last turn reported learn version v${d.lastLearn.version} but the chat's project head is v${ev.version}. A version mismatch means the learn step and the panel are resolving DIFFERENT projects/heads.`,
    );
  }
  if ((d.agents?.length ?? 0) === 0) {
    out.push('ℹ️ No agents are invited into this chat (chats.list_agents is empty), so dispatched agents post nothing back here.');
  }

  // Account signals — the "it's not broken, you're on the free tier" class of cause.
  // A brand-new signup hits all of these at once, and every one of them presents as a
  // capability bug (weak model, refused request, turn that stops) unless it is named.
  const acct = d.account;
  const tokens = tokenMeter(acct);
  if (acct) {
    const free = acct.plan === 'free';
    const noCard = acct.billingStatus === 'none' || acct.billingStatus == null;
    if (free && noCard) {
      out.push(
        'ℹ️ Free plan with NO payment method on file. Expect the smaller monthly token allowance, no premium/frontier models, and turns funded by the shared free pool — none of this is a fault. Adding a card (or connecting your own provider account) lifts all three.',
      );
    } else if (free) {
      out.push('ℹ️ Free plan — premium/frontier models are not entitled and the monthly token allowance is the free tier\'s.');
    }
    if (acct.billingStatus === 'past_due') {
      out.push('⚠️ Billing status is past_due — plan entitlements may be suspended until payment succeeds, which reads as sudden model/quota downgrade.');
    }
    if (tokens && !tokens.unlimited) {
      if (tokens.remaining <= 0) {
        out.push(
          `⚠️ AI token allowance is EXHAUSTED (${tokens.used.toLocaleString('en-US')} / ${tokens.limit.toLocaleString('en-US')} this period). The gateway returns 429 \`plan_token_limit_exceeded\`, so turns fail or stop mid-answer until ${acct.resetsAt ?? 'the period resets'}.`,
        );
      } else if (tokens.percentUsed >= 80) {
        out.push(
          `⚠️ AI token allowance is ${tokens.percentUsed}% used (${tokens.remaining.toLocaleString('en-US')} left, resets ${acct.resetsAt ?? 'at period end'}). Long turns may be cut off by the cap before the model finishes.`,
        );
      }
    }
    if (acct.modelFunding === 'premium' && acct.canUsePremiumModels === false) {
      out.push(
        `⚠️ Model "${acct.model}" is a premium/metered model but this plan is NOT entitled to premium models — the gateway rejects it (402) or falls back to the plan pool, which is why answers look weaker than the picked model implies.`,
      );
    }
    if ((acct.byoProviders?.length ?? 0) === 0 && free) {
      out.push('ℹ️ No bring-your-own provider accounts connected, so every turn spends the plan allowance above. Connecting your own Claude/OpenAI account makes turns $0 against the plan.');
    }
  }
  return out;
}

/**
 * Render the diagnostics block as Markdown lines (no trailing blank line). Every field
 * is best-effort: an absent value is shown as "unknown"/"none" rather than omitted, so
 * the reader can tell "not gathered" from "genuinely empty".
 */
export function formatChatDiagnostics(d: ChatDiagnosticsData): string[] {
  const lines: string[] = ['## Chat diagnostics'];
  if (d.surface) lines.push(`- Surface: ${d.surface}`);
  lines.push(`- Chat: ${d.chatTitle?.trim() ? `"${d.chatTitle.trim()}"` : 'Untitled'}${d.chatId != null ? ` (#${d.chatId})` : ''}${d.chatVisibility ? ` · ${d.chatVisibility}` : ''}`);
  lines.push(`- Chat's project: ${fmtProject(d.projectId, d.projectName)}`);
  if (d.selectedProjectId != null && d.selectedProjectId !== d.projectId) {
    lines.push(`- Panel's selected project: #${d.selectedProjectId}`);
  }
  lines.push(`- Tenant: ${d.tenantId != null ? `#${d.tenantId}` : 'unknown'} · User: ${d.userId ?? 'unknown'}`);

  // Account: plan, billing, quota and model entitlement. Rendered BEFORE the Evermind
  // block because it explains a whole class of "the model is dumb / it stopped
  // answering" reports that have nothing to do with wiring — a free, card-less tenant
  // out of tokens looks exactly like a broken install until these numbers are stated.
  const acct = d.account;
  if (acct) {
    lines.push(
      `- Plan: ${acct.plan ?? 'unknown'}`
        + ` · billing ${acct.billingStatus ?? 'none'}${acct.billingStatus === 'none' || acct.billingStatus == null ? ' (no payment method on file)' : ''}`
        + `${acct.canUsePremiumModels != null ? ` · premium models ${acct.canUsePremiumModels ? 'entitled' : 'NOT entitled'}` : ''}`,
    );
    lines.push(
      `- Model: ${acct.model ?? 'auto (gateway routes per turn)'}`
        + `${acct.modelFunding ? ` · funded by ${acct.modelFunding}` : ''}`
        + `${acct.planModelCount != null ? ` · ${acct.planModelCount} models in plan pool` : ''}`
        + ` · BYO accounts: ${acct.byoProviders?.length ? acct.byoProviders.join(', ') : 'none'}`,
    );
    const meters = acct.meters ?? [];
    if (meters.length) {
      lines.push(`- Usage this period${acct.periodStart ? ` (since ${acct.periodStart}` : ''}${acct.resetsAt ? `${acct.periodStart ? ', ' : ' ('}resets ${acct.resetsAt})` : acct.periodStart ? ')' : ''}:`);
      for (const m of meters) lines.push(`  - ${fmtMeter(m)}`);
    } else {
      lines.push('- Usage this period: not available (consumption snapshot unavailable)');
    }
    if (acct.extensionVersion || acct.baseUrl) {
      lines.push(`- Client: ${acct.extensionVersion ? `v${acct.extensionVersion}` : 'unknown version'}${acct.baseUrl ? ` → ${acct.baseUrl}` : ''}`);
    }
  } else {
    lines.push('- Plan / usage: not gathered (account snapshot unavailable — signed out, or the consumption endpoint failed)');
  }

  const ev = d.evermind;
  if (ev) {
    lines.push(
      `- Evermind (chat's project): v${ev.version} · ${ev.mode}`
        + `${ev.inferenceEnabled != null ? ` · inference ${ev.inferenceEnabled ? 'on' : 'off'}` : ''}`
        + ` · teacher ${ev.teacherModel ? ev.teacherModel : 'none'}`
        + `${ev.contributions != null ? ` · Learned ${ev.contributions}` : ''}`
        + `${ev.pending != null ? ` · Queued ${ev.pending}` : ''}`
        + ` · Last learned ${ev.lastLearnedAt ? ev.lastLearnedAt : 'never'}`,
    );
  } else {
    lines.push(`- Evermind (chat's project): not resolved (no project, or head unavailable)`);
  }

  if (d.lastLearn) {
    lines.push(
      `- Last turn learn gate: learned=${d.lastLearn.learned}`
        + ` · reported v${d.lastLearn.version}`
        + `${d.lastLearn.reason ? ` · reason=${d.lastLearn.reason}` : ''}`,
    );
  } else {
    lines.push('- Last turn learn gate: unknown (no assistant turn carried a learn outcome)');
  }

  const agents = d.agents ?? [];
  lines.push(`- Agents in chat (${agents.length})${agents.length ? ': ' + agents.map((a) => `${a.agentRef} (${a.role})`).join(', ') : ''}`);

  const tickets = d.tickets ?? [];
  if (tickets.length) {
    lines.push(`- Linked tickets (${tickets.length}):`);
    for (const tk of tickets) {
      lines.push(`  - ${tk.kind} #${tk.ref}${tk.label ? ` "${tk.label}"` : ''}${tk.linkType || tk.status ? ` [${[tk.linkType, tk.status].filter(Boolean).join(', ')}]` : ''}`);
    }
  } else {
    lines.push('- Linked tickets (0)');
  }

  const signals = diagnosticsSignals(d);
  if (signals.length) {
    lines.push('', '### Signals');
    for (const s of signals) lines.push(`- ${s}`);
  }
  return lines;
}
