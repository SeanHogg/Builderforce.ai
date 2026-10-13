import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PageRect } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { prescription } from '@/test/replayPrescriptionFixtures';
import { pageReview, visual } from '@/test/replayPageFixtures';
import { PageReview } from './PageReview';

/**
 * THE page review (PRD 33 §5.2): the fold with numbered callouts — numbered in
 * patch-op order across the page's fixes — the device switch, the score and facts,
 * the fixes as THE card (vision findings labelled "observed from the screen"), and
 * ONE prompt for the fixes left checked.
 */

vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));

const RECTS: PageRect[] = [
  { selector: '#hero h1', x: 100, y: 80, w: 600, h: 60, label: 'Simple pricing', role: 'heading' },
  { selector: '#cta', x: 100, y: 300, w: 200, h: 48, label: 'Learn more', role: 'cta' },
  { selector: '#banner', x: 0, y: 0, w: 1440, h: 40, label: 'Sale banner', role: 'section' },
];

const FIX_A = prescription({
  id: 'rx-a',
  ruleId: 'content_cta_vague',
  area: 'content',
  next: ['copy-prompt', 'dismiss'],
  visual: visual({ ops: [
    { op: 'setText', selector: '#hero h1', text: 'Pricing that grows with you' },
    { op: 'setText', selector: '#cta', text: 'Start free' },
  ] }),
});
const FIX_B = prescription({
  id: 'rx-b',
  ruleId: 'a11y_contrast',
  area: 'accessibility',
  next: ['copy-prompt', 'dismiss'],
  visual: visual({ ops: [
    { op: 'setStyle', selector: '#cta', property: 'color', value: 'black' },
    { op: 'hide', selector: '#banner' },
  ] }),
});
const OBSERVED = prescription({ id: 'rx-seen', ruleId: 'vision_observed', source: 'observed', area: 'ux', next: ['dismiss'], visual: null });

beforeEach(() => {
  vi.spyOn(replayApi, 'pageReview').mockResolvedValue(pageReview({ prescriptions: [FIX_A, FIX_B, OBSERVED] }));
  vi.spyOn(replayApi, 'captureRects').mockResolvedValue(RECTS);
  vi.spyOn(replayApi, 'captureAssetUrl').mockImplementation(async (path: string) => `blob:${path}`);
  vi.spyOn(replayApi, 'pagePrompt').mockImplementation(async (_site, _path, audience, ids) => ({
    audience, prompt: `prompt for ${(ids ?? []).join('+')}`, selectors: [], prescriptionIds: [...(ids ?? [])],
  }));
  vi.spyOn(replayApi, 'listCodingAgents').mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderReview() {
  render(<PageReview siteId="site-1" path="/pricing" push={vi.fn()} />);
}

describe('PageReview', () => {
  it('numbers the callouts in patch-op order across the page’s fixes', async () => {
    renderReview();
    const list = await screen.findByTestId('page-callouts');
    await waitFor(() => expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Simple pricing', 'Learn more', 'Sale banner']));
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('data-callout'))).toEqual(['1', '2', '3']);
    // The page-level fold carries the three numbered markers, each a labelled button.
    const fold = screen.getAllByTestId('callout-shot')[0]!;
    await waitFor(() => expect(within(fold).getAllByRole('button').map((b) => b.getAttribute('data-callout'))).toEqual(['1', '2', '3']));
    expect(within(fold).getByRole('button', { name: 'replay.page.calloutAria 2 Learn more' })).toBeInTheDocument();
    expect(replayApi.captureAssetUrl).toHaveBeenCalledWith('/api/replay/pages/captures/cap-desktop/fold?site=site-1');
  });

  it('switches device: the phone capture of the same release, its own rect map', async () => {
    renderReview();
    await screen.findByTestId('page-callouts');
    expect(screen.getAllByTestId('callout-shot')[0]).toHaveAttribute('data-device', 'desktop');
    fireEvent.click(screen.getAllByRole('tab', { name: /replay\.page\.device\.phone/ })[0]!);
    await waitFor(() => expect(screen.getAllByTestId('callout-shot')[0]).toHaveAttribute('data-device', 'phone'));
    expect(replayApi.captureRects).toHaveBeenCalledWith('site-1', 'cap-phone');
    expect(replayApi.captureAssetUrl).toHaveBeenCalledWith('/api/replay/pages/captures/cap-phone/fold?site=site-1');
  });

  it('labels a vision finding as observed from the screen, and only that one', async () => {
    renderReview();
    await screen.findByTestId('page-callouts');
    const labels = screen.getAllByTestId('observed-label');
    expect(labels).toHaveLength(1);
    expect(labels[0]).toHaveTextContent('replay.prescription.observed');
    expect(labels[0]!.closest('[data-rule]')).toHaveAttribute('data-rule', 'vision_observed');
  });

  it('shows the score and the facts of the capture', async () => {
    renderReview();
    await screen.findByTestId('page-callouts');
    expect(screen.getAllByTestId('score-ring')).toHaveLength(6);
    expect(screen.getByTestId('fact-meters').querySelector('[data-fact="h1Count"]')).toHaveAttribute('data-ok', 'false');
  });

  it('builds ONE prompt from the fixes left checked', async () => {
    renderReview();
    await screen.findByTestId('page-callouts');
    await waitFor(() => expect(replayApi.pagePrompt).toHaveBeenCalledWith('site-1', '/pricing', 'coding_agent', ['rx-a', 'rx-b', 'rx-seen']));
    const boxes = screen.getAllByRole('checkbox', { name: 'replay.page.includeInPrompt' });
    fireEvent.click(boxes[1]!);
    await waitFor(() => expect(replayApi.pagePrompt).toHaveBeenLastCalledWith('site-1', '/pricing', 'coding_agent', ['rx-a', 'rx-seen']));
    expect(await screen.findByDisplayValue('prompt for rx-a+rx-seen')).toBeInTheDocument();
  });
});
