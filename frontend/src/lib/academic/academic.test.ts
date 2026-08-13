import { describe, expect, it } from 'vitest';
import {
  citationFromNode, formatBibliography, formatReference, inTextCitation,
  normalizeDoi, parseAuthorName, parseBibtex, parseReferences, parseRis, toBibtex,
} from './citations';
import {
  applyLatePolicy, applyRubric, gradeBandsFromNode, gradeFor, hoursLate,
  moderationNeeded, parseLatePolicy, passMark, rubricFromNode, rubricProblems,
} from './marking';
import {
  atRiskLearners, buildGradebook, gradebookCsv, gradebookStats,
  learnersFromCohort, markFromSubmission,
} from './gradebook';
import { looksLikeTex, renderTex } from './mathTex';
import { assistantShare, buildIntegrityLedger, disclosureDraft, integrityVerdict } from './integrity';
import { accessibilityVerdict, accommodationNeeds, auditAccessibility } from './accessibility';
import { assessmentGate, boardAssessmentMode, effectiveDeadline, extraTimeFor, windowState } from './assessment';

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const RAO = {
  key: 'rao2026', type: 'article-journal' as const,
  authors: ['Rao, Grace I.', 'Diaz, Marta'],
  year: '2026', title: 'Thermal transport in layered solids',
  container: 'Nature Materials', volume: '25', issue: '4', pages: '114–129',
  doi: '10.1038/s41563-026-01887-2',
};

describe('citations', () => {
  it('normalises every shape of DOI a exporter emits to one identifier', () => {
    for (const input of [
      '10.1038/s41563-026-01887-2',
      'doi:10.1038/s41563-026-01887-2',
      'https://doi.org/10.1038/s41563-026-01887-2',
      'http://dx.doi.org/10.1038/s41563-026-01887-2',
    ]) expect(normalizeDoi(input)).toBe('10.1038/s41563-026-01887-2');
    expect(normalizeDoi('not a doi')).toBe('');
  });

  it('splits "Family, Given" on the comma so multi-word family names survive', () => {
    expect(parseAuthorName('van der Berg, Anke')).toEqual({ family: 'van der Berg', given: 'Anke' });
    expect(parseAuthorName('Ursula K. Le Guin')).toEqual({ family: 'Guin', given: 'Ursula K. Le' });
  });

  it('formats the same record differently in every style', () => {
    const apa = formatReference(RAO, 'apa').text;
    expect(apa).toContain('Rao, G. I., & Diaz, M.');
    expect(apa).toContain('(2026)');
    expect(apa).toContain('https://doi.org/10.1038/s41563-026-01887-2');

    // IEEE initials the given names FIRST and quotes the title.
    const ieee = formatReference(RAO, 'ieee').text;
    expect(ieee).toContain('G. I. Rao and M. Diaz');
    expect(ieee).toContain('"Thermal transport in layered solids,"');
    expect(ieee).toContain('vol. 25');
    expect(ieee).toContain('no. 4');

    // Vancouver runs initials together with no stops and no ampersand.
    const vancouver = formatReference(RAO, 'vancouver').text;
    expect(vancouver).toContain('Rao GI, Diaz M');
    expect(vancouver).toContain('2026;25(4):114–129');

    const harvard = formatReference(RAO, 'harvard').text;
    expect(harvard).toContain("'Thermal transport in layered solids'");
    expect(harvard).toContain('pp. 114–129');
  });

  it('italicises the container rather than emitting markdown a screen reader reads', () => {
    const { segments } = formatReference(RAO, 'apa');
    expect(segments.some((segment) => segment.italic && segment.text.includes('Nature Materials'))).toBe(true);
    expect(formatReference(RAO, 'apa').text).not.toContain('*');
  });

  it('numbers IEEE in-text citations and names author-date ones', () => {
    expect(inTextCitation(RAO, 'ieee', 6)).toBe('[7]');
    expect(inTextCitation(RAO, 'apa')).toBe('(Rao & Diaz, 2026)');
    expect(inTextCitation(RAO, 'harvard')).toBe('(Rao and Diaz, 2026)');
  });

  it('sorts author-date lists alphabetically and numeric lists by appearance', () => {
    const zeta = { ...RAO, key: 'zeta', authors: ['Zeta, A.'], title: 'Zeta paper', doi: '10.1/z' };
    const alpha = { ...RAO, key: 'alpha', authors: ['Alpha, B.'], title: 'Alpha paper', doi: '10.1/a' };
    expect(formatBibliography([zeta, alpha], 'apa').map((entry) => entry.record.key)).toEqual(['alpha', 'zeta']);
    // IEEE keeps insertion order, because the in-text marker IS the position.
    const ieee = formatBibliography([zeta, alpha], 'ieee');
    expect(ieee.map((entry) => entry.record.key)).toEqual(['zeta', 'alpha']);
    expect(ieee.map((entry) => entry.marker)).toEqual(['[1]', '[2]']);
  });

  it('de-duplicates on DOI, so the same paper from two databases prints once', () => {
    const fromScopus = { ...RAO, key: 'scopus1' };
    const fromPubmed = { ...RAO, key: 'pubmed9' };
    expect(formatBibliography([fromScopus, fromPubmed], 'apa')).toHaveLength(1);
  });

  it('parses BibTeX with braces and commas inside a field value', () => {
    const [record] = parseBibtex(`
      @article{rao2026,
        author = {Rao, Grace I. and Diaz, Marta},
        title = {A study of {DNA} repair, in vivo},
        journal = {Nature Materials},
        year = {2026}, volume = {25}, number = {4}, pages = {114--129},
        doi = {10.1038/s41563-026-01887-2}
      }
    `);
    expect(record.title).toBe('A study of DNA repair, in vivo');
    expect(record.authors).toEqual(['Rao, Grace I.', 'Diaz, Marta']);
    expect(record.pages).toBe('114–129');
    expect(record.type).toBe('article-journal');
  });

  it('accumulates repeated RIS author tags instead of keeping only the last', () => {
    const [record] = parseRis([
      'TY  - JOUR',
      'AU  - Rao, Grace I.',
      'AU  - Diaz, Marta',
      'TI  - Thermal transport in layered solids',
      'JO  - Nature Materials',
      'PY  - 2026',
      'SP  - 114',
      'EP  - 129',
      'DO  - 10.1038/s41563-026-01887-2',
      'ER  - ',
    ].join('\n'));
    expect(record.authors).toHaveLength(2);
    expect(record.pages).toBe('114–129');
    expect(record.doi).toBe('10.1038/s41563-026-01887-2');
  });

  it('detects the format so one import action serves .bib and .ris', () => {
    expect(parseReferences('TY  - JOUR\nTI  - X\nER  - ')).toHaveLength(1);
    expect(parseReferences('@book{k, title = {X}}')).toHaveLength(1);
    expect(parseReferences('neither')).toEqual([]);
  });

  it('round-trips through BibTeX', () => {
    const [back] = parseBibtex(toBibtex([RAO]));
    expect(back.title).toBe(RAO.title);
    expect(back.doi).toBe(RAO.doi);
    expect(back.authors).toEqual(RAO.authors);
  });

  it('reads a citation object off the canvas, taking the card title as the work title', () => {
    const record = citationFromNode({ kind: 'citation', title: 'On growth and form', authors: ['Thompson, D. W.'], year: '1917', citationType: 'book' });
    expect(record.title).toBe('On growth and form');
    expect(formatReference(record, 'apa').text).toContain('Thompson, D. W. (1917)');
  });
});

// ---------------------------------------------------------------------------
// Marking
// ---------------------------------------------------------------------------

const RUBRIC_NODE = {
  levels: ['Fail', 'Pass', 'Credit', 'Distinction', 'High Distinction'],
  totalMarks: 100,
  criteria: {
    columns: ['Fail', 'Pass', 'Credit', 'Distinction', 'High Distinction'],
    rows: [
      { label: 'Argument', weight: 3, cells: ['No thesis', 'A thesis', 'Sustained', 'Persuasive', 'Original'] },
      { label: 'Evidence', weight: 1, cells: ['None', 'Some', 'Adequate', 'Strong', 'Exemplary'] },
    ],
  },
};

describe('marking', () => {
  it('reads the matrix shape the body renders, descriptors included', () => {
    const rubric = rubricFromNode(RUBRIC_NODE);
    expect(rubric.levels).toHaveLength(5);
    expect(rubric.criteria[0].descriptors[4]).toBe('Original');
    expect(rubricProblems(rubric, 100)).toEqual([]);
  });

  it('reports a rubric that would be indefensible at an appeal', () => {
    const problems = rubricProblems(rubricFromNode({ levels: ['Pass', 'Fail'], criteria: [{ label: 'Quality' }] }), 60);
    expect(problems).toContainEqual({ code: 'missingDescriptors', criterion: 'Quality', missing: 2 });
    expect(problems).toContainEqual({ code: 'totalMismatch', totalMarks: 100, maxMarks: 60 });
  });

  it('derives the mark from placements and weights, never from a typed number', () => {
    const rubric = rubricFromNode(RUBRIC_NODE);
    // Argument carries 3/4 of 100 = 75 available; placed at index 2 of 5 levels = 0.5.
    const result = applyRubric(rubric, [
      { criterion: 'Argument', levelIndex: 2 },
      { criterion: 'Evidence', levelIndex: 4 },
    ]);
    expect(result.breakdown[0].available).toBe(75);
    expect(result.breakdown[0].marks).toBe(37.5);
    expect(result.breakdown[1].marks).toBe(25);
    expect(result.total).toBe(62.5);
    expect(result.unmarked).toEqual([]);
  });

  it('reports unmarked criteria rather than scoring them zero', () => {
    const result = applyRubric(rubricFromNode(RUBRIC_NODE), [{ criterion: 'Argument', levelIndex: 4 }]);
    expect(result.unmarked).toEqual(['Evidence']);
    expect(result.total).toBe(75);
  });

  it('grades against a scale whichever order it was typed in', () => {
    const ascending = gradeBandsFromNode([
      { grade: 'F', minimum: 0, maximum: 49 }, { grade: 'P', minimum: 50, maximum: 64 },
      { grade: 'C', minimum: 65, maximum: 74 }, { grade: 'D', minimum: 75, maximum: 100 },
    ]);
    expect(gradeFor(70, ascending)).toBe('C');
    expect(gradeFor(49, ascending)).toBe('F');
    // The pass mark is the LOWEST non-fail band, not the middle of the scale.
    expect(passMark(ascending)).toBe(50);
  });

  it('keeps the stop after an initial when there is more than one author', () => {
    // The collapse that tidies separators left by missing fields must never eat the
    // period in "G. I.," — it appears in every author-date style on every multi-author
    // reference, which is to say almost all of them.
    expect(formatReference(RAO, 'apa').text).toContain('Rao, G. I., & Diaz, M.');
    expect(formatReference({ ...RAO, type: 'book', container: undefined, publisher: 'Penguin', volume: undefined, issue: undefined, pages: undefined }, 'apa').text)
      .toBe('Rao, G. I., & Diaz, M. (2026). Thermal transport in layered solids. Penguin. https://doi.org/10.1038/s41563-026-01887-2');
  });

  it('parses the late policy out of the sentence a handbook actually contains', () => {
    expect(parseLatePolicy('-5% per day, zero after 5 days')).toMatchObject({ perDayPercent: 5, zeroAfterDays: 5 });
    expect(parseLatePolicy('10% per day')).toMatchObject({ perDayPercent: 10, zeroAfterDays: 10 });
    expect(parseLatePolicy('No late submissions accepted')).toMatchObject({ perDayPercent: 100, zeroAfterDays: 0 });
    // Unrecognised means NO penalty — never a guessed deduction from a real student.
    expect(parseLatePolicy('see the handbook')).toMatchObject({ perDayPercent: 0 });
  });

  it('ceils days late, because "10% per day" means three hours late costs 10%', () => {
    const policy = parseLatePolicy('10% per day, zero after 5 days');
    expect(applyLatePolicy(80, 3, policy)).toMatchObject({ mark: 72, daysLate: 1 });
    expect(applyLatePolicy(80, 25, policy)).toMatchObject({ mark: 64, daysLate: 2 });
    expect(applyLatePolicy(80, 24 * 6, policy).mark).toBe(0);
    expect(applyLatePolicy(80, 0, policy)).toMatchObject({ mark: 80, deducted: 0 });
  });

  it('computes lateness from the two ISO instants', () => {
    expect(hoursLate('2026-03-02T10:00:00Z', '2026-03-01T10:00:00Z')).toBe(24);
    expect(hoursLate('2026-02-28T10:00:00Z', '2026-03-01T10:00:00Z')).toBe(0);
  });

  it('flags a missing second mark as needing moderation, not as agreement', () => {
    const needed = moderationNeeded([
      { learnerRef: 'a', firstMark: 62, secondMark: 65, gap: 3, agreed: null },
      { learnerRef: 'b', firstMark: 40, secondMark: 58, gap: 18, agreed: null },
      { learnerRef: 'c', firstMark: 71, secondMark: null, gap: null, agreed: null },
      { learnerRef: 'd', firstMark: 30, secondMark: 60, gap: 30, agreed: 45 },
    ]);
    expect(needed.map((row) => row.learnerRef)).toEqual(['b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// Gradebook
// ---------------------------------------------------------------------------

const BANDS = gradeBandsFromNode([
  { grade: 'F', minimum: 0, maximum: 49 },
  { grade: 'P', minimum: 50, maximum: 74 },
  { grade: 'D', minimum: 75, maximum: 100 },
]);

describe('gradebook', () => {
  const learners = [{ ref: 's1', name: 'Ada' }, { ref: 's2', name: 'Bo' }, { ref: 's3', name: 'Cy' }];
  const columns = [
    { title: 'Essay', weight: 40, maxMarks: 100 },
    { title: 'Exam', weight: 60, maxMarks: 50 },
  ];

  it('separates "never handed in" from "handed in, not marked yet"', () => {
    const matrix = buildGradebook(learners, columns, [
      { learnerRef: 's1', assignmentTitle: 'Essay', mark: 80, submitted: true },
      { learnerRef: 's1', assignmentTitle: 'Exam', mark: 40, submitted: true },
      // Bo submitted the essay and nobody has marked it.
      { learnerRef: 's2', assignmentTitle: 'Essay', mark: null, submitted: true },
      // Cy handed in nothing at all.
    ], BANDS);

    const [ada, bo, cy] = matrix.rows;
    expect(ada.finalPercent).toBe(80);
    expect(ada.grade).toBe('D');

    // Bo is chased by a MARKER, not by a teacher — and must not read as failing.
    expect(bo.awaitingMarking).toEqual(['Essay']);
    expect(bo.missing).toEqual(['Exam']);
    expect(bo.runningPercent).toBeNull();

    expect(cy.missing).toEqual(['Essay', 'Exam']);
    expect(cy.finalPercent).toBe(0);
  });

  it('reports a running total over marked work and a final total over everything', () => {
    const matrix = buildGradebook([{ ref: 's1', name: 'Ada' }], columns, [
      { learnerRef: 's1', assignmentTitle: 'Essay', mark: 90, submitted: true },
    ], BANDS);
    // Marked work only: 90%. Whole module with the exam as a zero: 36%.
    expect(matrix.rows[0].runningPercent).toBe(90);
    expect(matrix.rows[0].finalPercent).toBe(36);
  });

  it('computes the pass rate over EVERY learner, including the ones who submitted nothing', () => {
    const matrix = buildGradebook(learners, columns, [
      { learnerRef: 's1', assignmentTitle: 'Essay', mark: 100, submitted: true },
      { learnerRef: 's1', assignmentTitle: 'Exam', mark: 50, submitted: true },
    ], BANDS);
    const stats = gradebookStats(matrix, BANDS);
    expect(stats.learnerCount).toBe(3);
    // One of three clears the pass band; excluding non-submitters would report 100%.
    expect(stats.passRate).toBe(33.33);
    expect(stats.mean).toBe(100);
  });

  it('orders the at-risk list by trouble rather than alphabetically', () => {
    const matrix = buildGradebook(learners, columns, [
      { learnerRef: 's1', assignmentTitle: 'Essay', mark: 20, submitted: true },
      { learnerRef: 's1', assignmentTitle: 'Exam', mark: 10, submitted: true },
      { learnerRef: 's2', assignmentTitle: 'Essay', mark: 90, submitted: true },
    ], BANDS);
    const risk = atRiskLearners(matrix, BANDS);
    expect(risk[0].ref).toBe('s3');
    expect(risk[0].reason).toBe('missing');
    expect(risk.find((entry) => entry.ref === 's1')?.reason).toBe('failing');
  });

  it('quotes CSV cells so a name with a comma cannot shift a row', () => {
    const matrix = buildGradebook([{ ref: 's1', name: 'Smith, Jr., Ada' }], columns, [], BANDS);
    const csv = gradebookCsv(matrix, gradebookStats(matrix, BANDS));
    expect(csv).toContain('"Smith, Jr., Ada"');
    expect(csv.split('\n')[1].split('","').length).toBeGreaterThan(3);
  });

  it('drops withdrawn learners from the roster it reads', () => {
    expect(learnersFromCohort({
      roster: [
        { ref: 's1', name: 'Ada', status: 'enrolled' },
        { ref: 's2', name: 'Bo', status: 'withdrawn' },
      ],
    }).map((learner) => learner.ref)).toEqual(['s1']);
  });

  it('reads an unmarked submission as submitted rather than as nothing', () => {
    expect(markFromSubmission({ learnerRef: 's1', assignmentRef: 'Essay', submittedAt: '2026-03-01T09:00:00Z' }))
      .toEqual({ learnerRef: 's1', assignmentTitle: 'Essay', mark: null, submitted: true });
    expect(markFromSubmission({ learnerRef: 's1', assignmentRef: 'Essay' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mathematics
// ---------------------------------------------------------------------------

describe('mathTex', () => {
  it('renders a fraction with named slots rather than as prose', () => {
    const { mathml } = renderTex('\\frac{a}{b}');
    expect(mathml).toContain('<mfrac>');
    expect(mathml).toContain('<mi>a</mi>');
  });

  it('binds scripts identically whichever order they were typed', () => {
    expect(renderTex('x_i^2').mathml).toContain('<msubsup>');
    expect(renderTex('x^2_i').mathml).toContain('<msubsup>');
  });

  it('puts sum limits above and below the operator', () => {
    const { mathml } = renderTex('\\sum_{i=1}^{n} i');
    expect(mathml).toContain('<munderover>');
    expect(mathml).toContain('∑');
  });

  it('renders the heat equation with its Greek and operators intact', () => {
    const { mathml, spoken } = renderTex('\\frac{\\partial u}{\\partial t} = \\alpha \\nabla^2 u');
    expect(mathml).toContain('∂');
    expect(mathml).toContain('α');
    expect(mathml).toContain('∇');
    expect(spoken).toContain('the fraction');
  });

  it('carries the author reading rather than the generated one when there is one', () => {
    const { mathml, spoken } = renderTex('\\alpha \\nabla^2 u', 'alpha times the Laplacian of u');
    expect(spoken).toBe('alpha times the Laplacian of u');
    expect(mathml).toContain('alttext="alpha times the Laplacian of u"');
  });

  it('keeps an unrecognised command visible instead of silently dropping a term', () => {
    expect(renderTex('\\weirdmacro x').mathml).toContain('\\weirdmacro');
  });

  it('escapes markup so an equation cannot inject into the card', () => {
    expect(renderTex('a < b').mathml).toContain('&lt;');
    expect(renderTex('x', '"><script>').mathml).not.toContain('<script>');
  });

  it('strips the delimiters people paste along with the expression', () => {
    expect(renderTex('$$x^2$$').mathml).toContain('<msup>');
    expect(renderTex('\\[x^2\\]').mathml).toContain('<msup>');
    expect(renderTex('   ').empty).toBe(true);
  });

  it('recognises prose that contains mathematics', () => {
    expect(looksLikeTex('the value \\frac{1}{2}')).toBe(true);
    expect(looksLikeTex('an ordinary sentence')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

describe('integrity', () => {
  const events = [
    { source: 'learner' as const, at: '2026-03-01T09:00:00Z', characters: 400 },
    { source: 'learner' as const, at: '2026-03-01T11:00:00Z', characters: 600 },
    { source: 'assistant' as const, at: '2026-03-01T10:00:00Z', characters: 250 },
  ];

  it('aggregates by source in a stable order', () => {
    const ledger = buildIntegrityLedger(events);
    expect(ledger.map((row) => row.source)).toEqual(['learner', 'assistant']);
    expect(ledger[0]).toMatchObject({ edits: 2, characters: 1_000, firstAt: '2026-03-01T09:00:00Z', lastAt: '2026-03-01T11:00:00Z' });
  });

  it('counts deletions as authorship rather than as zero work', () => {
    const ledger = buildIntegrityLedger([{ source: 'learner', at: '2026-03-01T09:00:00Z', characters: -300 }]);
    expect(ledger[0].characters).toBe(300);
  });

  it('reports the assistant share', () => {
    expect(assistantShare(buildIntegrityLedger(events))).toBe(20);
  });

  it('does not allege anything when assistance was declared', () => {
    const ledger = buildIntegrityLedger(events);
    expect(integrityVerdict(ledger, 'I used the AI assistant to restructure my argument.', 'assisted')).toBe('declaredAssistance');
    expect(integrityVerdict(ledger, 'All my own work.', 'assisted')).toBe('undeclaredAssistance');
  });

  it('never alleges from the share alone when there was no assistance', () => {
    const ledger = buildIntegrityLedger([{ source: 'learner', at: '2026-03-01T09:00:00Z', characters: 900 }]);
    expect(integrityVerdict(ledger, '', 'assisted')).toBe('ownWork');
    expect(integrityVerdict([], '', 'open')).toBe('noRecord');
  });

  it('reports assistant activity in a closed-book assessment as a control failure', () => {
    expect(integrityVerdict(buildIntegrityLedger(events), 'I declared it', 'closed')).toBe('closedBookViolation');
  });

  it('drafts a disclosure for the learner to edit rather than writing one', () => {
    expect(disclosureDraft(buildIntegrityLedger(events))).toMatchObject({ usedAssistant: true, assistantEdits: 1, assistantPercent: 20 });
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe('accessibility', () => {
  const lecture = { id: 'l1', data: { kind: 'lecture', title: 'Week 3', recordingUrl: 'https://x/rec' } };
  const image = { id: 'i1', data: { kind: 'image', title: 'Phase diagram' } };

  it('warns when nothing on the board requires the format', () => {
    const findings = auditAccessibility([lecture, image]);
    expect(findings.every((finding) => finding.severity === 'warning')).toBe(true);
    expect(accessibilityVerdict(findings, 2).distributable).toBe(true);
  });

  it('raises a warning to a blocker when a learner has an approved accommodation', () => {
    const accommodation = {
      id: 'a1',
      data: { kind: 'accommodation', title: 'Ada — captions', learnerRef: 's1', formats: ['captioned video'], evidenceHeld: 'held' },
    };
    const findings = auditAccessibility([lecture, image, accommodation]);
    const captions = findings.find((finding) => finding.code === 'missingCaptions');
    expect(captions?.severity).toBe('blocker');
    expect(captions?.criterion).toBe('1.2.2');
    expect(captions?.raisedBy).toBe('Ada — captions');
    expect(accessibilityVerdict(findings, 2).distributable).toBe(false);
  });

  it('ignores an accommodation whose evidence is still pending', () => {
    const pending = { id: 'a2', data: { kind: 'accommodation', formats: ['captioned video'], evidenceHeld: 'pending' } };
    expect(accommodationNeeds([pending]).captions).toBe(false);
  });

  it('accepts a summary as the text alternative for a data object', () => {
    expect(auditAccessibility([{ id: 'c1', data: { kind: 'chart', title: 'Marks', summary: 'Marks cluster at 60-70.' } }])).toEqual([]);
  });

  it('requires an author reading on an equation even though one is generated', () => {
    const findings = auditAccessibility([{ id: 'e1', data: { kind: 'equation', title: 'Heat', tex: '\\alpha' } }]);
    expect(findings[0].code).toBe('missingEquationAlt');
  });

  it('sorts blockers above warnings', () => {
    const findings = auditAccessibility([
      image,
      { id: 'a1', data: { kind: 'accommodation', formats: ['captioned video'], evidenceHeld: 'held' } },
      lecture,
    ]);
    expect(findings[0].severity).toBe('blocker');
  });
});

// ---------------------------------------------------------------------------
// Assessment mode
// ---------------------------------------------------------------------------

describe('assessment', () => {
  it('refuses the assistant in a closed-book assessment', () => {
    expect(assessmentGate('closed')).toMatchObject({ assistantAllowed: false, refusalCode: 'closedBook' });
    expect(assessmentGate('assisted')).toMatchObject({ assistantAllowed: true, recordsAssistance: true });
    expect(assessmentGate('open')).toMatchObject({ assistantAllowed: true, recordsAssistance: false });
  });

  it('takes the strictest mode on the board, so an open assignment cannot reopen an exam', () => {
    expect(boardAssessmentMode([{ assessmentMode: 'open' }, { assessmentMode: 'closed' }])).toBe('closed');
    expect(boardAssessmentMode([{ assessmentMode: 'open' }, { assessmentMode: 'assisted' }])).toBe('assisted');
    expect(boardAssessmentMode([{}, {}])).toBe('open');
  });

  it('extends a timed assessment by the duration, not the calendar', () => {
    const due = '2026-06-01T12:00:00Z';
    // 25% of a 120-minute exam is 30 minutes.
    expect(effectiveDeadline(due, 25, 120)).toBe(Date.parse('2026-06-01T12:30:00Z'));
    // With no duration there is nothing to extend — the deadline stands.
    expect(effectiveDeadline(due, 25)).toBe(Date.parse(due));
    expect(effectiveDeadline(due, 0, 120)).toBe(Date.parse(due));
  });

  it('takes the maximum entitlement rather than summing two accommodations', () => {
    const accommodations = [
      { kind: 'accommodation', learnerRef: 's1', extraTimePercent: 25, evidenceHeld: 'held' },
      { kind: 'accommodation', learnerRef: 's1', extraTimePercent: 25, evidenceHeld: 'held' },
    ];
    expect(extraTimeFor('s1', accommodations)).toBe(25);
    expect(extraTimeFor('s2', accommodations)).toBe(0);
  });

  it('ignores an expired accommodation', () => {
    const expired = [{ kind: 'accommodation', learnerRef: 's1', extraTimePercent: 50, expiresAt: '2020-01-01T00:00:00Z', evidenceHeld: 'held' }];
    expect(extraTimeFor('s1', expired, Date.parse('2026-01-01T00:00:00Z'))).toBe(0);
  });

  it('opens and closes a window from an explicit clock', () => {
    const data = { releaseAt: '2026-06-01T09:00:00Z', dueAt: '2026-06-01T11:00:00Z', durationMinutes: 120 };
    expect(windowState(data, Date.parse('2026-06-01T08:00:00Z'))).toBe('beforeRelease');
    expect(windowState(data, Date.parse('2026-06-01T10:00:00Z'))).toBe('open');
    expect(windowState(data, Date.parse('2026-06-01T11:30:00Z'))).toBe('closed');
    // With 25% extra time the same learner is still inside the window.
    expect(windowState(data, Date.parse('2026-06-01T11:30:00Z'), 25)).toBe('open');
  });
});
