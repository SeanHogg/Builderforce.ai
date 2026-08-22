import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComposedAnswer, QueryAnswer } from '@/lib/dashboardsApi';

/**
 * The Ask card renders an ANSWER, not a number.
 *
 * The regression this guards is the one the composed answer was built to fix: the
 * card used to render `answer.value` and `answer.explanation` and nothing else, so
 * a question with no single-number answer ("how are things looking?") came back
 * as one figure about a metric nobody asked for. If a future edit collapses this
 * back to the lead metric, every assertion about the OTHER readings fails.
 *
 * The registry-backed chart grid is stubbed. It is exercised for real by
 * `askWidgetIds.test.ts` (which asserts every id the server can name resolves);
 * mounting the genuine `WidgetGrid` here would mount a dozen live widget cards and
 * fire their collector reads, which tests the registry, not this card.
 */

const query = vi.hoisted(() => vi.fn());
vi.mock('@/lib/dashboardsApi', () => ({ dashboardsApi: { query } }));

vi.mock('@/components/widgets/WidgetGrid', () => ({
  WidgetGrid: ({ ids, days }: { ids: string[]; days: number }) => (
    <div data-testid="answer-widgets" data-days={days}>{ids.join(',')}</div>
  ),
}));

const { ASK_COMPONENTS } = await import('@/components/insights/widgets/askWidget');

const AskCard = ASK_COMPONENTS[0].Surface;

function reading(matchedMetric: string, label: string, value: number | null, unit = ''): QueryAnswer {
  return { matchedMetric, label, value, unit, days: 30, explanation: `${label} explanation.`, source: 'keyword' };
}

const COMPOSED: ComposedAnswer = {
  topic: 'delivery',
  headline: 'Delivery needs attention over the last 30 days: lead time for changes 4.1 hours, change failure rate 12%.',
  narrative: 'Lead time explanation. Change failure explanation.',
  source: 'keyword',
  days: 30,
  matchedMetric: 'dora.leadTime',
  label: 'Lead time for changes',
  value: 4.1,
  unit: 'hours',
  explanation: 'Lead time explanation.',
  metrics: [
    reading('dora.leadTime', 'Lead time for changes', 4.1, 'hours'),
    reading('dora.changeFailureRate', 'Change failure rate', 12, '%'),
  ],
  widgetIds: ['delivery.verdict', 'dora.lead-time'],
};

async function ask(question = 'are we behind?') {
  render(<AskCard days={30} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: question } });
  fireEvent.click(screen.getByRole('button'));
}

beforeEach(() => { query.mockReset(); });

describe('the Ask card', () => {
  it('renders the composed answer as a mini-dashboard', async () => {
    query.mockResolvedValue(COMPOSED);
    await ask();

    // The headline, assembled server-side from the figures it names.
    expect(await screen.findByText(COMPOSED.headline)).toBeInTheDocument();
    // EVERY reading, not just the lead one — this is the whole regression.
    expect(screen.getByText('Lead time for changes')).toBeInTheDocument();
    expect(screen.getByText('Change failure rate')).toBeInTheDocument();
    expect(screen.getByText('4.1h')).toBeInTheDocument();
    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(screen.getByText(COMPOSED.narrative)).toBeInTheDocument();
  });

  it('renders the auto-chosen widgets over the window the QUESTION named', async () => {
    query.mockResolvedValue({ ...COMPOSED, days: 7 });
    await ask('are we behind this week?');

    const grid = await screen.findByTestId('answer-widgets');
    expect(grid).toHaveTextContent('delivery.verdict,dora.lead-time');
    // Not the dashboard's 30-day window: the question overrides it, which is the
    // point of asking in words.
    expect(grid).toHaveAttribute('data-days', '7');
  });

  it('names every whitelisted metric the answer used', async () => {
    query.mockResolvedValue(COMPOSED);
    await ask();
    await screen.findByText(COMPOSED.headline);
    expect(screen.getByText('dora.leadTime')).toBeInTheDocument();
    expect(screen.getByText('dora.changeFailureRate')).toBeInTheDocument();
  });

  it('still warns, BEFORE the numbers, when the question was not understood', async () => {
    query.mockResolvedValue({
      ...COMPOSED, topic: 'metric', source: 'default', widgetIds: [],
      metrics: [reading('finance.spend', 'LLM spend', 1234, 'USD')],
    });
    await ask('is the vibe good');

    const warning = await screen.findByRole('status');
    expect(warning).toHaveTextContent('dashboards.ask.notUnderstood');
    // "Before" is structural, not cosmetic: a defaulted answer that reads like a
    // match is the failure the `source` field exists to prevent.
    expect(warning.compareDocumentPosition(screen.getByText('LLM spend')))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('renders a single-metric answer through the same path', async () => {
    query.mockResolvedValue({
      ...COMPOSED, topic: 'metric', headline: 'LLM spend looks steady.', narrative: 'Spend explanation.',
      metrics: [reading('finance.spend', 'LLM spend', 1234, 'USD')], widgetIds: ['finance.spend-trend'],
    });
    await ask('how much did we spend');

    expect(await screen.findByText('LLM spend looks steady.')).toBeInTheDocument();
    expect(screen.getByText('LLM spend')).toBeInTheDocument();
    expect(await screen.findByTestId('answer-widgets')).toHaveTextContent('finance.spend-trend');
  });

  it('omits the chart section entirely when the answer chose no widgets', async () => {
    query.mockResolvedValue({ ...COMPOSED, widgetIds: [] });
    await ask();
    await screen.findByText(COMPOSED.headline);
    expect(screen.queryByTestId('answer-widgets')).toBeNull();
  });

  it('shows the failure rather than an empty card when the query fails', async () => {
    query.mockRejectedValue(new Error('gateway down'));
    await ask();
    expect(await screen.findByText('gateway down')).toBeInTheDocument();
  });

  it('does not ask on an empty question', async () => {
    render(<AskCard days={30} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(query).not.toHaveBeenCalled());
  });
});
