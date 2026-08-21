/**
 * The ACADEMIC objects — "idea to real" as a university actually runs it.
 *
 * ── WHY THESE ARE A NAMED SET ────────────────────────────────────────────────────
 * The canvas could already teach: a `course` authors modules and lessons, a `practice`
 * set records attempts, and both export to SCORM. What it could not hold was a CLASS.
 * Progress lived on the artifact — `course.completedLessonIds`, `practice.attempts` —
 * which is exactly right for one learner and structurally wrong for a cohort of 200:
 * one board meant one progress record, so a teacher could author material and could
 * never hand it out, mark it, or say who was struggling.
 *
 * The same hole ran through research. The board could analyse a dataset and present
 * the result, and had nowhere to put the grant that funded it, the ethics approval
 * that permitted it, the protocol that specified it, the pre-registration that made
 * it falsifiable, or the manuscript and peer review it ends in. An academic's "idea
 * to real" starts two steps before data and ends two steps after a chart.
 *
 * ── THE THREE FAMILIES ───────────────────────────────────────────────────────────
 * TEACHING is the assessment loop: a `cohort` of learners, an `assignment` with a
 * `rubric`, one `submission` per learner, and a `gradebook` that aggregates the marks
 * — plus the things that make it lawful and deliverable (`accommodation`), teachable
 * (`lecture`, `poll`, `officeHours`), reusable (`feedbackBank`) and accreditable
 * (`curriculumMap`).
 *
 * RESEARCH is the scholarly lifecycle, in the order it is actually gated:
 * `grantProposal` → `ethicsApproval` → `preRegistration` → `protocol` → `consentForm`
 * → `participantPool` → data (the existing dataset/chart objects) → `manuscript` →
 * `peerReview`, with `dataManagementPlan` and `literatureReview` alongside.
 *
 * SCHOLARLY PRIMITIVES are the three things every one of the above needs and no
 * business object does: a `citation`, the `bibliography` that formats a list of them,
 * and an `equation` — because a canvas with no mathematics cannot hold a physics
 * lecture, an economics model, or a methods section.
 *
 * ── WHY `submission` IS ITS OWN KIND ─────────────────────────────────────────────
 * This is the load-bearing one. An `assignment` is the TASK (one per class); a
 * `submission` is one learner's ANSWER to it (one per learner). Collapsing them —
 * letting an assignment carry a `submissions[]` array — is what makes per-learner
 * state unreachable: a mark, an attestation and a feedback thread would live inside
 * a repeating group on someone else's object, which is the shape 3NF exists to
 * refuse, and every learner would be editing the same row. Two kinds is what lets a
 * board hold 200 answers to one question, each with its own owner, its own integrity
 * record and its own returned feedback.
 *
 * ── WHY `protocol` AND NOT `experiment` ──────────────────────────────────────────
 * `experiment` is taken, by the founder set, for a growth A/B test: a hypothesis
 * about a metric, variants, exposure and lift. A research `protocol` is the METHOD —
 * materials, procedure, measures, analysis plan — and is reviewed and approved before
 * anything is run. Collapsing them would make "our signup test" and "the approved
 * procedure the ethics board signed" the same object.
 */
export const ACADEMIC_OBJECT_KINDS = [
  // ── Teaching: the assessment loop ──────────────────────────────────────────────
  // The class itself. A roster is the axis the canvas never had: without it, "hand
  // this out" and "who is behind?" have no subject.
  'cohort',
  // The task, its rubric, and one answer per learner. See the block comment above for
  // why the last of these is a kind rather than an array.
  'assignment', 'rubric', 'submission',
  // Marks, aggregated and moderated. Deliberately separate from `rubric`: a rubric is
  // the instrument, a gradebook is the record, and they have different lifetimes —
  // the instrument is reused for years, the record belongs to one cohort.
  'gradebook',
  // The lawful and reusable parts of running a class.
  'accommodation', 'feedbackBank',
  // Delivering it: the session plan and the bookable hours after it.
  //
  // The live question asked DURING it is not here. `poll` was declared twice — once as a
  // teaching kind and once, the same week, as the facilitation primitive in
  // `SHARED_OBJECT_KINDS` — and two declarations of one word is not a duplicate the way
  // two similar tables are: `CREATION_OBJECT_KINDS` concatenates both lists, so the
  // registry indexed one kind twice and whichever spec loaded last silently won. A
  // lecture check-for-understanding is the shared `poll` with `pollFormat: 'quiz'`,
  // which is exactly the argument `SHARED_OBJECT_KINDS` makes for it.
  'lecture', 'officeHours',
  // Programme outcomes mapped to what actually evidences them. This is the
  // accreditation artifact every department rebuilds in a spreadsheet every cycle.
  'curriculumMap',
  // ── Research: the scholarly lifecycle, in gate order ──────────────────────────
  'grantProposal', 'ethicsApproval', 'preRegistration', 'protocol', 'consentForm',
  'participantPool', 'dataManagementPlan', 'literatureReview', 'hypothesis',
  'manuscript', 'peerReview',
  // ── Scholarly primitives ──────────────────────────────────────────────────────
  // One reference, the formatted list of them, and mathematics.
  'citation', 'bibliography', 'equation',
] as const;

export type AcademicObjectKind = typeof ACADEMIC_OBJECT_KINDS[number];

const ACADEMIC_KIND_SET: ReadonlySet<string> = new Set<string>(ACADEMIC_OBJECT_KINDS);

/** True for the academic objects declared above — the set `academicObjects.ts` specs. */
export function isAcademicObjectKind(value: unknown): value is AcademicObjectKind {
  return typeof value === 'string' && ACADEMIC_KIND_SET.has(value);
}

/**
 * Citation styles the platform can actually render.
 *
 * A closed set because a style is a RENDERING of one stored reference, never a
 * different way of storing it: the `citation` object holds author/year/title/container
 * and the style decides the punctuation. Storing a pre-formatted string instead —
 * which is what "just let the model write the reference" amounts to — is how a
 * bibliography ends up in four styles at once and cannot be switched.
 */
export const CITATION_STYLES = ['apa', 'harvard', 'ieee', 'mla', 'chicago', 'vancouver'] as const;
export type CitationStyle = typeof CITATION_STYLES[number];

export function isCitationStyle(value: unknown): value is CitationStyle {
  return typeof value === 'string' && (CITATION_STYLES as readonly string[]).includes(value);
}

/**
 * What a reference IS. Mirrors the CSL/BibTeX type vocabulary closely enough to
 * round-trip the two import formats a scholar actually has (`.bib` and `.ris`)
 * without inventing a third.
 */
export const CITATION_TYPES = [
  'article-journal', 'book', 'chapter', 'paper-conference', 'thesis',
  'report', 'webpage', 'dataset', 'software', 'preprint',
] as const;
export type CitationType = typeof CITATION_TYPES[number];

/**
 * How much help a learner may have while a board is being used for assessment.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ───────────────────────────────────────────────
 * The canvas ships an assistant that can author any object on the board. Handed to a
 * student sitting a test, it will sit the test. There was no way to say otherwise —
 * so the platform could author an exam and could not administer one, and every
 * summative use was blocked on a control that did not exist.
 *
 * Three modes, not a boolean, because the middle one is the common case: most
 * coursework is "you may use AI, and you must declare what you used it for", which is
 * a different rule from both "no help" and "unrestricted".
 *
 *   `open`      — unrestricted. The default, and what every existing board is.
 *   `assisted`  — the assistant answers, and every turn is recorded on the learner's
 *                 integrity record and declared on the submission.
 *   `closed`    — the assistant refuses to author or answer. Sitting an exam.
 */
export const ASSESSMENT_MODES = ['open', 'assisted', 'closed'] as const;
export type AssessmentMode = typeof ASSESSMENT_MODES[number];

export function isAssessmentMode(value: unknown): value is AssessmentMode {
  return typeof value === 'string' && (ASSESSMENT_MODES as readonly string[]).includes(value);
}

/**
 * Where a piece of a submission came from.
 *
 * The canvas already records every authored change, which means it can answer the
 * question no word processor can: not "is this text similar to something else" but
 * "how did this artifact come to exist". These are the four honest answers, and a
 * submission's integrity record is a count of them rather than a percentage anybody
 * has to trust.
 */
export const AUTHORSHIP_SOURCES = ['learner', 'assistant', 'imported', 'collaborator'] as const;
export type AuthorshipSource = typeof AUTHORSHIP_SOURCES[number];

export function isAuthorshipSource(value: unknown): value is AuthorshipSource {
  return typeof value === 'string' && (AUTHORSHIP_SOURCES as readonly string[]).includes(value);
}
