/**
 * THE academic-object specification — one declaration per kind (see `specObjects.ts`).
 *
 * ── WHAT THE CANVAS COULD NOT DO BEFORE THIS ─────────────────────────────────────
 * It could author a course and could not TEACH one. Progress lived on the artifact —
 * `course.completedLessonIds`, `practice.attempts` — which is right for one learner and
 * structurally wrong for a class: one board meant one progress record, so material
 * could be written and never handed out, marked, or read for who is struggling.
 *
 * It could analyse data and could not do RESEARCH. A grant, an ethics approval, a
 * pre-registration, a protocol, a consent form, a manuscript and a peer review are the
 * gates an academic's "idea to real" actually passes through, and the board had none
 * of them — so everything before the dataset and after the chart fell out of the
 * product and back into email.
 *
 * And it could render neither of the two things scholarship is written in: a citation
 * and an equation.
 *
 * ── THE DERIVED-FIELD RULE, WHICH IS THE WHOLE INTEGRITY STORY ───────────────────
 * Marks, integrity ledgers, attendance, response counts and coverage are declared
 * `derived`, so `specMutableFields` omits them and no LLM patch can assert one. This
 * is not a style preference. A model that can write `submission.mark` can award a
 * grade nobody earned, and a model that can write `submission.integrity` can erase the
 * record of its own contribution — which is precisely the evidence the object exists
 * to carry. The rule generalises the one `canvasPractice` already made for `attempts`.
 *
 * ── WHY SO MANY KINDS RATHER THAN A FEW WITH A `type` FIELD ──────────────────────
 * Because they have different OWNERS and different LIFETIMES, which is the test §0 of
 * the data-model rule actually applies. A `rubric` is an instrument reused for five
 * years; a `gradebook` belongs to one cohort for one term. An `assignment` is written
 * once by staff; a `submission` is written by each of two hundred learners. Folding
 * either pair together makes one row that many people must write at once — a repeating
 * group with a shared editor, which is the shape normalisation exists to refuse.
 */

import { ACADEMIC_OBJECT_KINDS, type AcademicObjectKind } from '@builderforce/creation-canvas-contract';
import {
  registerSpecObjectSet, SOURCES_FIELD, SUMMARY_FIELD,
  type SpecField, type SpecObjectSpec,
} from './specObjects';

/** i18n namespace for every academic label, status, field and column. */
export const ACADEMIC_NAMESPACE = 'creationCanvas.academic';

/** Shared hints, written once because the same instruction is load-bearing in several
 *  places and a paraphrase of it is how two objects come to disagree about a date. */
const ISO_DATE = 'ISO 8601 date (or date-time where the hour matters). Never a relative phrase like "next Friday" — the board computes lateness from this.';
const OUTCOME_HINT = 'Learning-outcome codes this maps to, exactly as the curriculumMap writes them, e.g. ["LO3", "LO7"]. Matching codes is what makes accreditation coverage computable instead of asserted.';

/**
 * A reference to a person on the roster.
 *
 * A REF, never a name: two learners share a name, names change, and a mark attached to
 * a name cannot be defended at an appeal. `learnerName` sits beside it for display only
 * — the board joins on `learnerRef`.
 */
const LEARNER_REF: SpecField = {
  name: 'learnerRef',
  render: 'stat',
  label: 'learnerRef',
  hint: 'Stable identifier for one learner on the cohort roster (student number or the roster row `ref`). Never a display name — a mark joined on a name cannot survive two people called J. Smith.',
};

export const ACADEMIC_OBJECT_SPECS: readonly SpecObjectSpec[] = [
  // ══ TEACHING ══════════════════════════════════════════════════════════════════
  {
    kind: 'cohort',
    icon: '⌸',
    group: 'Teaching',
    defaultStatus: 'noRoster',
    actions: ['import', 'sync', 'message'],
    fields: [
      { name: 'courseCode', render: 'stat', label: 'courseCode', hint: 'The institution\'s own code for the module, e.g. "PHYS2041". This is the key every other system joins on.' },
      { name: 'term', render: 'stat', label: 'term', hint: 'The teaching period, e.g. "2026 Semester 2".' },
      { name: 'enrolledCount', render: 'stat', label: 'enrolledCount', hint: 'Number of enrolled learners as an integer. Derived from the roster when one is loaded.' },
      { name: 'deliveryMode', render: 'stat', label: 'deliveryMode', hint: 'in-person | online | hybrid. Decides whether attendance and office hours are physical or not.' },
      { name: 'instructors', render: 'chips', label: 'instructors', hint: 'Teaching staff and their role, e.g. ["Prof. A. Rao (lead)", "M. Diaz (tutor)"].' },
      {
        name: 'roster', render: 'rows', label: 'roster',
        columns: ['ref', 'name', 'email', 'group', 'status'],
        hint: 'One row per enrolled learner: {ref, name, email, group, status}. `ref` is the stable student identifier every submission and mark joins on. `group` is the tutorial or project group. `status` is enrolled | withdrawn | auditing. Import it rather than typing it — canvas_import_roster reads a CSV or a connected LMS.',
      },
      { name: 'meetingPattern', render: 'text', label: 'meetingPattern', hint: 'When and where the class meets, in the words the timetable uses.' },
      { name: 'progress', render: 'meter', label: 'progress', hint: 'Share of the cohort meeting expected progress, 0-100.', derived: true },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'assignment',
    icon: '✎',
    group: 'Teaching',
    defaultStatus: 'draftBrief',
    actions: ['publish', 'distribute', 'collect', 'mark'],
    fields: [
      { name: 'brief', render: 'text', label: 'brief', hint: 'What the learner is actually asked to do, in full. This is the object\'s substance — an assignment with a title and no brief is a deadline with nothing attached to it.' },
      { name: 'cohortRef', render: 'stat', label: 'cohortRef', hint: 'Title or courseCode of the cohort object this is set for.' },
      { name: 'releaseAt', render: 'stat', label: 'releaseAt', hint: `When learners can see it. ${ISO_DATE}` },
      { name: 'dueAt', render: 'stat', label: 'dueAt', hint: `The deadline. ${ISO_DATE}` },
      { name: 'weight', render: 'stat', label: 'weight', hint: 'Percentage of the module\'s final mark this assignment carries.' },
      { name: 'maxMarks', render: 'stat', label: 'maxMarks', hint: 'Marks available, as a number. The rubric must total to this or the gradebook will say so.' },
      { name: 'attemptsAllowed', render: 'stat', label: 'attemptsAllowed', hint: 'How many submissions a learner may make. 1 for most summative work.' },
      {
        name: 'assessmentMode', render: 'stat', label: 'assessmentMode',
        hint: 'open | assisted | closed. `closed` disables the assistant on every distributed board — this is the setting that makes an exam an exam. `assisted` allows it and records every turn on the learner\'s integrity ledger. Choose deliberately; the default is `open` and that is wrong for anything summative.',
      },
      { name: 'rubricRef', render: 'stat', label: 'rubricRef', hint: 'Title of the rubric object marks are awarded against. Without it, marking is a number with no defensible basis.' },
      { name: 'outcomes', render: 'chips', label: 'outcomes', hint: OUTCOME_HINT },
      { name: 'latePolicy', render: 'text', label: 'latePolicy', hint: 'What happens after the deadline, stated as a rule the board can apply: e.g. "-5% per day, zero after 5 days".' },
      { name: 'deliverables', render: 'list', label: 'deliverables', hint: 'What must be handed in: [{title, detail}] where detail names the format and any length limit.' },
      { name: 'submissionCount', render: 'stat', label: 'submissionCount', hint: 'Submissions received so far.', derived: true },
      { name: 'markedCount', render: 'stat', label: 'markedCount', hint: 'Submissions marked so far.', derived: true },
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'rubric',
    icon: '⊞',
    group: 'Teaching',
    defaultStatus: 'noCriteria',
    actions: ['validate', 'apply', 'export'],
    fields: [
      { name: 'levels', render: 'chips', label: 'levels', hint: 'The achievement levels, worst to best, e.g. ["Fail", "Pass", "Credit", "Distinction", "High Distinction"]. Order matters — the marking grid reads them left to right.' },
      {
        name: 'criteria', render: 'matrix', label: 'criteria',
        hint: 'The marking grid as {columns, rows}: `columns` are the level names, and each row is {label, weight, cells} where `label` is the criterion, `weight` is its share of the total marks, and `cells` are the DESCRIPTORS — one per level, saying what work at that level looks like. Descriptors are the entire value of a rubric: a grid of bare level names marks nothing and cannot be defended at an appeal.',
      },
      { name: 'totalMarks', render: 'stat', label: 'totalMarks', hint: 'Marks the grid totals to. Must equal the assignment\'s maxMarks.' },
      { name: 'moderationRule', render: 'text', label: 'moderationRule', hint: 'When a second marker is required and how disagreement is resolved, e.g. "double-blind for all fails and all HDs; >10 mark gap goes to a third marker".' },
      { name: 'outcomes', render: 'chips', label: 'outcomes', hint: OUTCOME_HINT },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'submission',
    icon: '⇧',
    group: 'Teaching',
    defaultStatus: 'notSubmitted',
    actions: ['submit', 'mark', 'moderate', 'return'],
    fields: [
      LEARNER_REF,
      { name: 'learnerName', render: 'stat', label: 'learnerName', hint: 'Display name. Never joined on — see learnerRef.' },
      { name: 'assignmentRef', render: 'stat', label: 'assignmentRef', hint: 'Title of the assignment object this answers.' },
      { name: 'submittedAt', render: 'stat', label: 'submittedAt', hint: `When it was handed in. ${ISO_DATE}` },
      { name: 'attempt', render: 'stat', label: 'attempt', hint: 'Which attempt this is, as an integer starting at 1.' },
      { name: 'artifacts', render: 'list', label: 'artifacts', hint: 'What was handed in: [{title, detail}] where title names the canvas object or file and detail is its type.' },
      {
        name: 'declaration', render: 'text', label: 'declaration',
        hint: 'The learner\'s own statement of how they produced this work, including what assistance they used. Authored BY THE LEARNER — never write one on their behalf, because a declaration somebody else wrote is not a declaration.',
      },
      {
        name: 'integrity', render: 'rows', label: 'integrity',
        columns: ['source', 'edits', 'characters', 'firstAt', 'lastAt'],
        hint: 'The authorship ledger the canvas itself writes: one row per source (learner | assistant | imported | collaborator) with how many edits and characters came from it and when. This is evidence, not an estimate.',
        derived: true,
      },
      { name: 'mark', render: 'stat', label: 'mark', hint: 'Awarded mark. Written by the marking action against the rubric.', derived: true },
      { name: 'markBreakdown', render: 'rows', label: 'markBreakdown', columns: ['criterion', 'level', 'marks', 'comment'], hint: 'Per-criterion marks and the comment given.', derived: true },
      { name: 'feedback', render: 'text', label: 'feedback', hint: 'The feedback returned to the learner.', derived: true },
      { name: 'lateBy', render: 'stat', label: 'lateBy', hint: 'How late the submission was, computed from the assignment deadline.', derived: true },
    ],
  },
  {
    kind: 'gradebook',
    icon: '▦',
    group: 'Teaching',
    defaultStatus: 'noMarks',
    actions: ['compute', 'moderate', 'export', 'publish'],
    fields: [
      { name: 'cohortRef', render: 'stat', label: 'cohortRef', hint: 'Title or courseCode of the cohort these marks belong to.' },
      { name: 'assignments', render: 'chips', label: 'assignments', hint: 'Titles of the assignment objects aggregated here, in the order they should appear as columns.' },
      { name: 'gradeBands', render: 'rows', label: 'gradeBands', columns: ['grade', 'minimum', 'maximum'], hint: 'The institution\'s grade scale: {grade, minimum, maximum} as percentages. Without it a gradebook reports numbers and cannot report grades.' },
      { name: 'marks', render: 'matrix', label: 'marks', hint: 'The marks matrix: `columns` are assignment titles and each row is {label, ref, cells} for one learner. Computed from the submission objects.', derived: true },
      { name: 'distribution', render: 'bars', label: 'distribution', hint: 'Count of learners per grade band.', derived: true },
      { name: 'mean', render: 'stat', label: 'mean', hint: 'Cohort mean, as a percentage.', derived: true },
      { name: 'median', render: 'stat', label: 'median', hint: 'Cohort median, as a percentage.', derived: true },
      { name: 'passRate', render: 'meter', label: 'passRate', hint: 'Share of the cohort at or above the pass band, 0-100.', derived: true },
      { name: 'moderation', render: 'rows', label: 'moderation', columns: ['learnerRef', 'firstMark', 'secondMark', 'gap', 'agreed'], hint: 'Double-marking record: {learnerRef, firstMark, secondMark, gap, agreed}. The gap column is what a moderation meeting actually works through.', derived: true },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'accommodation',
    icon: '♿',
    group: 'Teaching',
    defaultStatus: 'notApproved',
    actions: ['approve', 'apply'],
    fields: [
      LEARNER_REF,
      { name: 'provisions', render: 'chips', label: 'provisions', hint: 'The adjustments granted, e.g. ["25% extra time", "screen-reader compatible materials", "rest breaks"]. Specific enough that the board can apply them without interpretation.' },
      { name: 'extraTimePercent', render: 'stat', label: 'extraTimePercent', hint: 'Additional time as a percentage. The board extends timed assessments by exactly this.' },
      { name: 'formats', render: 'chips', label: 'formats', hint: 'Alternative formats required, e.g. ["tagged PDF", "captioned video", "plain text"]. Every distributed artifact is checked against this list.' },
      { name: 'approvedBy', render: 'stat', label: 'approvedBy', hint: 'The office that granted it. An accommodation applied without an approver is not an accommodation, it is a favour.' },
      { name: 'expiresAt', render: 'stat', label: 'expiresAt', hint: `When it lapses and must be reviewed. ${ISO_DATE}` },
      {
        name: 'evidenceHeld', render: 'verdict', label: 'evidenceHeld',
        hint: 'held | not-required | pending — whether supporting documentation exists, WITHOUT reproducing it. Never record a diagnosis, a condition or a medical document here: the board needs to know an adjustment is authorised, not why.',
      },
    ],
  },
  {
    kind: 'feedbackBank',
    icon: '☰',
    group: 'Teaching',
    defaultStatus: 'empty',
    actions: ['apply', 'export'],
    fields: [
      { name: 'rubricRef', render: 'stat', label: 'rubricRef', hint: 'Title of the rubric these comments are written against.' },
      {
        name: 'comments', render: 'rows', label: 'comments',
        columns: ['code', 'criterion', 'level', 'comment', 'nextStep'],
        hint: 'Reusable feedback: {code, criterion, level, comment, nextStep}. `nextStep` is what the learner should DO — a bank of judgements with no next steps speeds up marking and teaches nothing.',
      },
      { name: 'tone', render: 'text', label: 'tone', hint: 'How comments should read, so a bank used by five tutors sounds like one module.' },
      { name: 'usageCount', render: 'stat', label: 'usageCount', hint: 'How many times comments from this bank have been applied.', derived: true },
    ],
  },
  {
    kind: 'lecture',
    icon: '▤',
    group: 'Teaching',
    defaultStatus: 'planning',
    actions: ['present', 'record', 'attend'],
    fields: [
      { name: 'sessionAt', render: 'stat', label: 'sessionAt', hint: `When the session runs. ${ISO_DATE}` },
      { name: 'durationMinutes', render: 'stat', label: 'durationMinutes', hint: 'Scheduled length in minutes.' },
      { name: 'outcomes', render: 'chips', label: 'outcomes', hint: OUTCOME_HINT },
      { name: 'outline', render: 'list', label: 'outline', hint: 'The running order: [{title, detail}] where detail carries the timing and the activity. This is the object\'s substance.' },
      { name: 'materials', render: 'list', label: 'materials', hint: 'What learners need: [{title, detail}] naming the canvas object, reading or dataset.' },
      { name: 'recordingUrl', render: 'stat', label: 'recordingUrl', hint: 'Where the recording is published.' },
      { name: 'captionsUrl', render: 'stat', label: 'captionsUrl', hint: 'Where the captions are. A recording published without captions cannot lawfully be distributed to a class — the accessibility audit fails the object until this exists.' },
      { name: 'attendanceCount', render: 'stat', label: 'attendanceCount', hint: 'Learners present.', derived: true },
      { name: 'attendanceRate', render: 'meter', label: 'attendanceRate', hint: 'Attendance as a share of the cohort, 0-100.', derived: true },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'poll',
    icon: '◍',
    group: 'Teaching',
    defaultStatus: 'notOpened',
    actions: ['open', 'close', 'reveal'],
    fields: [
      { name: 'question', render: 'verdict', label: 'question', hint: 'The question asked, in one sentence. A good lecture poll tests a misconception, not a definition.' },
      { name: 'choices', render: 'chips', label: 'choices', hint: 'The options, in display order. Distractors should each correspond to a real way of being wrong.' },
      { name: 'correctIndex', render: 'stat', label: 'correctIndex', hint: 'Zero-based index of the correct choice. Omit for an opinion poll with no right answer.' },
      { name: 'anonymity', render: 'stat', label: 'anonymity', hint: 'anonymous | identified. Identified responses count toward participation; anonymous ones get honest answers. Pick for the question being asked.' },
      { name: 'openedAt', render: 'stat', label: 'openedAt', hint: `When responses opened. ${ISO_DATE}`, bookkeeping: true },
      { name: 'closedAt', render: 'stat', label: 'closedAt', hint: `When responses closed. ${ISO_DATE}`, bookkeeping: true },
      { name: 'responses', render: 'bars', label: 'responses', hint: 'Response count per choice.', derived: true },
      { name: 'responseCount', render: 'stat', label: 'responseCount', hint: 'Total responses received.', derived: true },
      { name: 'correctRate', render: 'meter', label: 'correctRate', hint: 'Share answering correctly, 0-100. Under about 30% means re-teach now, not next week.', derived: true },
    ],
  },
  {
    kind: 'officeHours',
    icon: '◷',
    group: 'Teaching',
    defaultStatus: 'noSlots',
    actions: ['publish', 'book'],
    fields: [
      { name: 'location', render: 'stat', label: 'location', hint: 'Room, or the meeting link for online hours.' },
      { name: 'bookingPolicy', render: 'text', label: 'bookingPolicy', hint: 'Who may book, how far ahead, and what to bring.' },
      { name: 'slots', render: 'rows', label: 'slots', columns: ['startsAt', 'durationMinutes', 'mode', 'bookedBy', 'topic'], hint: 'Bookable slots: {startsAt, durationMinutes, mode, bookedBy, topic}. `bookedBy` is a learnerRef or empty.' },
      { name: 'utilisation', render: 'meter', label: 'utilisation', hint: 'Share of slots booked, 0-100.', derived: true },
    ],
  },
  {
    kind: 'curriculumMap',
    icon: '⛁',
    group: 'Teaching',
    defaultStatus: 'notMapped',
    actions: ['map', 'validate', 'export'],
    fields: [
      { name: 'programme', render: 'stat', label: 'programme', hint: 'The degree or programme this maps, e.g. "BEng (Hons) Mechanical Engineering".' },
      { name: 'accreditor', render: 'stat', label: 'accreditor', hint: 'The body the map is prepared for — ABET, AACSB, QAA, TEQSA, EQUIS. Their vocabulary decides what a level means.' },
      { name: 'reviewCycle', render: 'stat', label: 'reviewCycle', hint: 'When the next accreditation review falls.' },
      { name: 'outcomes', render: 'rows', label: 'outcomes', columns: ['code', 'outcome', 'level'], hint: 'Programme learning outcomes: {code, outcome, level}. `code` is what every assignment and lecture cites; `level` is introduced | developed | assured.' },
      {
        name: 'mapping', render: 'matrix', label: 'mapping',
        hint: 'Coverage grid as {columns, rows}: `columns` are assessment titles, each row is {label, cells} for one outcome code, and a cell holds the level at which that assessment evidences that outcome (or empty). This grid IS the accreditation submission.',
      },
      { name: 'coverage', render: 'meter', label: 'coverage', hint: 'Share of outcomes with at least one assured assessment, 0-100.', derived: true },
      { name: 'gaps', render: 'chips', label: 'gaps', hint: 'Outcome codes with no assured evidence. The list a review will open at.', derived: true },
      SOURCES_FIELD,
    ],
  },

  // ══ RESEARCH ══════════════════════════════════════════════════════════════════
  {
    kind: 'grantProposal',
    icon: '⌘',
    group: 'Research',
    defaultStatus: 'draftProposal',
    actions: ['draft', 'budget', 'submit'],
    fields: [
      { name: 'funder', render: 'stat', label: 'funder', hint: 'The funding body, e.g. "NSF", "Horizon Europe", "Wellcome Trust".' },
      { name: 'scheme', render: 'stat', label: 'scheme', hint: 'The specific call or scheme, with its identifier where one exists.' },
      { name: 'requestedAmount', render: 'stat', label: 'requestedAmount', hint: 'Total requested, including its currency, e.g. "£412,000".' },
      { name: 'durationMonths', render: 'stat', label: 'durationMonths', hint: 'Project length in months.' },
      { name: 'deadlineAt', render: 'stat', label: 'deadlineAt', hint: `Submission deadline. ${ISO_DATE}` },
      { name: 'aims', render: 'list', label: 'aims', hint: 'The specific aims: [{title, detail}]. Each must be a claim that can fail — a reviewer scores these before reading anything else.' },
      { name: 'workPackages', render: 'rows', label: 'workPackages', columns: ['package', 'lead', 'months', 'deliverable'], hint: 'One row per work package: {package, lead, months, deliverable}.' },
      { name: 'budget', render: 'rows', label: 'budget', columns: ['category', 'amount', 'justification'], hint: 'One row per cost category: {category, amount, justification}. An unjustified line is the most common reason a budget is cut.' },
      { name: 'coInvestigators', render: 'chips', label: 'coInvestigators', hint: 'Named co-investigators with their institution.' },
      { name: 'impact', render: 'text', label: 'impact', hint: 'Who benefits and how it reaches them. Funders score this separately from the science.' },
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'ethicsApproval',
    icon: '⚖',
    group: 'Research',
    defaultStatus: 'notSubmitted',
    actions: ['submit', 'record'],
    fields: [
      { name: 'committee', render: 'stat', label: 'committee', hint: 'The reviewing body — IRB, REC, HREC — named as it names itself.' },
      { name: 'referenceNumber', render: 'stat', label: 'referenceNumber', hint: 'The approval reference. Every publication and consent form must quote it.' },
      { name: 'protocolRef', render: 'stat', label: 'protocolRef', hint: 'Title of the protocol object this approval covers.' },
      { name: 'riskLevel', render: 'stat', label: 'riskLevel', hint: 'exempt | minimal | greater-than-minimal, in the committee\'s own terms.' },
      { name: 'submittedAt', render: 'stat', label: 'submittedAt', hint: `When it was submitted. ${ISO_DATE}` },
      { name: 'decisionAt', render: 'stat', label: 'decisionAt', hint: `When the decision was issued. ${ISO_DATE}` },
      { name: 'expiresAt', render: 'stat', label: 'expiresAt', hint: `When approval lapses. ${ISO_DATE} An expired approval means data collection must stop, which is why this is a field and not a note.` },
      { name: 'decision', render: 'verdict', label: 'decision', hint: 'approved | approved-with-conditions | deferred | rejected, and the date. Never record an approval that has not been issued.' },
      { name: 'conditions', render: 'list', label: 'conditions', hint: 'Conditions attached to the approval: [{title, detail}]. Each is binding.' },
      { name: 'participantsCovered', render: 'text', label: 'participantsCovered', hint: 'Which populations and procedures the approval actually covers — the boundary that decides whether a new question needs an amendment.' },
    ],
  },
  {
    kind: 'preRegistration',
    icon: '⊙',
    group: 'Research',
    defaultStatus: 'draftPlan',
    actions: ['register', 'amend'],
    fields: [
      { name: 'registry', render: 'stat', label: 'registry', hint: 'Where it is registered — OSF, AsPredicted, ClinicalTrials.gov, PROSPERO.' },
      { name: 'registrationId', render: 'stat', label: 'registrationId', hint: 'The registration identifier or DOI once issued.' },
      { name: 'registeredAt', render: 'stat', label: 'registeredAt', hint: `When it was registered. ${ISO_DATE}` },
      {
        name: 'timepoint', render: 'verdict', label: 'timepoint',
        hint: 'before-data-collection | after-collection-before-analysis | after-analysis. State it honestly: a pre-registration written after the analysis is a description, and calling it a pre-registration is misconduct.',
      },
      { name: 'hypotheses', render: 'list', label: 'hypotheses', hint: 'The stated hypotheses: [{title, detail}]. Each must be directional and falsifiable.' },
      { name: 'design', render: 'text', label: 'design', hint: 'The design in enough detail that another team could run it.' },
      { name: 'sampleSizeRationale', render: 'text', label: 'sampleSizeRationale', hint: 'The power analysis or stopping rule that fixes N BEFORE data are seen. This is the field that makes the registration worth anything.' },
      { name: 'analysisPlan', render: 'text', label: 'analysisPlan', hint: 'The confirmatory analysis, named test by test, with the exact comparisons.' },
      { name: 'exclusionRules', render: 'chips', label: 'exclusionRules', hint: 'Rules for excluding data, fixed in advance.' },
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'protocol',
    icon: '⚗',
    group: 'Research',
    defaultStatus: 'draftMethod',
    actions: ['review', 'version', 'export'],
    fields: [
      { name: 'objective', render: 'verdict', label: 'objective', hint: 'What this procedure is for, in one sentence.' },
      { name: 'version', render: 'stat', label: 'version', hint: 'Protocol version. A running study amends a version; it does not edit history.' },
      { name: 'approvedBy', render: 'stat', label: 'approvedBy', hint: 'Who signed this version off.' },
      { name: 'design', render: 'text', label: 'design', hint: 'The study design — arms, conditions, order, timing.' },
      { name: 'materials', render: 'list', label: 'materials', hint: 'Apparatus, instruments, reagents, software with versions: [{title, detail}].' },
      { name: 'procedure', render: 'list', label: 'procedure', hint: 'The steps, in order: [{title, detail}]. Detailed enough to be followed by someone who did not write it — that is the whole test of a protocol.' },
      { name: 'measures', render: 'rows', label: 'measures', columns: ['measure', 'instrument', 'timing', 'unit'], hint: 'One row per measure: {measure, instrument, timing, unit}.' },
      { name: 'blinding', render: 'stat', label: 'blinding', hint: 'none | single | double, and who is blind to what.' },
      { name: 'randomization', render: 'text', label: 'randomization', hint: 'How allocation is randomised and concealed.' },
      { name: 'safety', render: 'chips', label: 'safety', hint: 'Hazards and the controls for them. Required before any approval will be granted.' },
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'consentForm',
    icon: '✍',
    group: 'Research',
    defaultStatus: 'draftForm',
    actions: ['review', 'translate', 'export'],
    fields: [
      { name: 'audience', render: 'stat', label: 'audience', hint: 'Who signs it, e.g. "adult volunteers", "parent or guardian", "site clinician".' },
      { name: 'language', render: 'stat', label: 'language', hint: 'BCP-47 language tag. A form the participant cannot read is not consent.' },
      { name: 'readingLevel', render: 'stat', label: 'readingLevel', hint: 'Target reading level, e.g. "Grade 8". Committees reject forms written at postgraduate level.' },
      { name: 'version', render: 'stat', label: 'version', hint: 'Form version, quoted on every signed copy.' },
      { name: 'purposeStatement', render: 'text', label: 'purposeStatement', hint: 'What the study is about, in the participant\'s language, not the protocol\'s.' },
      { name: 'risks', render: 'list', label: 'risks', hint: 'Foreseeable risks and discomforts: [{title, detail}]. Understating one is the fastest route to a rejected application.' },
      { name: 'benefits', render: 'list', label: 'benefits', hint: 'Benefits to the participant and to others. "None to you directly" is an honest and common entry.' },
      { name: 'dataUse', render: 'text', label: 'dataUse', hint: 'What is collected, who sees it, how long it is kept, and whether it is shared or reused.' },
      { name: 'withdrawalTerms', render: 'text', label: 'withdrawalTerms', hint: 'How to withdraw, until when, and what happens to data already collected.' },
      { name: 'contact', render: 'stat', label: 'contact', hint: 'Who to contact with questions, and the independent route for complaints.' },
      { name: 'approvedBy', render: 'stat', label: 'approvedBy', hint: 'The committee reference that approved this version.' },
    ],
  },
  {
    kind: 'participantPool',
    icon: '◕',
    group: 'Research',
    defaultStatus: 'notRecruiting',
    actions: ['recruit', 'screen'],
    fields: [
      { name: 'targetN', render: 'stat', label: 'targetN', hint: 'The pre-registered target sample size.' },
      { name: 'recruitedN', render: 'stat', label: 'recruitedN', hint: 'Participants recruited so far.' },
      { name: 'consentedN', render: 'stat', label: 'consentedN', hint: 'Participants who have given consent.' },
      { name: 'sourceDescription', render: 'text', label: 'sourceDescription', hint: 'Where participants come from, and what that means for generalisability. A convenience sample is a fine answer and a required disclosure.' },
      { name: 'inclusionCriteria', render: 'chips', label: 'inclusionCriteria', hint: 'Who is eligible.' },
      { name: 'exclusionCriteria', render: 'chips', label: 'exclusionCriteria', hint: 'Who is not, and why.' },
      { name: 'recruitmentChannels', render: 'chips', label: 'recruitmentChannels', hint: 'How they are reached. Each must be covered by the ethics approval.' },
      { name: 'compensation', render: 'text', label: 'compensation', hint: 'What participants receive, and whether it is prorated on withdrawal.' },
      { name: 'demographics', render: 'rows', label: 'demographics', columns: ['attribute', 'category', 'count', 'percent'], hint: 'Composition of the sample as recruited: {attribute, category, count, percent}. Aggregate only — never individual records.' },
      { name: 'consentRate', render: 'meter', label: 'consentRate', hint: 'Consented as a share of approached, 0-100.', derived: true },
    ],
  },
  {
    kind: 'dataManagementPlan',
    icon: '⛃',
    group: 'Research',
    defaultStatus: 'draftPlan',
    actions: ['validate', 'deposit', 'export'],
    fields: [
      { name: 'funderPolicy', render: 'stat', label: 'funderPolicy', hint: 'The policy this plan must satisfy — most funders now mandate one and check it at reporting.' },
      { name: 'dataTypes', render: 'rows', label: 'dataTypes', columns: ['type', 'format', 'volume', 'origin'], hint: 'What data exists: {type, format, volume, origin}.' },
      { name: 'personalData', render: 'verdict', label: 'personalData', hint: 'none | pseudonymised | identifiable — and the lawful basis where it is not none. This single field decides most of the rest of the plan.' },
      { name: 'storage', render: 'text', label: 'storage', hint: 'Where data lives during the project, with backup and access control.' },
      { name: 'retentionYears', render: 'stat', label: 'retentionYears', hint: 'How long data are kept after the project ends, as a number of years.' },
      { name: 'repository', render: 'stat', label: 'repository', hint: 'Where data are deposited — Zenodo, OSF, Dryad, an institutional repository.' },
      { name: 'doi', render: 'stat', label: 'doi', hint: 'DOI of the deposited dataset once minted. This is what makes the data citable rather than merely available.' },
      { name: 'licence', render: 'stat', label: 'licence', hint: 'Licence the data are released under, e.g. "CC BY 4.0".' },
      { name: 'accessConditions', render: 'text', label: 'accessConditions', hint: 'Who may access restricted data and how they apply.' },
      { name: 'sharingRestrictions', render: 'chips', label: 'sharingRestrictions', hint: 'Anything that cannot be shared, and the reason — consent scope, commercial sensitivity, indigenous data governance.' },
    ],
  },
  {
    kind: 'literatureReview',
    icon: '⌕',
    group: 'Research',
    defaultStatus: 'notSearched',
    actions: ['search', 'screen', 'synthesize'],
    fields: [
      { name: 'question', render: 'verdict', label: 'question', hint: 'The review question, stated so that a study can be judged in or out of it.' },
      { name: 'databases', render: 'chips', label: 'databases', hint: 'Databases actually searched, e.g. ["Scopus", "PubMed", "IEEE Xplore"].' },
      { name: 'searchStrings', render: 'list', label: 'searchStrings', hint: 'The exact queries run, per database: [{title, detail}] where title is the database and detail is the string. A review whose search cannot be re-run is not systematic.' },
      { name: 'searchedAt', render: 'stat', label: 'searchedAt', hint: `Date the searches were run. ${ISO_DATE}` },
      { name: 'inclusionCriteria', render: 'chips', label: 'inclusionCriteria', hint: 'What makes a study eligible.' },
      { name: 'screening', render: 'rows', label: 'screening', columns: ['stage', 'records', 'excluded', 'reason'], hint: 'The PRISMA flow: {stage, records, excluded, reason}, from identification through screening and eligibility to inclusion. The numbers must reconcile.' },
      { name: 'included', render: 'rows', label: 'included', columns: ['study', 'design', 'n', 'finding', 'quality'], hint: 'One row per included study: {study, design, n, finding, quality}.' },
      { name: 'synthesis', render: 'text', label: 'synthesis', hint: 'What the body of evidence says, including where it disagrees with itself.' },
      { name: 'gaps', render: 'chips', label: 'gaps', hint: 'What the literature does not answer. This is what the next grant is written about.' },
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'hypothesis',
    icon: '⁇',
    group: 'Research',
    defaultStatus: 'untested',
    actions: ['test', 'evaluate'],
    fields: [
      { name: 'statement', render: 'verdict', label: 'statement', hint: 'The hypothesis as a directional, falsifiable claim: "X increases Y under condition Z". A statement that cannot come out false is not a hypothesis.' },
      { name: 'variables', render: 'rows', label: 'variables', columns: ['role', 'variable', 'operationalization', 'unit'], hint: 'One row per variable: {role, variable, operationalization, unit}. `role` is independent | dependent | control | confound. `operationalization` is how it is actually measured — the gap between construct and measure is where most claims fail.' },
      { name: 'predictedDirection', render: 'stat', label: 'predictedDirection', hint: 'increase | decrease | difference | no-difference.' },
      { name: 'falsifiableBy', render: 'text', label: 'falsifiableBy', hint: 'The observation that would refute it. Write this before running anything.' },
      { name: 'priorEvidence', render: 'list', label: 'priorEvidence', hint: 'What already supports or undermines it: [{title, detail}].' },
      { name: 'testResult', render: 'verdict', label: 'testResult', hint: 'supported | not-supported | inconclusive, with the effect size and interval. "Inconclusive" is a real and common answer.' },
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'manuscript',
    icon: '✒',
    group: 'Research',
    defaultStatus: 'draftManuscript',
    actions: ['draft', 'format', 'submit', 'export'],
    fields: [
      { name: 'targetJournal', render: 'stat', label: 'targetJournal', hint: 'The venue being written for. Length, structure and style follow from it, so pick before drafting.' },
      { name: 'manuscriptType', render: 'stat', label: 'manuscriptType', hint: 'article | review | letter | registered-report | preprint.' },
      { name: 'abstract', render: 'text', label: 'abstract', hint: 'The abstract, within the venue\'s word limit.' },
      { name: 'keywords', render: 'chips', label: 'keywords', hint: 'Indexing keywords.' },
      {
        name: 'authors', render: 'rows', label: 'authors',
        columns: ['author', 'affiliation', 'orcid', 'contribution'],
        hint: 'One row per author: {author, affiliation, orcid, contribution}. `contribution` uses CRediT roles (conceptualization, methodology, writing – original draft, …). Authorship disputes are the most common research-integrity case, and a contribution recorded while the work happens is what settles them.',
      },
      { name: 'sections', render: 'list', label: 'sections', hint: 'The structure and what each section argues: [{title, detail}].' },
      { name: 'citationStyle', render: 'stat', label: 'citationStyle', hint: 'apa | harvard | ieee | mla | chicago | vancouver. The bibliography on this board renders in whatever this says.' },
      { name: 'wordCount', render: 'stat', label: 'wordCount', hint: 'Current word count against the venue\'s limit.' },
      { name: 'doi', render: 'stat', label: 'doi', hint: 'DOI once published.' },
      { name: 'preprintUrl', render: 'stat', label: 'preprintUrl', hint: 'Preprint location, if posted.' },
      { name: 'dataAvailability', render: 'text', label: 'dataAvailability', hint: 'The data availability statement, pointing at the deposited dataset\'s DOI. Most venues now require one and reject on its absence.' },
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'peerReview',
    icon: '☑',
    group: 'Research',
    defaultStatus: 'notReviewed',
    actions: ['review', 'submitReview'],
    fields: [
      { name: 'manuscriptRef', render: 'stat', label: 'manuscriptRef', hint: 'Title or identifier of the manuscript under review.' },
      { name: 'venue', render: 'stat', label: 'venue', hint: 'The journal or conference that requested it.' },
      { name: 'reviewerRole', render: 'stat', label: 'reviewerRole', hint: 'reviewer | meta-reviewer | editor.' },
      { name: 'dueAt', render: 'stat', label: 'dueAt', hint: `When the review is due. ${ISO_DATE}` },
      { name: 'recommendation', render: 'verdict', label: 'recommendation', hint: 'accept | minor-revision | major-revision | reject, with the one reason that decided it.' },
      { name: 'summaryAssessment', render: 'text', label: 'summaryAssessment', hint: 'What the paper claims, whether the evidence supports it, and what it contributes. Written so the authors know you read it.' },
      { name: 'majorPoints', render: 'list', label: 'majorPoints', hint: 'Issues that must be addressed: [{title, detail}]. Each should name what would resolve it.' },
      { name: 'minorPoints', render: 'list', label: 'minorPoints', hint: 'Smaller corrections: [{title, detail}].' },
      { name: 'competingInterests', render: 'text', label: 'competingInterests', hint: 'Any competing interest, or an explicit "none". Silence here is not a declaration.' },
      {
        name: 'confidentialToEditor', render: 'text', label: 'confidentialToEditor',
        hint: 'Comments for the editor only. Never include anything here that the authors are entitled to see — and never paste the manuscript\'s content into a shared or public object, because a manuscript under review is confidential.',
      },
    ],
  },

  // ══ SCHOLARLY PRIMITIVES ══════════════════════════════════════════════════════
  {
    kind: 'citation',
    icon: '❝',
    group: 'Knowledge',
    defaultStatus: 'noReference',
    actions: ['resolve', 'format', 'export'],
    fields: [
      { name: 'citationType', render: 'stat', label: 'citationType', hint: 'article-journal | book | chapter | paper-conference | thesis | report | webpage | dataset | software | preprint. Decides which fields the formatter uses.' },
      { name: 'authors', render: 'chips', label: 'authors', hint: 'Authors in order, each as "Family, G. I.". Order is data, not presentation — the formatter will not re-sort them.' },
      { name: 'year', render: 'stat', label: 'year', hint: 'Year of publication, as a number. Use "n.d." only when there genuinely is none.' },
      { name: 'container', render: 'stat', label: 'container', hint: 'The journal, book, proceedings or site the work appeared in.' },
      { name: 'publisher', render: 'stat', label: 'publisher', hint: 'Publisher, for books, theses and reports.' },
      { name: 'volume', render: 'stat', label: 'volume', hint: 'Volume number.' },
      { name: 'issue', render: 'stat', label: 'issue', hint: 'Issue number.' },
      { name: 'pages', render: 'stat', label: 'pages', hint: 'Page range, e.g. "114-129".' },
      { name: 'doi', render: 'stat', label: 'doi', hint: 'DOI as the bare identifier, e.g. "10.1038/s41586-024-07487-w" — not a URL. The board resolves it to one.' },
      { name: 'url', render: 'stat', label: 'url', hint: 'URL, for works with no DOI.' },
      { name: 'accessedAt', render: 'stat', label: 'accessedAt', hint: `When a web source was read. ${ISO_DATE} Required by most styles for a webpage.` },
      { name: 'citationKey', render: 'stat', label: 'citationKey', hint: 'BibTeX key, e.g. "rao2026thermal". Stable across edits, because it is what prose cites.' },
      { name: 'citationStyle', render: 'stat', label: 'citationStyle', hint: 'Style to render this reference in on the card. The bibliography overrides it for a list.' },
      { name: 'formatted', render: 'reference', label: 'formatted', hint: 'The formatted reference, rendered from the fields above in the chosen style.', derived: true },
    ],
  },
  {
    kind: 'bibliography',
    icon: '☰',
    group: 'Knowledge',
    defaultStatus: 'noEntries',
    actions: ['import', 'format', 'export'],
    fields: [
      { name: 'citationStyle', render: 'stat', label: 'citationStyle', hint: 'apa | harvard | ieee | mla | chicago | vancouver. One style for the whole list — that is the entire point of storing references as fields rather than as formatted strings.' },
      { name: 'sortOrder', render: 'stat', label: 'sortOrder', hint: 'author | year | appearance. IEEE and Vancouver number by appearance; the author-date styles sort by author.' },
      {
        name: 'entries', render: 'rows', label: 'entries',
        columns: ['citationKey', 'authors', 'year', 'workTitle', 'doi'],
        hint: 'One row per reference: {citationKey, authors, year, workTitle, doi}. Import a .bib or .ris rather than typing these — canvas_import_references parses both and keeps the keys.',
      },
      { name: 'entryCount', render: 'stat', label: 'entryCount', hint: 'Number of references in the list.', derived: true },
      { name: 'formatted', render: 'reference', label: 'formatted', hint: 'The rendered reference list, in the chosen style and sort order.', derived: true },
    ],
  },
  {
    kind: 'equation',
    icon: '∑',
    group: 'Knowledge',
    defaultStatus: 'noExpression',
    actions: ['render', 'export'],
    fields: [
      {
        name: 'tex', render: 'math', label: 'tex',
        hint: 'The expression in TeX, WITHOUT surrounding $ or \\[ \\] delimiters — e.g. "\\frac{\\partial u}{\\partial t} = \\alpha \\nabla^2 u". This is the object\'s substance; an equation card with prose and no TeX is a note.',
      },
      { name: 'equationNumber', render: 'stat', label: 'equationNumber', hint: 'Display number, e.g. "3.4", for prose that refers to it.' },
      {
        name: 'altText', render: 'text', label: 'altText',
        hint: 'How the equation should be READ ALOUD, e.g. "the partial derivative of u with respect to t equals alpha times the Laplacian of u". The rendered MathML carries this, and an equation distributed to a class without it is not accessible.',
      },
      { name: 'variables', render: 'rows', label: 'variables', columns: ['symbol', 'meaning', 'unit'], hint: 'One row per symbol: {symbol, meaning, unit}. An equation whose symbols are undefined teaches nothing.' },
      { name: 'assumptions', render: 'chips', label: 'assumptions', hint: 'The conditions under which it holds. This is what separates a formula from a result.' },
      { name: 'derivation', render: 'list', label: 'derivation', hint: 'The steps that get there: [{title, detail}] where title is the step\'s TeX and detail is why it is allowed.' },
      SOURCES_FIELD,
    ],
  },
];

/**
 * The exhaustiveness check.
 *
 * A kind declared in the contract and given no spec here would render as an empty card
 * and be invisible to the AI field contract — the exact silent failure the spec
 * mechanism exists to prevent. This turns it into a type error.
 */
const _EXHAUSTIVE: Record<AcademicObjectKind, true> = Object.fromEntries(
  ACADEMIC_OBJECT_SPECS.map((spec) => [spec.kind, true]),
) as Record<AcademicObjectKind, true>;
void _EXHAUSTIVE;

/** Every academic kind, in spec order. */
export const ACADEMIC_SPEC_KINDS: readonly AcademicObjectKind[] =
  ACADEMIC_OBJECT_SPECS.map((spec) => spec.kind as AcademicObjectKind);

/**
 * English fallbacks for the palette and for a blank card.
 *
 * The surfaces localise through `creationCanvas.academic.label.*` and `.status.*`;
 * these are what shows while a translation is being added, and what a test asserts
 * against. They live beside the specs rather than in the registry so that adding a
 * kind is still a change to ONE file.
 */
export const ACADEMIC_LABELS: Record<AcademicObjectKind, string> = {
  cohort: 'Cohort', assignment: 'Assignment', rubric: 'Rubric', submission: 'Submission',
  gradebook: 'Gradebook', accommodation: 'Accommodation', feedbackBank: 'Feedback bank',
  lecture: 'Lecture', poll: 'Live poll', officeHours: 'Office hours',
  curriculumMap: 'Curriculum map',
  grantProposal: 'Grant proposal', ethicsApproval: 'Ethics approval',
  preRegistration: 'Pre-registration', protocol: 'Protocol', consentForm: 'Consent form',
  participantPool: 'Participant pool', dataManagementPlan: 'Data management plan',
  literatureReview: 'Literature review', hypothesis: 'Hypothesis',
  manuscript: 'Manuscript', peerReview: 'Peer review',
  citation: 'Citation', bibliography: 'Bibliography', equation: 'Equation',
};

/** Blank-card statuses. Never "Ready" or "Live" — an empty card must not read as a
 *  configured one, which is the defect the registry's own comments record. */
export const ACADEMIC_STATUSES: Readonly<Record<string, string>> = {
  noRoster: 'No roster yet', draftBrief: 'Draft brief', noCriteria: 'No criteria',
  notSubmitted: 'Not submitted', noMarks: 'No marks yet', notApproved: 'Not approved',
  empty: 'Empty', planning: 'Planning', notOpened: 'Not opened', noSlots: 'No slots',
  notMapped: 'Not mapped', draftProposal: 'Draft proposal', draftPlan: 'Draft plan',
  draftMethod: 'Draft method', draftForm: 'Draft form', notRecruiting: 'Not recruiting',
  notSearched: 'Not searched', untested: 'Untested', draftManuscript: 'Draft',
  notReviewed: 'Not reviewed', noReference: 'No reference', noEntries: 'No entries',
  noExpression: 'No expression',
};

/** Kinds the contract declares, for the test that proves the two lists agree. */
export const ACADEMIC_CONTRACT_KINDS = ACADEMIC_OBJECT_KINDS;

registerSpecObjectSet({
  id: 'academic',
  namespace: ACADEMIC_NAMESPACE,
  specs: ACADEMIC_OBJECT_SPECS,
});
