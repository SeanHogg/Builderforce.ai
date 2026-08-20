/**
 * accountabilityGaps — THE one classification of "what is wrong with this ticket's
 * participation", derived from the manifest slots and the sign-off ledger.
 *
 * Split out of `getAccountability` (which is DB + cache bound) so the rule itself is
 * pure and unit-testable, the same way `participantStates` and `signoffGate` are.
 *
 * Two things it fixes about the old inline version:
 *
 *  1. A gap identified only its ROLE. A ticket routinely carries the same role twice
 *     (Architect as owner AND as reviewer), so the banner showed two identical lines
 *     that matched no particular row in the table below it.
 *  2. Every unsatisfied slot was a red "gap", including ones the table showed as
 *     `Assigned` / `In progress`. Work that simply has not got there yet is already
 *     reported by "{done} of {total} required roles signed off"; reporting it a second
 *     time as an error is what made the header and the table disagree. Those are now
 *     `advisory`, and only genuinely-wrong states are `blocking`.
 */
import type { AccountabilitySignoff, AccountabilityGap, AccountabilityGapKind, ManifestParticipant } from './ticketParticipants';
import { isParticipantSatisfied } from './participantStates';
import { hasLinkedEvidence, isAutoAttestedContribution } from './signoffContribution';

/** Severity buckets. `blocking` = something is wrong; `advisory` = outstanding or reasoned. */
export type AccountabilityGapSeverity = 'blocking' | 'advisory';

/** Slot key shared by the manifest (`stageKey`) and the ledger (`laneKey`). */
export const slotKey = (lane: string | null, roleKey: string): string => `${lane ?? ''}:${roleKey}`;

/**
 * True when the sign-off carries at least one piece of linked evidence.
 *
 * Delegates to the shared {@link hasLinkedEvidence}, which excludes PROVENANCE keys.
 * The inline version this replaced counted any non-null value, so a bag containing only
 * `autoAttested: true` — the flag that marks an approval as *not* judged by a member —
 * satisfied the rubber-stamp check on its own.
 */
export function hasContribution(s: Pick<AccountabilitySignoff, 'contribution'>): boolean {
  return hasLinkedEvidence(s.contribution as Record<string, unknown> | null | undefined);
}

export function computeAccountabilityGaps(
  participants: ManifestParticipant[],
  latestSignoffs: AccountabilitySignoff[],
): AccountabilityGap[] {
  const slotOf = new Map<string, ManifestParticipant>();
  for (const p of participants) slotOf.set(slotKey(p.stageKey, p.roleKey), p);

  const gaps: AccountabilityGap[] = [];
  const slotGap = (
    p: ManifestParticipant,
    kind: AccountabilityGapKind,
    severity: AccountabilityGapSeverity,
    detail: string,
    reason: string | null = null,
  ): AccountabilityGap => ({
    kind, severity, roleKey: p.roleKey, roleName: p.roleName,
    stageKey: p.stageKey, responsibility: p.responsibility, state: p.state, reason, detail,
  });

  for (const p of participants.filter((x) => x.required)) {
    if (p.state === 'unstaffed') {
      gaps.push(slotGap(p, 'unstaffed', 'blocking', 'No capable resource is available for this required role.'));
    } else if (p.state === 'changes_requested') {
      gaps.push(slotGap(p, 'changes_requested', 'blocking', 'Changes were requested and not yet resolved.'));
    } else if (p.state === 'in_progress') {
      gaps.push(slotGap(p, 'unsigned', 'advisory', 'Work is in progress; sign-off not recorded yet.'));
    } else if (!isParticipantSatisfied(p.state)) {
      gaps.push(slotGap(p, 'unsigned', 'advisory', 'Required role has not signed off.'));
    }
  }

  for (const s of latestSignoffs) {
    const p = slotOf.get(slotKey(s.laneKey, s.roleKey));
    // The ledger's role name wins: it records the role as signed, even if the slot it
    // belonged to has since been re-derived away.
    const at = (kind: AccountabilityGapKind, severity: AccountabilityGapSeverity, detail: string, reason: string | null = null): AccountabilityGap =>
      p ? { ...slotGap(p, kind, severity, detail, reason), roleName: s.roleName }
        : { kind, severity, roleKey: s.roleKey, roleName: s.roleName, stageKey: s.laneKey, responsibility: null, state: null, reason, detail };

    if (s.verdict === 'approved' && !hasContribution(s)) {
      gaps.push(at('no_contribution', 'blocking', 'Approved with no linked contribution/interaction — a rubber-stamp risk.'));
    }
    // AUTO-ATTESTED ≠ REVIEWED, and the audit now says so out loud.
    //
    // `attestRoleRun` credits a PRODUCER's completed run to the ledger so the slot can
    // leave `in_progress` without the agent volunteering a `kanban.signoff` call. That
    // is a real record — it always links the execution it came from, so it is not a
    // rubber stamp and must NOT be `blocking` — but nobody judged the work. Reported as
    // ADVISORY so "how much of this ticket's accountability was asserted by the platform
    // rather than by a member" is answerable from the same list a reviewer already reads.
    if (s.verdict === 'approved' && isAutoAttestedContribution(s.contribution as Record<string, unknown> | null | undefined)) {
      gaps.push(at('auto_attested', 'advisory',
        'Credited automatically from a completed run — no member recorded a verdict of their own.'));
    }
    // A waiver WITH a recorded reason is a decision, not a defect; without one it is.
    if (s.verdict === 'waived') {
      gaps.push(s.waiveReason
        ? at('waived', 'advisory', `Waived: ${s.waiveReason}`, s.waiveReason)
        : at('waived', 'blocking', 'Waived without a recorded reason.'));
    }
  }

  return gaps;
}
