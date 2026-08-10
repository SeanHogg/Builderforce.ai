import { describe, expect, it } from 'vitest';
import {
  PITCH_COMPETITIONS, PITCH_MAX_SCORE, formatPitchDuration, isPitchObjectKind, pitchApplicationAnswers,
  pitchApplicationReadiness, pitchBeats, pitchCompetition, pitchCriteria, pitchEligibility, pitchObjectMarkdown,
  pitchQaCoverage, pitchQaItems, pitchReadiness, pitchReadinessTone, pitchRuntimeSeconds, pitchSpokenSeconds,
  pitchTimingTone, pitchWeakestCriteria,
} from './pitchCompetition';
import type { CreationNodeData } from '@/components/creation-canvas/types';

const object = (data: Partial<CreationNodeData> & { kind: CreationNodeData['kind'] }): CreationNodeData => ({ title: 'Untitled', ...data });

describe('competition presets', () => {
  it('falls back to SXSW Pitch for an unknown or missing id', () => {
    expect(pitchCompetition('does-not-exist').id).toBe('sxsw-pitch');
    expect(pitchCompetition(undefined).id).toBe('sxsw-pitch');
  });

  it('ships SXSW Pitch with six equally weighted criteria and a 3+3 minute format', () => {
    const sxsw = pitchCompetition('sxsw-pitch');
    expect(sxsw.criteria).toHaveLength(6);
    expect(new Set(sxsw.criteria.map((criterion) => criterion.weight))).toEqual(new Set([1]));
    expect(sxsw.pitchSeconds).toBe(180);
    expect(sxsw.qaSeconds).toBe(180);
    expect(sxsw.eligibility.map((rule) => rule.id)).toContain('fundingCap');
    expect(sxsw.categories).toHaveLength(8);
  });

  it('gives every preset a unique id and a complete rubric', () => {
    expect(new Set(PITCH_COMPETITIONS.map((competition) => competition.id)).size).toBe(PITCH_COMPETITIONS.length);
    PITCH_COMPETITIONS.forEach((competition) => {
      expect(competition.criteria.length).toBeGreaterThan(0);
      expect(competition.beats.length).toBeGreaterThan(0);
      expect(competition.questions.length).toBeGreaterThan(0);
    });
  });

  it('recognises exactly the four pitch kinds', () => {
    expect(isPitchObjectKind('pitch')).toBe(true);
    expect(isPitchObjectKind('pitchApplication')).toBe(true);
    expect(isPitchObjectKind('slides')).toBe(false);
  });
});

describe('pitch timing', () => {
  it('seeds an empty pitch from the competition outline and fills the limit', () => {
    const beats = pitchBeats(object({ kind: 'pitch', competitionId: 'sxsw-pitch' }));
    expect(beats.length).toBeGreaterThan(4);
    expect(pitchRuntimeSeconds(beats)).toBe(180);
    expect(beats.every((beat) => !beat.written)).toBe(true);
  });

  it('counts the written script rather than the budget, so an overrun is visible', () => {
    const words = Array.from({ length: 260 }, () => 'word').join(' ');
    const beats = pitchBeats(object({ kind: 'pitch', beats: [{ id: 'hook', seconds: 20, script: words }] }));
    expect(beats[0]!.written).toBe(true);
    // 260 words at 130 wpm is two minutes of speech inside a twenty-second beat.
    expect(pitchSpokenSeconds(beats)).toBe(120);
    expect(pitchRuntimeSeconds(beats)).toBe(20);
  });

  it('grades an overrun rather than treating any excess the same', () => {
    expect(pitchTimingTone(180, 180)).toBe('good');
    expect(pitchTimingTone(190, 180)).toBe('watch');
    expect(pitchTimingTone(240, 180)).toBe('risk');
  });

  it('formats a runtime the way a stopwatch shows it', () => {
    expect(formatPitchDuration(180)).toBe('3:00');
    expect(formatPitchDuration(65)).toBe('1:05');
    expect(formatPitchDuration(-5)).toBe('0:00');
  });

  it('keeps a renamed beat verbatim and drops its catalog key', () => {
    const [renamed] = pitchBeats(object({ kind: 'pitch', beats: [{ id: 'hook', label: 'The Netflix moment', seconds: 20 }] }));
    expect(renamed!.label).toBe('The Netflix moment');
    expect(renamed!.labelKey).toBeNull();
    const [seeded] = pitchBeats(object({ kind: 'pitch' }));
    expect(seeded!.labelKey).toBe('label.beat.hook');
  });
});

describe('scorecard', () => {
  it('reads an unscored rubric as zero percent ready', () => {
    const criteria = pitchCriteria(object({ kind: 'pitchScorecard' }));
    expect(criteria).toHaveLength(6);
    expect(pitchReadiness(criteria)).toBe(0);
    expect(pitchReadinessTone(0)).toBe('risk');
  });

  it('weights criteria rather than averaging them', () => {
    const data = object({
      kind: 'pitchScorecard',
      competitionId: 'demo-day',
      criteria: [
        { id: 'solution', weight: 3, score: 5 },
        { id: 'team', weight: 1, score: 1 },
      ],
    });
    // (5*3 + 1*1) / (4 * 5) = 80%
    expect(pitchReadiness(pitchCriteria(data))).toBe(80);
  });

  it('never divides by a zero total weight', () => {
    expect(pitchReadiness(pitchCriteria(object({ kind: 'pitchScorecard', criteria: [{ id: 'a', weight: 0, score: 5 }] })))).toBe(0);
  });

  it('clamps a score that arrives out of range', () => {
    const [criterion] = pitchCriteria(object({ kind: 'pitchScorecard', criteria: [{ id: 'innovation', score: 99 }] }));
    expect(criterion!.score).toBe(PITCH_MAX_SCORE);
  });

  it('leads with where marks are being lost', () => {
    const criteria = pitchCriteria(object({
      kind: 'pitchScorecard',
      criteria: [
        { id: 'innovation', weight: 1, score: 5 },
        { id: 'team', weight: 1, score: 1 },
        { id: 'viability', weight: 1, score: 2 },
      ],
    }));
    expect(pitchWeakestCriteria(criteria, 2).map((criterion) => criterion.id)).toEqual(['team', 'viability']);
  });

  it('grades readiness into the same three tones the board paints', () => {
    expect(pitchReadinessTone(80)).toBe('good');
    expect(pitchReadinessTone(60)).toBe('watch');
    expect(pitchReadinessTone(20)).toBe('risk');
  });
});

describe('judge Q&A', () => {
  it('seeds the drill from the rubric, because every criterion is a question', () => {
    const items = pitchQaItems(object({ kind: 'pitchQa', competitionId: 'sxsw-pitch' }));
    expect(items).toHaveLength(6);
    expect(pitchQaCoverage(items).percent).toBe(0);
  });

  it('reports coverage and drills the unanswered first', () => {
    const items = pitchQaItems(object({
      kind: 'pitchQa',
      questions: [
        { id: 'a', question: 'Why now?', answer: 'Because the cost curve broke.', strength: 4 },
        { id: 'b', question: 'Who pays?' },
      ],
    }));
    const coverage = pitchQaCoverage(items);
    expect(coverage.answered).toBe(1);
    expect(coverage.percent).toBe(50);
    expect(coverage.weakest[0]!.id).toBe('b');
  });

  it('drops a row with no question rather than rendering an empty card', () => {
    expect(pitchQaItems(object({ kind: 'pitchQa', questions: [{ id: 'a', answer: 'orphaned' }] }))).toHaveLength(0);
  });
});

describe('application', () => {
  it('blocks submission until every rule is met and every answer is written', () => {
    const data = object({ kind: 'pitchApplication', competitionId: 'sxsw-pitch' });
    const readiness = pitchApplicationReadiness(pitchApplicationAnswers(data), pitchEligibility(data));
    expect(readiness.submittable).toBe(false);
    expect(readiness.unmetRules).toHaveLength(6);
  });

  it('flags an over-length answer, which is what gets an entry thrown out', () => {
    const answers = pitchApplicationAnswers(object({
      kind: 'pitchApplication',
      answers: [{ id: 'oneLiner', maxChars: 10, answer: 'far too long to fit' }],
    }));
    expect(answers[0]!.over).toBe(true);
    expect(answers[0]!.chars).toBe(19);
    expect(pitchApplicationReadiness(answers, []).submittable).toBe(false);
  });

  it('is submittable when the rules are met and nothing overruns', () => {
    const answers = pitchApplicationAnswers(object({
      kind: 'pitchApplication',
      answers: [{ id: 'oneLiner', maxChars: 140, answer: 'One clear sentence.' }],
    }));
    const eligibility = pitchEligibility(object({ kind: 'pitchApplication', eligibility: [{ id: 'fundingCap', met: true }] }));
    expect(pitchApplicationReadiness(answers, eligibility).submittable).toBe(true);
  });
});

describe('export', () => {
  it('serializes the structure rather than a title stub', () => {
    const markdown = pitchObjectMarkdown(object({
      kind: 'pitch', title: 'Our pitch',
      beats: [{ id: 'hook', label: 'Hook', seconds: 20, script: 'Delivery teams ship half of what they plan.' }],
    }))!;
    expect(markdown).toContain('# Our pitch');
    expect(markdown).toContain('## Hook · 0:20');
    expect(markdown).toContain('Delivery teams ship half of what they plan.');
  });

  it('writes the eligibility gate into the exported entry', () => {
    const markdown = pitchObjectMarkdown(object({
      kind: 'pitchApplication', title: 'Entry',
      eligibility: [{ id: 'fundingCap', met: true }, { id: 'oneProduct', met: false }],
      answers: [{ id: 'oneLiner', maxChars: 140, answer: 'One clear sentence.' }],
    }))!;
    expect(markdown).toContain('- [x] Under $10M raised in combined funding');
    expect(markdown).toContain('- [ ] Exactly one product or service entered per company');
    expect(markdown).toContain('19 / 140 characters');
  });

  it('leaves every other canvas object alone', () => {
    expect(pitchObjectMarkdown(object({ kind: 'note', content: 'hello' }))).toBeNull();
  });
});
