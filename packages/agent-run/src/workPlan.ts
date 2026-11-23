/** Assigned work and evidence supplied by the authenticated run host. */
export const MAX_OPEN_WORK_HOLDS = 6;

export interface AssignedWork {
  id: string;
  criteria: readonly string[];
}

export interface WorkEvidence {
  id: string;
  status: "done" | "blocked" | "in_review";
  /** Verification evidence, review handoff, or the declared blocker. */
  detail: string;
}

/** Bound to the authenticated run by its host. */
export interface RunWorkPort {
  assigned: readonly AssignedWork[];
  evidence(ids: readonly string[]): Promise<readonly WorkEvidence[]>;
}

export interface WorkLedgerItem extends AssignedWork {
  evidence?: WorkEvidence;
}

/** A snapshot gathered by an existing scoped finish check. The check retains its own hold policy. */
export function recordWorkSnapshot(
  state: { workObservations?: Record<string, WorkLedgerItem[]> },
  source: string,
  assigned: readonly AssignedWork[],
  evidence: readonly WorkEvidence[],
): void {
  state.workObservations = {
    ...state.workObservations,
    [source]: applyWorkEvidence(planWork(assigned), evidence),
  };
}

/** Children may inherit only a reference the host explicitly assigned to this owner. */
export function childWorkPort(work: RunWorkPort | undefined, ticket: string | undefined): RunWorkPort | undefined {
  if (!work || !ticket) return undefined;
  const id = ticket.trim();
  const assigned = planWork(work.assigned.filter((item) => item.id.trim() === id));
  if (!assigned.length) return undefined;
  return {
    assigned,
    async evidence(ids) {
      if (!ids.includes(id)) return [];
      return (await work.evidence([id])).filter((item) => item.id === id);
    },
  };
}

export function planWork(assigned: readonly AssignedWork[]): WorkLedgerItem[] {
  const items = new Map<string, WorkLedgerItem>();
  for (const item of assigned) {
    const id = item.id.trim();
    if (!id) throw new Error("Assigned work requires an id");
    const criteria = [...(items.get(id)?.criteria ?? []), ...item.criteria];
    items.set(id, { id, criteria: [...new Set(criteria.map((entry) => entry.trim()).filter(Boolean))] });
  }
  return [...items.values()];
}

/** The latest scoped snapshot is authoritative. Missing items remain open. */
export function applyWorkEvidence(plan: readonly WorkLedgerItem[], evidence: readonly WorkEvidence[]): WorkLedgerItem[] {
  const byId = new Map(evidence
    .filter((item) => ["done", "blocked", "in_review"].includes(item.status) && item.detail.trim())
    .map((item) => [item.id, item]));
  return plan.map(({ id, criteria }) => {
    const current = byId.get(id);
    return { id, criteria, ...(current ? { evidence: current } : {}) };
  });
}

export function assignedWorkSection(plan: readonly WorkLedgerItem[]): string {
  const open = plan.filter((item) => !item.evidence);
  if (!open.length) return "";
  const items = open.slice(0, 15).map(({ id, criteria }) => `- ${JSON.stringify(id)}${criteria.length ? `: ${JSON.stringify(criteria).slice(0, 1500)}` : ""}`);
  if (open.length > items.length) items.push(`- ${open.length - items.length} more assigned items`);
  return items.join("\n");
}

export function outstandingWork(plan: readonly WorkLedgerItem[]): string | null {
  const section = assignedWorkSection(plan);
  return section ? `Assigned work still needs evidence. Continue the open items or record the reason each item is blocked or in review.\n${section}` : null;
}

export interface RunWorkScorecard {
  assigned: number;
  done: number;
  blocked: number;
  inReview: number;
  open: number;
}

/** A completed invocation with unresolved work is not a successful model sample. */
export function workSupportsRoutingSample(work: RunWorkScorecard | undefined, completed: boolean): boolean {
  return !completed || !work || work.open + work.blocked === 0;
}

/** Score only evidence supplied by the host. An unassigned run has no work score. */
export function evaluateRun(plan: readonly WorkLedgerItem[]): RunWorkScorecard | undefined {
  if (!plan.length) return undefined;
  const score = { assigned: plan.length, done: 0, blocked: 0, inReview: 0, open: 0 };
  for (const { evidence } of plan) {
    if (evidence?.status === "done") score.done++;
    else if (evidence?.status === "blocked") score.blocked++;
    else if (evidence?.status === "in_review") score.inReview++;
    else score.open++;
  }
  return score;
}
