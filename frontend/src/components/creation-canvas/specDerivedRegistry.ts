/**
 * The spec vocabularies, LOWERED into registry entries.
 *
 * ── WHY THIS IS NOT IN `creationObjectRegistry.ts` ───────────────────────────────
 * That file is a LIST — ninety inline object definitions plus their actions, mutable
 * fields and AI-context fields. This is a DERIVATION: five vocabularies, each declaring
 * its kinds once in `lib/*Objects.ts`, mechanically turned into the shape the registry's
 * arrays expect. Two different jobs, and keeping both in one file pushed it past the
 * 800-line architecture ratchet — the ratchet doing exactly what it exists for, rather
 * than an obstacle to route around.
 *
 * ── THE DUPLICATION THIS REMOVED ─────────────────────────────────────────────────
 * Five vocabularies had five copies of the same eleven-line `.map()` — kind, label,
 * icon, group, and a `createData` that spreads the seed — differing only in which label
 * map they read. They were written one at a time, by different passes, and had already
 * drifted: two used a bare `LABELS[kind]` that yields `undefined` for a forgotten label
 * (an unidentifiable blank card), one used `?? spec.kind` (the name, which is ugly and
 * obvious), and four typed their mutable-field map as `Record<string, …>` — an index
 * signature, which satisfies ANY key, so the registry's exhaustiveness check had
 * silently stopped verifying them. One `lower()` fixes all three and a sixth vocabulary
 * costs one line.
 */

import type {
  AcademicObjectKind, DataScienceObjectKind, FounderObjectKind, HiringObjectKind,
  LegalObjectKind, OperationsObjectKind, PeopleObjectKind, SharedObjectKind,
} from '@builderforce/creation-canvas-contract';
import { OPERATIONS_LABELS, OPERATIONS_OBJECT_SPECS, OPERATIONS_STATUSES } from '@/lib/operationsObjects';
import { ACADEMIC_LABELS, ACADEMIC_OBJECT_SPECS, ACADEMIC_STATUSES } from '@/lib/academicObjects';
import { DATA_SCIENCE_LABELS, DATA_SCIENCE_OBJECT_SPECS, DATA_SCIENCE_STATUSES } from '@/lib/dataScienceObjects';
import { FOUNDER_OBJECT_SPECS } from '@/lib/founderObjects';
import { HIRING_LABELS, HIRING_OBJECT_SPECS, HIRING_STATUSES } from '@/lib/hiringObjects';
import { LEGAL_LABELS, LEGAL_OBJECT_SPECS, LEGAL_STATUSES } from '@/lib/legalObjects';
import { PEOPLE_LABELS, PEOPLE_OBJECT_SPECS, PEOPLE_STATUSES } from '@/lib/peopleObjects';
import { SHARED_LABELS, SHARED_OBJECT_SPECS, SHARED_STATUSES } from '@/lib/sharedCanvasObjects';
import { specMutableFieldMap, type SpecObjectSpec } from '@/lib/specObjects';
import type { CreationNodeData, CreationObjectGroup, CreationObjectKind } from './types';

/**
 * The registry-entry shape, restated structurally.
 *
 * `CreationObjectGroup` comes from `types.ts` rather than from the registry: that module
 * imports this one, so a type import back would be a cycle the architecture ratchet
 * counts. `types.ts` is what both already import, which is where a shared type belongs.
 */
export interface SpecRegistryEntry {
  kind: CreationObjectKind;
  label: string;
  icon: string;
  group: CreationObjectGroup;
  createData: () => CreationNodeData;
}

interface SpecVocabulary {
  specs: readonly SpecObjectSpec[];
  /** English fallback the palette shows before the i18n key resolves. */
  labels: Readonly<Record<string, string>>;
  /** English fallback for a blank object's status. */
  statuses: Readonly<Record<string, string>>;
}

/**
 * One vocabulary → registry entries.
 *
 * `labels[kind] ?? kind` rather than a bare lookup: a kind whose label was forgotten
 * renders as its own name — ugly and immediately obvious — instead of `undefined`, which
 * renders as a card nobody can identify and which nothing in the type system catches,
 * because `Record<K, string>` is satisfied by a map missing a key at a widened type.
 */
function lower({ specs, labels, statuses }: SpecVocabulary): readonly SpecRegistryEntry[] {
  return specs.map((spec) => ({
    kind: spec.kind as CreationObjectKind,
    label: labels[spec.kind] ?? spec.kind,
    icon: spec.icon,
    group: spec.group as CreationObjectGroup,
    createData: (): CreationNodeData => ({
      kind: spec.kind as CreationObjectKind,
      title: labels[spec.kind] ?? spec.kind,
      status: statuses[spec.defaultStatus] ?? spec.defaultStatus,
      ...(spec.seed ?? {}),
    }),
  }));
}

/**
 * The founder vocabulary's label and status fallbacks.
 *
 * They live here rather than in `founderObjects.ts` because they are the PALETTE's
 * English, not the spec's — every other vocabulary exports its own pair and this one has
 * simply always been declared beside the registry. The palette localizes through
 * `creationCanvas.founder.label.*`; these are never the translated string.
 */
const FOUNDER_LABELS: Record<FounderObjectKind, string> = {
  company: 'Company', competitor: 'Competitor', customerSegment: 'Customer segment',
  gtmPlan: 'GTM plan', battlecard: 'Battlecard', customerInterview: 'Customer interview',
  experiment: 'Experiment', decision: 'Decision', objective: 'Objective',
  liveMetric: 'Live metric', trigger: 'Trigger', pricing: 'Pricing',
  capTable: 'Cap table', fundingRound: 'Funding round', investorUpdate: 'Investor update',
  dataRoom: 'Data room', contract: 'Contract',
  budget: 'Budget', forecast: 'Forecast', invoice: 'Invoice', bill: 'Bill',
  account: 'Account',
};

const FOUNDER_STATUSES: Record<string, string> = {
  describeBusiness: 'Describe your business', researching: 'Researching', sizing: 'Sizing',
  draft: 'Draft', scheduled: 'Scheduled', designing: 'Designing', open: 'Open',
  bindMetric: 'Bind a metric', armed: 'Armed', planning: 'Planning', assembling: 'Assembling',
  // A budget's default is `drafting`, never `approved`: the whole value of a budget is
  // that it was agreed and then stopped moving, so a default claiming agreement would
  // make the object lie about the one property it exists to carry.
  drafting: 'Drafting', modelling: 'Modelling', received: 'Received',
  // An account starts a PROSPECT, never a customer: the whole point of the kind is that
  // it says what a party is to us, and a default claiming a won account would make the
  // card lie about the one field it exists to carry — the same argument `budget`'s
  // `drafting` default makes one line up.
  prospect: 'Prospect',
};

export const FOUNDER_REGISTRY = lower({ specs: FOUNDER_OBJECT_SPECS, labels: FOUNDER_LABELS, statuses: FOUNDER_STATUSES });
/** Twenty-five kinds and no branch: the whole teaching and research vocabulary costs
 *  this line, because the node body, the AI field contract, the mutable/context lists
 *  and the empty-shell rule all read the one declaration. */
export const ACADEMIC_REGISTRY = lower({ specs: ACADEMIC_OBJECT_SPECS, labels: ACADEMIC_LABELS, statuses: ACADEMIC_STATUSES });
/** The recruiter's funnel, sourcing to fee — nine kinds, no render branches. */
export const HIRING_REGISTRY = lower({ specs: HIRING_OBJECT_SPECS, labels: HIRING_LABELS, statuses: HIRING_STATUSES });
/** Twelve HR kinds, of which the last is `form`: the collection primitive that closes
 *  the largest "idea to REAL" break the canvas had — it could author anything and
 *  collect nothing back from a human. */
export const PEOPLE_REGISTRY = lower({ specs: PEOPLE_OBJECT_SPECS, labels: PEOPLE_LABELS, statuses: PEOPLE_STATUSES });
/** The cross-domain kinds (`funnel` today). */
export const SHARED_REGISTRY = lower({ specs: SHARED_OBJECT_SPECS, labels: SHARED_LABELS, statuses: SHARED_STATUSES });
/** The four stages after the data — analysis, model, evaluation, ship. Six kinds, and
 *  the reason the board can now hold a loss curve, a labelled eval set and a versioned
 *  prompt instead of describing them in a `document`. */
export const DATA_SCIENCE_REGISTRY = lower({ specs: DATA_SCIENCE_OBJECT_SPECS, labels: DATA_SCIENCE_LABELS, statuses: DATA_SCIENCE_STATUSES });
/** The operation a vertical company SELLS — thirteen kinds serving field service,
 *  property, clinical, fleet, logistics, manufacturing and professional practice from
 *  one vocabulary, because the industry is a value and not a kind. See `operations.ts`. */
export const OPERATIONS_REGISTRY = lower({ specs: OPERATIONS_OBJECT_SPECS, labels: OPERATIONS_LABELS, statuses: OPERATIONS_STATUSES });
/** The secure legal FILE — one kind, uploaded and encrypted rather than authored.
 *  See `legalObjects.ts` for why it is not folded into `contract`. */
export const LEGAL_REGISTRY = lower({ specs: LEGAL_OBJECT_SPECS, labels: LEGAL_LABELS, statuses: LEGAL_STATUSES });

/**
 * The authorable fields per vocabulary.
 *
 * `specMutableFields` is what keeps a `derived` field out of the authorable list, and a
 * `restricted` one out of both — which is why "an LLM cannot write a performance rating,
 * a case outcome, or a candidate's self-identification" is a property of the declaration
 * rather than a rule somebody has to remember inside a tool handler.
 */
export const FOUNDER_MUTABLE_FIELDS = specMutableFieldMap<FounderObjectKind>(FOUNDER_OBJECT_SPECS);
export const ACADEMIC_MUTABLE_FIELDS = specMutableFieldMap<AcademicObjectKind>(ACADEMIC_OBJECT_SPECS);
export const HIRING_MUTABLE_FIELDS = specMutableFieldMap<HiringObjectKind>(HIRING_OBJECT_SPECS);
export const PEOPLE_MUTABLE_FIELDS = specMutableFieldMap<PeopleObjectKind>(PEOPLE_OBJECT_SPECS);
export const SHARED_MUTABLE_FIELDS = specMutableFieldMap<SharedObjectKind>(SHARED_OBJECT_SPECS);
export const DATA_SCIENCE_MUTABLE_FIELDS = specMutableFieldMap<DataScienceObjectKind>(DATA_SCIENCE_OBJECT_SPECS);
export const OPERATIONS_MUTABLE_FIELDS = specMutableFieldMap<OperationsObjectKind>(OPERATIONS_OBJECT_SPECS);
export const LEGAL_MUTABLE_FIELDS = specMutableFieldMap<LegalObjectKind>(LEGAL_OBJECT_SPECS);

/** Actions, from the same declaration that gives each kind its fields — so a kind cannot
 *  advertise an action its body has no affordance for. */
export const SPEC_ACTIONS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  [
    ...FOUNDER_OBJECT_SPECS, ...ACADEMIC_OBJECT_SPECS, ...HIRING_OBJECT_SPECS,
    ...PEOPLE_OBJECT_SPECS, ...SHARED_OBJECT_SPECS, ...DATA_SCIENCE_OBJECT_SPECS,
    ...OPERATIONS_OBJECT_SPECS, ...LEGAL_OBJECT_SPECS,
  ].map((spec) => [spec.kind, spec.actions]),
);
