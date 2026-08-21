/**
 * `offer.hire` — THE HANDOVER, and the act that ends the hiring funnel in a person.
 *
 * ── WHAT WAS BROKEN ──────────────────────────────────────────────────────────
 * Two vocabularies described this transition in prose and neither performed it. A
 * signed `offer` stayed a signed offer, and the `employee` and `employeeLifecycle`
 * cards that should follow it were typed by hand with no link back — so the board
 * held two funnels that stopped next to each other and nothing could answer "on
 * what terms was this person hired".
 *
 * ── WHY THE MAPPING IS NOT HERE ──────────────────────────────────────────────
 * `planEmploymentHandover` lives in the contract, beside both vocabularies and
 * owned by neither. This act does the three things an act is entitled to do: read
 * the board, describe the cards to place, and say what happened. Which fields
 * carry across is a contract question, and a copy of it here is the copy that
 * would drift.
 *
 * IDEMPOTENT on `offerRef`, not on a name: hiring twice from one offer must not
 * put the same person on the payroll twice, and two people genuinely do share a
 * name.
 */

import {
  employeeHiredFrom,
  employmentHandoverBlocker,
  planEmploymentHandover,
  type OnboardingStepKey,
} from '@builderforce/creation-canvas-contract';
import { actEdge, type CardAct } from '@/domains/canvas/application/CardAct';
import { resolveObjectRef } from '@/domains/canvas/domain/canvasBoard';
import type { CreationObjectKind } from '@/domains/canvas/domain/canvasObject';

export const hireFromOfferAct: CardAct = {
  kind: 'offer' as CreationObjectKind,
  actions: ['hire'],
  run({ object: offer, board, t }) {
    const all = board.objects;
    const data = offer.data as unknown as Record<string, unknown>;
    const candidate = resolveObjectRef(all, 'candidate' as CreationObjectKind, data.candidateRef);
    const posting = resolveObjectRef(all, 'jobPosting' as CreationObjectKind, data.postingRef)
      // An offer with no posting of its own inherits the candidate's: the candidate
      // was considered FOR a requisition, and re-typing the reference onto the offer
      // to make the join work would be the same fact in two places.
      ?? resolveObjectRef(all, 'jobPosting' as CreationObjectKind, candidate?.data.postingRef);

    const blocker = employmentHandoverBlocker({
      offer: data,
      candidate: (candidate?.data ?? null) as Record<string, unknown> | null,
    });
    if (blocker) return { notice: t(`noticeHire${blocker[0]!.toUpperCase()}${blocker.slice(1)}`) };

    const existing = employeeHiredFrom(
      all.filter((node) => node.data.kind === 'employee').map((node) => node.data as unknown as Record<string, unknown>),
      offer.id,
    );
    if (existing) return { notice: t('noticeHireAlready', { person: String(existing.personRef ?? '') }) };

    const plan = planEmploymentHandover({
      offer: data,
      candidate: (candidate?.data ?? null) as Record<string, unknown> | null,
      posting: (posting?.data ?? null) as Record<string, unknown> | null,
      offerRef: offer.id,
      stepLabel: (key: OnboardingStepKey) => t(`hiring.onboardingStep.${key}`),
    });

    const employee = board.create('employee' as CreationObjectKind, { x: offer.position.x + 460, y: offer.position.y });
    employee.data = { ...employee.data, ...plan.employee, title: plan.personRef, status: t('hiringHiredStatus', { date: String(plan.employee.startedAt ?? '') }) };
    const lifecycle = board.create('employeeLifecycle' as CreationObjectKind, { x: offer.position.x + 460, y: offer.position.y + 260 });
    lifecycle.data = { ...lifecycle.data, ...plan.lifecycle, title: t('hiringOnboardingTitle', { person: plan.personRef }) };

    return {
      patch: { status: t('hiringOfferHiredStatus') },
      add: {
        nodes: [employee, lifecycle],
        edges: [
          actEdge(offer, employee, t('hiringHiredEdge'), 'delivery'),
          actEdge(employee, lifecycle, t('hiringOnboardingEdge'), 'membership'),
        ],
      },
      notice: t('noticeHired', { person: plan.personRef, steps: ((plan.lifecycle.steps as unknown[]) ?? []).length }),
    };
  },
};

export const HIRING_CARD_ACTS: readonly CardAct[] = [hireFromOfferAct];
