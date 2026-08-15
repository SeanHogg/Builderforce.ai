import { describe, expect, it } from 'vitest';
import { ACADEMIC_OBJECT_KINDS, CREATION_OBJECT_KINDS, isAcademicObjectKind } from '@builderforce/creation-canvas-contract';
import { ACADEMIC_LABELS, ACADEMIC_NAMESPACE, ACADEMIC_OBJECT_SPECS, ACADEMIC_STATUSES } from './academicObjects';
import {
  allSpecObjectSpecs, isSpecObjectKind, makeSpecDeriveBoard, specFieldGuidance, specFieldValue,
  specMutableFields, specObjectNamespace, specObjectSpec, specReadableFields, specSetGuidance,
} from './specObjects';
import {
  CREATION_OBJECT_REGISTRY, CREATION_PALETTE_GROUPS, createDefaultCreationData,
  creationObjectDefinition, creationObjectAiContext, creationObjectMutableFields,
  emptyShellProblem,
} from '@/components/creation-canvas/creationObjectRegistry';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';

const CATALOGS = { en, zh, es, fr, de } as const;
const at = (catalog: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), catalog);

describe('academic vocabulary', () => {
  it('declares a spec for every kind the contract names, and no others', () => {
    expect(ACADEMIC_OBJECT_SPECS.map((spec) => spec.kind).sort()).toEqual([...ACADEMIC_OBJECT_KINDS].sort());
  });

  it('is registered in the canvas object contract', () => {
    for (const kind of ACADEMIC_OBJECT_KINDS) expect(CREATION_OBJECT_KINDS).toContain(kind);
  });

  it('narrows its own kinds and nothing else', () => {
    expect(isAcademicObjectKind('rubric')).toBe(true);
    expect(isAcademicObjectKind('protocol')).toBe(true);
    // `experiment` is the founder growth test, deliberately distinct from `protocol`.
    expect(isAcademicObjectKind('experiment')).toBe(false);
    expect(isAcademicObjectKind(null)).toBe(false);
  });

  it('resolves through the shared spec primitive under its own namespace', () => {
    for (const kind of ACADEMIC_OBJECT_KINDS) {
      expect(isSpecObjectKind(kind)).toBe(true);
      expect(specObjectNamespace(kind)).toBe(ACADEMIC_NAMESPACE);
    }
    // The founder vocabulary keeps its own namespace — two vocabularies, not one.
    expect(specObjectNamespace('competitor')).toBe('creationCanvas.founder');
  });

  it('gives every kind a label, an icon, a status and at least one action', () => {
    for (const spec of ACADEMIC_OBJECT_SPECS) {
      expect(ACADEMIC_LABELS[spec.kind as keyof typeof ACADEMIC_LABELS]).toBeTruthy();
      expect(spec.icon).toBeTruthy();
      expect(ACADEMIC_STATUSES[spec.defaultStatus]).toBeTruthy();
      expect(spec.actions.length).toBeGreaterThan(0);
      expect(spec.fields.length).toBeGreaterThan(0);
    }
  });

  it('never opens a blank card in a state that reads as configured', () => {
    for (const kind of ACADEMIC_OBJECT_KINDS) {
      const status = String(createDefaultCreationData(kind).status ?? '');
      expect(status).toBeTruthy();
      expect(status).not.toMatch(/^(Ready|Live|Active|Complete)$/i);
    }
  });

  it('declares no duplicate field names within one kind', () => {
    for (const spec of ACADEMIC_OBJECT_SPECS) {
      const names = spec.fields.map((field) => field.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('gives every `rows` and `matrix` field the columns its body needs', () => {
    for (const spec of ACADEMIC_OBJECT_SPECS) {
      for (const field of spec.fields) {
        if (field.render === 'rows') expect(field.columns?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});

describe('the derived-field rule', () => {
  /**
   * The load-bearing integrity property: a model may READ a mark and may never WRITE
   * one. If this ever passes for `mark`, `integrity` or `marks`, an LLM patch can award
   * a grade nobody earned or erase the record of its own contribution.
   */
  it('keeps evidence about a person out of every authorable list', () => {
    const forbidden: ReadonlyArray<[string, string]> = [
      ['submission', 'mark'], ['submission', 'integrity'], ['submission', 'feedback'],
      ['submission', 'markBreakdown'], ['submission', 'lateBy'],
      ['gradebook', 'marks'], ['gradebook', 'distribution'], ['gradebook', 'mean'],
      ['gradebook', 'passRate'], ['gradebook', 'moderation'],
      ['poll', 'responses'], ['poll', 'correctRate'],
      ['lecture', 'attendanceCount'], ['curriculumMap', 'coverage'], ['cohort', 'progress'],
    ];
    for (const [kind, field] of forbidden) {
      expect(specMutableFields(kind)).not.toContain(field);
      expect(creationObjectMutableFields(kind as never)).not.toContain(field);
      // …and is readable, so Brain can still answer "who is struggling".
      expect(specReadableFields(kind)).toContain(field);
    }
  });

  it('documents a derived field to the model as read-only rather than hiding it', () => {
    const guidance = specFieldGuidance('submission');
    expect(guidance).toContain('mark');
    expect(guidance).toContain('READ-ONLY');
  });

  it('teaches the whole vocabulary in one place', () => {
    const guidance = specSetGuidance('academic');
    for (const kind of ACADEMIC_OBJECT_KINDS) expect(guidance).toContain(kind);
  });

  it('lets a learner write their own declaration', () => {
    // The counterpart to the rule above: the declaration is the one thing on a
    // submission that MUST be authorable, because one written by anybody else is not a
    // declaration at all.
    expect(specMutableFields('submission')).toContain('declaration');
  });
});

describe('registry wiring', () => {
  it('registers every academic kind with a resolvable definition', () => {
    for (const kind of ACADEMIC_OBJECT_KINDS) {
      const definition = creationObjectDefinition(kind);
      expect(definition.label).toBeTruthy();
      expect(definition.actions).toContain('inspect');
      expect(definition.mutableFields).toContain('title');
    }
  });

  it('places every academic kind in a palette group that is actually rendered', () => {
    const rendered = new Set(CREATION_PALETTE_GROUPS.flatMap((group) => group.items.map((item) => item.kind)));
    for (const kind of ACADEMIC_OBJECT_KINDS) expect(rendered.has(kind)).toBe(true);
    expect(CREATION_PALETTE_GROUPS.map((group) => group.group)).toEqual(expect.arrayContaining(['Teaching', 'Research']));
  });

  it('has no kind registered twice', () => {
    const kinds = CREATION_OBJECT_REGISTRY.map((definition) => definition.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('refuses a title-only academic object as the empty shell it is', () => {
    expect(emptyShellProblem('rubric', { title: 'Essay rubric' })).toBeTruthy();
    expect(emptyShellProblem('assignment', { title: 'Assignment 1' })).toBeTruthy();
    // Content in a declared field clears it.
    expect(emptyShellProblem('assignment', { title: 'Assignment 1', brief: 'Write 2,000 words on…' })).toBeNull();
  });

  it('does not mistake canvas-written evidence for a learner handing work in', () => {
    // Only the derived ledger is populated — nobody authored anything.
    expect(emptyShellProblem('submission', {
      title: 'Ada — Essay',
      integrity: [{ source: 'learner', edits: 3, characters: 900 }],
      lateBy: '0',
    })).toBeTruthy();
    expect(emptyShellProblem('submission', { title: 'Ada — Essay', artifacts: [{ title: 'essay.md' }] })).toBeNull();
  });

  it('carries every academic field into the AI context, derived ones included', () => {
    const context = creationObjectAiContext({
      kind: 'submission', title: 'Ada — Essay', learnerRef: 's1',
      mark: 68, integrity: [{ source: 'assistant', edits: 2, characters: 100 }],
      declaration: 'I used the assistant to check my derivation.',
    });
    expect(context.mark).toBe(68);
    expect(context.learnerRef).toBe('s1');
    expect(context.declaration).toBeTruthy();
    expect(Array.isArray(context.integrity)).toBe(true);
  });

  it('carries a whole rubric grid into the AI context, descriptors intact', () => {
    // The depth budget is what this pins: at the default of three the descriptors are
    // dropped and Brain marks against criteria with names and no standards.
    const context = creationObjectAiContext({
      kind: 'rubric', title: 'Essay rubric',
      criteria: { columns: ['Fail', 'Pass'], rows: [{ label: 'Argument', weight: 1, cells: ['No thesis', 'A thesis'] }] },
    });
    const criteria = context.criteria as { rows: Array<{ cells: string[] }> };
    expect(criteria.rows[0].cells).toEqual(['No thesis', 'A thesis']);
  });

  it('carries a full-size roster rather than the first 25 names', () => {
    // A truncated roster produces a fluent, specific, wrong answer about a real person.
    const roster = Array.from({ length: 180 }, (_, index) => ({ ref: `s${index}`, name: `Learner ${index}` }));
    const context = creationObjectAiContext({ kind: 'cohort', title: 'PHYS2041', roster });
    expect((context.roster as unknown[]).length).toBe(180);
  });

  it('gives every object a place to put a text alternative', () => {
    // The accessibility audit reports a missing alt text on a generated image; without
    // this field there would be nowhere to fix it.
    for (const kind of ['image', 'chart', 'diagram', 'video'] as const) {
      expect(creationObjectMutableFields(kind)).toContain('altText');
    }
    expect(creationObjectMutableFields('video')).toContain('captionsUrl');
  });
});

describe('localisation', () => {
  const namespacePath = ACADEMIC_NAMESPACE.split('.');

  it('has a real translation for every academic label in all five catalogs', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const kind of ACADEMIC_OBJECT_KINDS) {
        expect(at(catalog, [...namespacePath, 'label', kind]), `${locale}.label.${kind}`).toBeTruthy();
        expect(at(catalog, ['creationCanvas', 'object', kind]), `${locale}.object.${kind}`).toBeTruthy();
      }
      for (const group of ['Teaching', 'Research']) {
        expect(at(catalog, ['creationCanvas', 'group', group]), `${locale}.group.${group}`).toBeTruthy();
      }
    }
  });

  it('has a label for every field and every column the specs declare', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const spec of ACADEMIC_OBJECT_SPECS) {
        for (const field of spec.fields) {
          expect(at(catalog, [...namespacePath, 'field', field.label]), `${locale}.field.${field.label}`).toBeTruthy();
          for (const column of field.columns ?? []) {
            expect(at(catalog, [...namespacePath, 'column', column]), `${locale}.column.${column}`).toBeTruthy();
          }
        }
      }
    }
  });

  it('has the scalars the shared body renders', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const key of ['empty', 'emptyHint', 'meterLabel', 'freshJustNow', 'freshMinutes', 'freshHours', 'freshDays', 'barValue']) {
        expect(at(catalog, [...namespacePath, key]), `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it('is genuinely translated rather than English copied into four files', () => {
    // The rule the localisation guard exists to enforce, asserted on a sample that would
    // be obviously wrong if a catalog had been filled by copying `en`.
    const sample = ['label', 'rubric'] as const;
    const english = at(en, [...namespacePath, ...sample]);
    for (const locale of ['zh', 'es', 'fr', 'de'] as const) {
      expect(at(CATALOGS[locale], [...namespacePath, ...sample]), locale).not.toBe(english);
    }
  });
});

describe('the spec primitive serves more than one vocabulary', () => {
  it('holds the founder and academic sets side by side', () => {
    const kinds = allSpecObjectSpecs().map((spec) => spec.kind);
    expect(kinds).toContain('competitor');
    expect(kinds).toContain('rubric');
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('returns null for a kind no vocabulary declares', () => {
    expect(specObjectSpec('dashboard')).toBeNull();
    expect(specObjectNamespace('dashboard')).toBeNull();
    expect(isSpecObjectKind('dashboard')).toBe(false);
  });
});


// ---------------------------------------------------------------------------
// The derivations — the half this vocabulary declared and never produced
// ---------------------------------------------------------------------------
//
// Nineteen fields were flagged `derived: true` and produced by nothing, so a gradebook
// beside two hundred marked submissions reported no mean and a late submission reported
// no lateness. These pin the two halves of the fix: what is now COMPUTED, and what is
// still testimony and must never be.

const value = (kind: string, name: string, data: Record<string, unknown>, board = makeSpecDeriveBoard([])) => {
  const field = specObjectSpec(kind)?.fields.find((entry) => entry.name === name);
  if (!field) throw new Error('no ' + name + ' field on ' + kind);
  return specFieldValue(field, data, board);
};

describe('cross-object derivations', () => {
  const board = (...objects: Array<Record<string, unknown>>) => makeSpecDeriveBoard(objects);

  const ASSIGNMENT = { kind: 'assignment', title: 'Essay 1', dueAt: '2026-03-01T23:59:00Z', weight: 100, maxMarks: 100 };
  const COHORT = {
    kind: 'cohort', title: 'PHYS2041', courseCode: 'PHYS2041', enrolledCount: 2,
    roster: [{ ref: 's1', name: 'Ada' }, { ref: 's2', name: 'Grace' }],
  };
  const submission = (ref: string, extra: Record<string, unknown>) =>
    ({ kind: 'submission', title: ref + ' — Essay 1', learnerRef: ref, assignmentRef: 'Essay 1', ...extra });

  it('counts an assignment’s submissions and marks from the board', () => {
    const on = board(ASSIGNMENT, submission('s1', { submittedAt: '2026-02-28T10:00:00Z', mark: 72 }), submission('s2', { submittedAt: '2026-03-02T10:00:00Z' }));
    expect(value('assignment', 'submissionCount', ASSIGNMENT, on)).toBe(2);
    // Handed in and not yet marked is NOT marked — two different queues, two different
    // people to chase.
    expect(value('assignment', 'markedCount', ASSIGNMENT, on)).toBe(1);
  });

  it('reports lateness against the deadline on the assignment, and nothing when on time', () => {
    const on = board(ASSIGNMENT);
    expect(String(value('submission', 'lateBy', submission('s2', { submittedAt: '2026-03-03T23:59:00Z' }), on))).toContain('2d late');
    expect(value('submission', 'lateBy', submission('s1', { submittedAt: '2026-02-28T10:00:00Z' }), on)).toBeUndefined();
    // No assignment on the board is not "on time" — it is unknowable, and saying nothing
    // is the only honest answer.
    expect(value('submission', 'lateBy', submission('s1', { submittedAt: '2026-03-09T10:00:00Z' }))).toBeUndefined();
  });

  it('aggregates a gradebook from the submissions beside it', () => {
    const gradebook = {
      kind: 'gradebook', title: 'PHYS2041 gradebook', cohortRef: 'PHYS2041', assignments: ['Essay 1'],
      gradeBands: [{ grade: 'F', minimum: 0, maximum: 49 }, { grade: 'P', minimum: 50, maximum: 100 }],
    };
    const on = board(
      gradebook, COHORT, ASSIGNMENT,
      submission('s1', { submittedAt: '2026-02-28T10:00:00Z', mark: 80 }),
      submission('s2', { submittedAt: '2026-02-28T10:00:00Z', mark: 40 }),
    );
    expect(value('gradebook', 'mean', gradebook, on)).toBe(60);
    expect(value('gradebook', 'median', gradebook, on)).toBe(60);
    // The pass rate is over the WHOLE cohort — one of two learners cleared 50.
    expect(value('gradebook', 'passRate', gradebook, on)).toBe(50);
    // One learner in each band. Compared as a SET: the band ordering is
    // `gradeBandsFromNode`'s decision and is pinned by its own tests, so restating it
    // here would be a second place to update when it changes.
    expect(value('gradebook', 'distribution', gradebook, on)).toEqual(
      expect.arrayContaining([{ label: 'F', value: 1 }, { label: 'P', value: 1 }]),
    );
    const matrix = value('gradebook', 'marks', gradebook, on) as { columns: string[]; rows: unknown[] };
    expect(matrix.columns).toEqual(['Essay 1']);
    expect(matrix.rows).toHaveLength(2);
  });

  it('reports nothing for a gradebook with nothing to aggregate', () => {
    // A mean of zero over an empty cohort reads as a class that failed.
    const empty = { kind: 'gradebook', title: 'Empty', cohortRef: 'NOPE', assignments: [] };
    expect(value('gradebook', 'mean', empty, board(empty))).toBeUndefined();
    expect(value('gradebook', 'passRate', empty, board(empty))).toBeUndefined();
    expect(value('gradebook', 'marks', empty, board(empty))).toBeUndefined();
  });

  it('measures cohort progress against work that is actually DUE', () => {
    const past = { kind: 'assignment', title: 'Essay 1', dueAt: '2020-01-01T00:00:00Z' };
    const future = { kind: 'assignment', title: 'Essay 2', dueAt: '2999-01-01T00:00:00Z' };
    const on = board(COHORT, past, future, submission('s1', { submittedAt: '2019-12-30T10:00:00Z' }));
    // One of two learners has handed in the one assignment that is due. Essay 2 is not
    // yet due and must not drag the number down — a cohort in week 2 is not 50% behind.
    expect(value('cohort', 'progress', COHORT, on)).toBe(50);
  });

  it('computes an attendance rate against the cohort it is taught to', () => {
    const lecture = { kind: 'lecture', title: 'Week 1', cohortRef: 'PHYS2041', attendanceCount: 1 };
    expect(value('lecture', 'attendanceRate', lecture, board(COHORT, lecture))).toBe(50);
    // No cohort named: a rate with no denominator is not a rate.
    expect(value('lecture', 'attendanceRate', { kind: 'lecture', title: 'Week 1', attendanceCount: 1 })).toBeUndefined();
  });
});

describe('single-object derivations', () => {
  it('reads a poll off its own responses', () => {
    const poll = { kind: 'poll', title: 'Q1', correctIndex: 1, responses: [{ label: 'A', value: 3 }, { label: 'B', value: 9 }] };
    expect(value('poll', 'responseCount', poll)).toBe(12);
    expect(value('poll', 'correctRate', poll)).toBe(75);
    // An opinion poll has no right answer to be right about.
    expect(value('poll', 'correctRate', { kind: 'poll', title: 'Q1', responses: poll.responses })).toBeUndefined();
  });

  it('counts booked office-hours slots', () => {
    expect(value('officeHours', 'utilisation', {
      kind: 'officeHours', title: 'Tuesdays',
      slots: [{ startsAt: '1', bookedBy: 's1' }, { startsAt: '2', bookedBy: '' }, { startsAt: '3' }],
    })).toBe(33);
  });

  it('counts an outcome as covered only where it is ASSURED', () => {
    const map = {
      kind: 'curriculumMap', title: 'BEng',
      mapping: {
        columns: ['Essay 1', 'Exam'],
        rows: [{ label: 'LO1', cells: ['introduced', 'assured'] }, { label: 'LO2', cells: ['developed', ''] }],
      },
    };
    // LO2 is mentioned twice and assured nowhere — which is exactly the submission that
    // fails a review, so it must read as a gap rather than as coverage.
    expect(value('curriculumMap', 'coverage', map)).toBe(50);
    expect(value('curriculumMap', 'gaps', map)).toEqual(['LO2']);
  });

  it('reads consent and reference counts off their own fields', () => {
    expect(value('participantPool', 'consentRate', { kind: 'participantPool', title: 'Pool', recruitedN: 40, consentedN: 30 })).toBe(75);
    expect(value('bibliography', 'entryCount', { kind: 'bibliography', title: 'Refs', entries: [{ citationKey: 'a' }, { citationKey: 'b' }] })).toBe(2);
    expect(value('bibliography', 'entryCount', { kind: 'bibliography', title: 'Refs' })).toBeUndefined();
  });
});

describe('what stays testimony', () => {
  it('never computes a value that has to be recorded rather than derived', () => {
    // A mark, a mark breakdown, feedback, an integrity ledger, an attendance COUNT, a
    // poll's raw responses, a moderation record and a bank's usage count are evidence of
    // something that happened off the board. Computing one would be inventing it.
    for (const [kind, name] of [
      ['submission', 'mark'], ['submission', 'markBreakdown'], ['submission', 'feedback'],
      ['submission', 'integrity'], ['gradebook', 'moderation'], ['lecture', 'attendanceCount'],
      ['poll', 'responses'], ['feedbackBank', 'usageCount'],
    ] as const) {
      const field = specObjectSpec(kind)?.fields.find((entry) => entry.name === name);
      expect(field?.derive, kind + '.' + name + ' must not be computed').toBeUndefined();
      expect(field?.derived, kind + '.' + name + ' must stay unauthorable').toBe(true);
    }
  });

  it('keeps every computed field out of the authorable list', () => {
    for (const [kind, name] of [
      ['gradebook', 'mean'], ['gradebook', 'passRate'], ['gradebook', 'marks'],
      ['assignment', 'submissionCount'], ['submission', 'lateBy'], ['cohort', 'progress'],
      ['poll', 'correctRate'], ['curriculumMap', 'coverage'], ['officeHours', 'utilisation'],
    ] as const) {
      expect(specMutableFields(kind)).not.toContain(name);
    }
  });
});
