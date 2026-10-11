/**
 * Wire adapters for the INNOVATION FUNNEL — the panel of `/insights/delivery`
 * (the retired `/insights/funnel` route redirects there), which reads
 * `/api/innovation/funnel` and the idea list beneath it.
 *
 * Both answer from the ONE idea list in `domain/samplePlanning`, so the funnel's
 * totals and the rows under them cannot disagree. Loaded lazily by the registry
 * (see `LAZY_FIXTURE_MODULES`), so it stays out of the root layout's closure.
 */

import type { FunnelMetrics, InnovationIdea } from '@/lib/builderforceApi';
import { SAMPLE_PROJECTS } from '../../domain/sampleWorkspace';
import { SAMPLE_FUNNEL_STAGES, SAMPLE_IDEAS, SAMPLE_INITIATIVES, type SampleIdea } from '../../domain/samplePlanning';
import { dayOffsetToIso, exact, type GuestFixture, type GuestFixtureContext } from '../../domain/guestFixture';

/** The ideas in scope: `?projectId=` narrows to the ones that became that
 *  project, exactly as the funnel panel's project filter does on the wire. */
function ideasFor({ query }: GuestFixtureContext): SampleIdea[] {
  const wanted = query.get('projectId');
  if (!wanted) return SAMPLE_IDEAS;
  const key = SAMPLE_PROJECTS.find((project) => String(project.id) === wanted)?.key;
  return SAMPLE_IDEAS.filter((idea) => idea.projectKey != null && idea.projectKey === key);
}

/**
 * The innovation funnel over the sample ideas — the same arithmetic as the API's
 * `computeFunnelMetrics`: stages are linear, so an idea at a later stage has
 * passed the earlier ones and "reached" is cumulative; `killed` is an off-ramp.
 */
function funnel(ideas: SampleIdea[]): FunnelMetrics {
  const stageIndex = (stage: string) => (SAMPLE_FUNNEL_STAGES as readonly string[]).indexOf(stage);
  const active = ideas.filter((idea) => idea.stage !== 'killed');
  const reachedAt = (index: number) => active.filter((idea) => stageIndex(idea.stage) >= index).length;
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const shipped = active.filter((idea) => stageIndex(idea.stage) >= stageIndex('shipped'));
  return {
    totalIdeas: ideas.length,
    activeIdeas: active.length,
    killedCount: ideas.length - active.length,
    ideaToShipPct: active.length ? (shipped.length / active.length) * 100 : null,
    avgIdeaToShipDays: mean(shipped.map((idea) => idea.stageEnteredDayOffset - idea.createdDayOffset)),
    stages: SAMPLE_FUNNEL_STAGES.map((stage, index) => {
      const here = active.filter((idea) => stageIndex(idea.stage) === index);
      const reached = reachedAt(index);
      const previous = index === 0 ? active.length : reachedAt(index - 1);
      return {
        stage,
        current: here.length,
        reached,
        conversionFromPrevPct: index === 0 ? null : previous > 0 ? (reached / previous) * 100 : null,
        // Offsets are relative to the read, so "days here" is the offset's magnitude.
        avgDaysInStage: mean(here.map((idea) => -idea.stageEnteredDayOffset)),
      };
    }),
  };
}

export const innovationFixtures: GuestFixture[] = [
  {
    id: 'insights.funnel',
    match: exact('/api/innovation/funnel'),
    respond: (context): FunnelMetrics => funnel(ideasFor(context)),
  },
  {
    id: 'insights.funnel.ideas',
    // The list under the funnel — the same ideas the totals above it count.
    match: exact('/api/innovation/ideas'),
    respond: (context): InnovationIdea[] => ideasFor(context).map((idea) => ({
      id: idea.id,
      initiativeId: idea.projectKey
        ? (SAMPLE_INITIATIVES.find((initiative) => initiative.project.key === idea.projectKey)?.id ?? null)
        : null,
      title: idea.title,
      description: null,
      stage: idea.stage,
      linkedProjectId: SAMPLE_PROJECTS.find((project) => project.key === idea.projectKey)?.id ?? null,
      impact: null,
      effort: null,
      confidence: null,
      outcome: null,
      outcomeValue: null,
      killedReason: null,
      createdAt: dayOffsetToIso(context.now, idea.createdDayOffset),
      stageEnteredAt: dayOffsetToIso(context.now, idea.stageEnteredDayOffset),
    })),
  },
];
