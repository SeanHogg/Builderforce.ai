import { describe, expect, it } from 'vitest';
import {
  CAREER_APPLICATION_STAGES, CAREER_OBJECT_KINDS, careerRunwayBand, CREATION_OBJECT_KINDS,
  HIRING_OBJECT_KINDS, isCareerObjectKind, isOpenApplicationStage,
} from '@builderforce/creation-canvas-contract';
import { CAREER_LABELS, CAREER_OBJECT_SPECS, CAREER_STATUSES } from './careerObjects';
import './specObjectSets';
import {
  makeSpecDeriveBoard, specFieldValue, specMutableFields, specObjectNamespace,
} from './specObjects';

/** The one spec lookup every case below needs. Throws rather than returning undefined so
 *  a renamed kind fails on the line that renamed it, not three assertions later. */
const spec = (kind: string) => {
  const found = CAREER_OBJECT_SPECS.find((entry) => entry.kind === kind);
  if (!found) throw new Error(`no career spec for ${kind}`);
  return found;
};

/** One field's value, resolved through the same path the node body uses. */
const value = (kind: string, field: string, data: Record<string, unknown>, board = makeSpecDeriveBoard([])) => {
  const declared = spec(kind).fields.find((entry) => entry.name === field);
  if (!declared) throw new Error(`no field ${kind}.${field}`);
  return specFieldValue(declared, data, board);
};

describe('career vocabulary', () => {
  it('declares one spec per contract kind, and no more', () => {
    expect(CAREER_OBJECT_SPECS.map((entry) => entry.kind).sort()).toEqual([...CAREER_OBJECT_KINDS].sort());
  });

  it('registers every career kind in the canvas contract', () => {
    for (const kind of CAREER_OBJECT_KINDS) expect(CREATION_OBJECT_KINDS).toContain(kind);
  });

  it('recognises its own kinds and rejects a hiring one', () => {
    expect(isCareerObjectKind('job')).toBe(true);
    expect(isCareerObjectKind('runway')).toBe(true);
    expect(isCareerObjectKind('jobPosting')).toBe(false);
    expect(isCareerObjectKind(null)).toBe(false);
  });

  it('takes no word the employer vocabulary already owns', () => {
    // The whole reason this is a second vocabulary rather than nine more hiring kinds.
    // A collision here would put a requisition and a posting-somebody-else-opened under
    // one noun, which is the `customerInterview` collision re-opened from the other side.
    for (const kind of CAREER_OBJECT_KINDS) expect(HIRING_OBJECT_KINDS).not.toContain(kind);
  });

  it('leaves the bare noun `interview` reserved for the hiring domain', () => {
    // `interviews` is a hiring DOMAIN entity in the kernel `objects` table. `interviewPrep`
    // is not a compromise spelling — it names the REHEARSAL, which persists between
    // sessions and exists before the event does.
    expect(CREATION_OBJECT_KINDS).not.toContain('interview');
    expect(CREATION_OBJECT_KINDS).toContain('interviewPrep');
  });

  it('has a label and a status fallback for every kind', () => {
    for (const entry of CAREER_OBJECT_SPECS) {
      expect(CAREER_LABELS[entry.kind as keyof typeof CAREER_LABELS]).toBeTruthy();
      expect(CAREER_STATUSES[entry.defaultStatus]).toBeTruthy();
    }
  });

  it('never starts a blank card in a state that reads as configured', () => {
    // On this seat the lie is worse than elsewhere: a blank application reading
    // "Submitted" is somebody believing they applied.
    for (const entry of CAREER_OBJECT_SPECS) {
      const status = CAREER_STATUSES[entry.defaultStatus] ?? '';
      expect(status.toLowerCase()).not.toMatch(/^(live|ready|active|complete|submitted|applied)$/);
    }
  });

  it('resolves every kind under the career i18n namespace', () => {
    for (const entry of CAREER_OBJECT_SPECS) {
      expect(specObjectNamespace(entry.kind)).toBe('creationCanvas.career');
    }
  });

  it('gives every field a hint the model can act on', () => {
    for (const entry of CAREER_OBJECT_SPECS) {
      for (const field of entry.fields) {
        expect(field.hint.length).toBeGreaterThan(20);
        if (field.render === 'rows') expect(field.columns?.length).toBeGreaterThan(0);
      }
    }
  });

  it('advertises no action a kind has no field to support', () => {
    for (const entry of CAREER_OBJECT_SPECS) {
      expect(entry.actions.length).toBeGreaterThan(0);
      expect(entry.fields.length).toBeGreaterThan(1);
    }
  });

  it('declares the two dates somebody is actually ambushed by', () => {
    // A deadline flag is what makes a `trigger` able to watch a field at all. The pair
    // that matter on this seat: a posting closing, and a follow-up going by.
    const deadlines = CAREER_OBJECT_SPECS.flatMap((entry) => entry.fields.filter((field) => field.deadline).map((field) => `${entry.kind}.${field.name}`));
    expect(deadlines).toContain('job.closesAt');
    expect(deadlines).toContain('jobApplication.followUpAt');
    expect(deadlines).toContain('interviewPrep.scheduledAt');
  });

  it('keeps every computed number out of the authorable list', () => {
    // A stored total on this card is a total that disagrees with the rows beneath it,
    // and on a job search the rows are the part somebody edits at 11pm.
    for (const name of ['total', 'open', 'responseRate', 'interviewRate', 'longestSilence']) {
      expect(specMutableFields('applicationPipeline')).not.toContain(name);
    }
    expect(specMutableFields('runway')).not.toContain('weeksRemaining');
    expect(specMutableFields('runway')).not.toContain('pressure');
    // …while the money the person actually knows stays theirs to type.
    for (const name of ['savings', 'monthlyExpenses', 'monthlyIncome']) {
      expect(specMutableFields('runway')).toContain(name);
    }
  });
});

describe('the application pipeline', () => {
  const ROWS = [
    { role: 'Staff engineer', employer: 'Acme', stage: 'drafting', jobRef: 'Acme staff engineer' },
    { role: 'Platform lead', employer: 'Borex', stage: 'submitted', submittedAt: '2026-08-01' },
    { role: 'Principal', employer: 'Cygnet', stage: 'interviewing', submittedAt: '2026-07-01', lastResponseAt: '2026-07-20' },
    { role: 'Architect', employer: 'Delta', stage: 'declined', submittedAt: '2026-06-01', lastResponseAt: '2026-06-20' },
  ];

  it('counts what is on the board as well as what is in the table', () => {
    const board = makeSpecDeriveBoard([
      { kind: 'jobApplication', title: 'Echo SRE', jobRef: 'Echo SRE', stage: 'submitted', submittedAt: '2026-08-05' },
    ]);
    expect(value('applicationPipeline', 'total', { applications: ROWS }, board)).toBe(5);
  });

  it('counts one application once when it exists both ways', () => {
    // The row and the card name the same posting. Two entries for one application would
    // make every rate below it wrong, in the direction that flatters the search.
    const board = makeSpecDeriveBoard([
      { kind: 'jobApplication', title: 'Acme staff engineer', jobRef: 'Acme staff engineer', stage: 'drafting' },
    ]);
    expect(value('applicationPipeline', 'total', { applications: ROWS }, board)).toBe(4);
  });

  it('counts only the live ones as open', () => {
    // declined is closed; drafting, submitted and interviewing are not.
    expect(value('applicationPipeline', 'open', { applications: ROWS })).toBe(3);
  });

  it('excludes drafts from the reply-rate denominator', () => {
    // Three submitted, two of which replied. Counting the unsent one against yourself is
    // the arithmetic that makes a search feel worse than it is.
    expect(value('applicationPipeline', 'responseRate', { applications: ROWS })).toBe(67);
  });

  it('separates a document problem from a conversion problem', () => {
    // One of three submitted reached an interview. The two rates answering differently
    // is the entire diagnostic value of the card.
    expect(value('applicationPipeline', 'interviewRate', { applications: ROWS })).toBe(33);
  });

  it('reports no rate at all when nothing has been submitted', () => {
    // Never a zero: 0% reads as a catastrophe, and it is an answer nobody computed.
    const drafts = [{ role: 'A', stage: 'drafting' }, { role: 'B', stage: 'drafting' }];
    expect(value('applicationPipeline', 'responseRate', { applications: drafts })).toBeUndefined();
    expect(value('applicationPipeline', 'interviewRate', { applications: drafts })).toBeUndefined();
  });

  it('ignores a closed application when reporting the longest silence', () => {
    // The declined one is the oldest and is not worth chasing; the interviewing one is.
    const quiet = value('applicationPipeline', 'longestSilence', { applications: ROWS });
    const since = (iso: string) => Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
    expect(quiet).toBe(Math.max(since('2026-08-01'), since('2026-07-20')));
  });
});

describe('the application stage vocabulary', () => {
  it('carries the two states the employer-side row has no reason to record', () => {
    expect(CAREER_APPLICATION_STAGES).toContain('drafting');
    expect(CAREER_APPLICATION_STAGES).toContain('interviewing');
  });

  it('agrees with itself about what is still worth chasing', () => {
    for (const stage of ['drafting', 'submitted', 'shortlisted', 'interviewing', 'offered']) {
      expect(isOpenApplicationStage(stage)).toBe(true);
    }
    for (const stage of ['accepted', 'declined', 'withdrawn', 'noReply']) {
      expect(isOpenApplicationStage(stage)).toBe(false);
    }
    // An unset stage is not an open application — it is a row nobody has filled in.
    expect(isOpenApplicationStage('')).toBe(false);
    expect(isOpenApplicationStage(undefined)).toBe(false);
  });
});

describe('the runway', () => {
  const MONEY = { currency: 'GBP', savings: 12_000, monthlyExpenses: 2_600, monthlyIncome: 400 };

  it('computes the burn from the two numbers printed beside it', () => {
    expect(value('runway', 'netMonthlyBurn', MONEY)).toBe(2_200);
  });

  it('leads with the weeks', () => {
    // 12,000 / 2,200 months, in weeks.
    expect(value('runway', 'weeksRemaining', MONEY)).toBe(23);
  });

  it('moves the cliff when a known amount lands', () => {
    const withInvoice = { ...MONEY, expectedInflows: [{ label: 'Final invoice', amount: 4_400, inMonths: 1 }] };
    expect(value('runway', 'weeksRemaining', withInvoice)).toBe(32);
  });

  it('reports nothing rather than zero when income covers the outgoings', () => {
    // A runway that never runs out and one that ran out this morning are the two answers
    // a single number cannot tell apart, so the safe one is silence.
    expect(value('runway', 'weeksRemaining', { savings: 5_000, monthlyExpenses: 1_000, monthlyIncome: 1_400 })).toBeUndefined();
    expect(value('runway', 'pressure', { savings: 5_000, monthlyExpenses: 1_000, monthlyIncome: 1_400 })).toBe('none');
  });

  it('grades the same band the server would', () => {
    expect(careerRunwayBand(3)).toBe('critical');
    expect(careerRunwayBand(12)).toBe('urgent');
    expect(careerRunwayBand(20)).toBe('planning');
    expect(careerRunwayBand(40)).toBe('comfortable');
    expect(careerRunwayBand(120)).toBe('comfortable');
    expect(careerRunwayBand(null)).toBe('none');
  });

  it('grades the card from the same arithmetic it prints', () => {
    // The one inconsistency this card cannot survive: a band computed from a different
    // sum than the weeks shown above it.
    expect(value('runway', 'pressure', MONEY)).toBe('planning');
    expect(value('runway', 'pressure', { savings: 1_500, monthlyExpenses: 2_600 })).toBe('critical');
  });

  it('says nothing at all when the money is not there to compute from', () => {
    expect(value('runway', 'weeksRemaining', { currency: 'GBP' })).toBeUndefined();
    expect(value('runway', 'netMonthlyBurn', { currency: 'GBP' })).toBeUndefined();
  });
});

describe('interview prep', () => {
  it('reports how far through the rehearsal actually is', () => {
    const questions = [
      { question: 'Tell me about a time…', answer: 'Drafted.' },
      { question: 'Design a rate limiter', answer: '' },
      { question: 'Why us?', answer: 'Drafted.' },
      { question: 'Biggest failure?' },
    ];
    expect(value('interviewPrep', 'rehearsed', { questions })).toBe(50);
  });

  it('does not claim 0% for a set nobody has generated yet', () => {
    expect(value('interviewPrep', 'rehearsed', {})).toBeUndefined();
  });

  it('keeps the person\'s own answers theirs to write', () => {
    // `questions` is authorable — the tool supplies the question and the rubric, the
    // person supplies the answer. A model writing it produces something undeliverable.
    expect(specMutableFields('interviewPrep')).toContain('questions');
  });
});

describe('the cover letter', () => {
  it('counts the words before somebody sends 900 of them', () => {
    expect(value('coverLetter', 'wordCount', { body: 'one two three four five' })).toBe(5);
  });

  it('reports nothing for an unwritten letter', () => {
    expect(value('coverLetter', 'wordCount', { body: '   ' })).toBeUndefined();
  });
});

describe('one application, one lifecycle', () => {
  it('measures the silence from the last time THEY replied', () => {
    const days = value('jobApplication', 'daysSinceResponse', { submittedAt: '2026-06-01', lastResponseAt: '2026-07-01' });
    expect(days).toBe(Math.round((Date.now() - Date.parse('2026-07-01')) / 86_400_000));
  });

  it('falls back to the submission when they never have', () => {
    const days = value('jobApplication', 'daysSinceResponse', { submittedAt: '2026-07-01' });
    expect(days).toBe(Math.round((Date.now() - Date.parse('2026-07-01')) / 86_400_000));
  });

  it('says nothing about an application that has not gone', () => {
    expect(value('jobApplication', 'daysSinceResponse', { stage: 'drafting' })).toBeUndefined();
  });
});
