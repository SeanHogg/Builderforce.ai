import { describe, expect, it } from 'vitest';
import {
  summarizeDevex, summarizeBenchmark, percentileOf, answerScore,
  type CampaignWithQuestions, type ResponseRow,
} from './devexInsights';
import type { SurveyQuestion } from '../devex/devexSurveys';

// ── Fixtures ────────────────────────────────────────────────────────────────
const qFlow: SurveyQuestion = { id: 'q_flow', type: 'rating', prompt: 'Flow?', dimension: 'flow' };
const qTool: SurveyQuestion = { id: 'q_tool', type: 'rating', prompt: 'Tooling?', dimension: 'tooling' };
const qNps: SurveyQuestion = { id: 'q_nps', type: 'nps', prompt: 'Recommend?', dimension: 'sentiment' };
const qNote: SurveyQuestion = { id: 'q_note', type: 'text', prompt: 'Anything?', dimension: 'flow' };

function campaign(over: Partial<CampaignWithQuestions> = {}): CampaignWithQuestions {
  return {
    id: 1, title: 'Q3', periodMonth: '2024-09', status: 'closed',
    recipientCount: null, openedAt: '2024-09-01T00:00:00.000Z',
    questions: [qFlow, qTool, qNps, qNote], ...over,
  };
}

function resp(over: Partial<ResponseRow> = {}): ResponseRow {
  return { campaignId: 1, answers: {}, segments: {}, submittedAt: '2024-09-02T00:00:00.000Z', ...over };
}

describe('answerScore', () => {
  it('normalizes each question type to 0..100', () => {
    expect(answerScore(qFlow, 5)).toBe(100);
    expect(answerScore(qFlow, 1)).toBe(0);
    expect(answerScore(qNps, 10)).toBe(100);
    expect(answerScore({ ...qFlow, type: 'boolean' }, true)).toBe(100);
    expect(answerScore(qNote, 'hi')).toBeNull();
  });
});

describe('percentileOf', () => {
  it('interpolates between ranks', () => {
    expect(percentileOf([10, 20, 30, 40, 50], 50)).toBe(30);
    expect(percentileOf([10, 20, 30, 40, 50], 75)).toBe(40);
    expect(percentileOf([], 50)).toBeNull();
    expect(percentileOf([42], 90)).toBe(42);
  });
});

describe('summarizeDevex', () => {
  it('ranks dimensions worst-first (rank 1 = lowest score)', () => {
    const responses = [
      resp({ answers: { q_flow: 2, q_tool: 5 } }), // flow=25, tool=100
      resp({ answers: { q_flow: 2, q_tool: 5 } }),
    ];
    const out = summarizeDevex([campaign()], responses, 90);
    const flow = out.byDimension.find((d) => d.dimension === 'flow')!;
    const tool = out.byDimension.find((d) => d.dimension === 'tooling')!;
    expect(flow.avgScore).toBe(25);
    expect(tool.avgScore).toBe(100);
    expect(flow.rank).toBe(1);     // worst → rank 1 (most attention)
    expect(tool.rank).toBe(2);
    expect(out.byDimension[0]!.dimension).toBe('flow'); // array is worst-first
  });

  it('counts free-text answers as comments and rating questions per dimension', () => {
    const out = summarizeDevex([campaign()], [
      resp({ answers: { q_flow: 4, q_note: 'too many meetings' } }),
      resp({ answers: { q_flow: 3, q_note: '   ' } }), // blank text not counted
    ], 90);
    const flow = out.byDimension.find((d) => d.dimension === 'flow')!;
    expect(flow.commentCount).toBe(1);
    expect(flow.questionCount).toBe(2); // q_flow (rating) + q_note (text) both tagged flow
  });

  it('splits sentiment into negative / neutral / positive', () => {
    const out = summarizeDevex([campaign()], [
      resp({ answers: { q_flow: 1 } }), // 0 → negative
      resp({ answers: { q_flow: 3 } }), // 50 → neutral
      resp({ answers: { q_flow: 5 } }), // 100 → positive
    ], 90);
    const flow = out.byDimension.find((d) => d.dimension === 'flow')!;
    expect(flow.sentiment).toEqual({ negative: 1, neutral: 1, positive: 1 });
  });

  it('hides segment groups below the anonymity threshold', () => {
    const big = Array.from({ length: 3 }, () => resp({ segments: { team: 'Blue' }, answers: { q_flow: 4 } }));
    const small = [resp({ segments: { team: 'Green' }, answers: { q_flow: 5 } })];
    const out = summarizeDevex([campaign()], [...big, ...small], 90);
    const teams = out.segments.byKind.team ?? [];
    expect(teams.map((r) => r.label)).toEqual(['Blue']); // Green (n=1) suppressed
    expect(out.segments.threshold).toBe(3);
    expect(out.participation.bySegment.team).toEqual([{ label: 'Blue', count: 3 }]);
  });

  it('builds a cumulative participation timeline by day', () => {
    const out = summarizeDevex([campaign()], [
      resp({ submittedAt: '2024-09-02T08:00:00.000Z', answers: { q_flow: 4 } }),
      resp({ submittedAt: '2024-09-02T09:00:00.000Z', answers: { q_flow: 4 } }),
      resp({ submittedAt: '2024-09-03T09:00:00.000Z', answers: { q_flow: 4 } }),
    ], 90);
    expect(out.participation.timeline).toEqual([
      { date: '2024-09-02', responses: 2, cumulative: 2 },
      { date: '2024-09-03', responses: 1, cumulative: 3 },
    ]);
  });

  it('averages response time as submit − campaign open', () => {
    const out = summarizeDevex(
      [campaign({ openedAt: '2024-09-01T00:00:00.000Z' })],
      [resp({ submittedAt: '2024-09-01T00:05:00.000Z', answers: { q_flow: 4 } })],
      90,
    );
    expect(out.avgResponseTimeSec).toBe(300); // 5 minutes
  });

  it('uses recipient counts for the response rate when present', () => {
    const out = summarizeDevex(
      [campaign({ recipientCount: 100 })],
      Array.from({ length: 90 }, () => resp({ answers: { q_flow: 4 } })),
      90,
    );
    expect(out.totalRecipients).toBe(100);
    expect(out.responseRatePct).toBe(90);
  });

  it('derives per-period dimension ranks across periods (slope chart)', () => {
    const c1 = campaign({ id: 1, periodMonth: '2024-06' });
    const c2 = campaign({ id: 2, periodMonth: '2024-09' });
    const out = summarizeDevex([c1, c2], [
      resp({ campaignId: 1, answers: { q_flow: 5, q_tool: 1 } }), // flow best, tool worst
      resp({ campaignId: 2, answers: { q_flow: 1, q_tool: 5 } }), // flipped
    ], 365);
    expect(out.dimensionTrend).toHaveLength(2);
    expect(out.dimensionTrend[0]!.ranks.tooling).toBe(1); // tool worst in Jun
    expect(out.dimensionTrend[1]!.ranks.flow).toBe(1);    // flow worst in Sep
    const flow = out.byDimension.find((d) => d.dimension === 'flow')!;
    expect(flow.trendDelta).toBe(-100); // 100 (Jun) → 0 (Sep)
  });
});

describe('summarizeBenchmark', () => {
  it('takes the percentile of per-tenant averages per dimension and overall', () => {
    const perTenant = [
      { index: 50, byDimension: { flow: 40 } },
      { index: 60, byDimension: { flow: 60 } },
      { index: 70, byDimension: { flow: 80 } },
    ];
    const b = summarizeBenchmark(perTenant, 50, 365);
    expect(b.index).toBe(60);
    expect(b.byDimension.flow).toBe(60);
    expect(b.companies).toBe(3);
    expect(b.percentile).toBe(50);
  });
});
