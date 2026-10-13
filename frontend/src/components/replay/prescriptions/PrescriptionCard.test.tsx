import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { REPLAY_PRESCRIPTION_ROUTE_ACTIONS, type ReplayFollowUpPreviewDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { prescription } from '@/test/replayPrescriptionFixtures';
import { PrescriptionCard } from './PrescriptionCard';
import { PRESCRIPTION_ACTION_UI } from './prescriptionActionUi';

/**
 * THE fix card (PRD 33 §5.1, D13): its buttons are the DTO's `next` drawn through
 * `PRESCRIPTION_ACTION_UI` (no branch per action); Dismiss needs a written reason;
 * Follow up shows who and what BEFORE anyone is enrolled; Start test / Publish /
 * Revert ask first; low confidence never prints a point estimate.
 */

const confirmSpy = vi.hoisted(() => vi.fn<(opts: unknown) => Promise<boolean>>());
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));
vi.mock('@/components/RoleGate', () => ({
  RoleGate: ({ capability, children }: { capability: string; children: ReactNode }) => <div data-capability={capability}>{children}</div>,
}));

const SEQUENCE = 'bbbbbbbb-cccc-4ddd-8eee-000000000001';

const preview: ReplayFollowUpPreviewDto = {
  matched: [
    { contactId: 'c-ana', name: 'Ana', email: 'ana@example.com' },
    { contactId: 'c-bo', name: 'Bo', email: 'bo@example.com' },
  ],
  unmatched: 3,
  draft: { subject: 'Still deciding?', body: 'Saw you looked at pricing.' },
  platformLeadIds: [],
  enrolled: 0,
};

function actionButtons(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-action]')].map((el) => el.getAttribute('data-action') ?? '');
}

const button = (action: string) => document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;

beforeEach(() => {
  confirmSpy.mockReset();
  vi.spyOn(replayApi, 'actOnPrescription').mockImplementation(async (_site, id, action) => ({
    prescription: prescription({ id, status: action === 'dismiss' ? 'dismissed' : 'applied', next: [] }),
  }));
  vi.spyOn(replayApi, 'listCodingAgents').mockResolvedValue([]);
  vi.spyOn(replayApi, 'listSequences').mockResolvedValue([
    { id: SEQUENCE, name: 'Pricing follow-up' },
    { id: 'bbbbbbbb-cccc-4ddd-8eee-000000000002', name: 'Onboarding' },
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PrescriptionCard', () => {
  it('renders the finding from its rule over its params, the evidence, the prescription and the change as before → after', () => {
    const push = vi.fn();
    render(<PrescriptionCard siteId="site-1" prescription={prescription()} push={push} />);
    expect(screen.getByRole('heading', { name: 'replay.prescription.rule.rage_on_element.title /pricing Buy 4.2 120' })).toBeInTheDocument();
    expect(screen.getByText('replay.prescription.area.ux')).toBeInTheDocument();
    expect(screen.getByText('Make the Buy button respond to the first tap #1.')).toBeInTheDocument();
    const diff = screen.getByTestId('prescription-diff');
    expect(diff).toHaveTextContent('replay.prescription.rule.rage_on_element.title');
    expect(diff).toHaveTextContent('Disable the button while the order is sent.');

    fireEvent.click(screen.getByRole('button', { name: 'replay.prescription.evidenceAria 1 0:12' }));
    expect(push).toHaveBeenCalledWith({ kind: 'recording', id: 'rec-1', tab: 'replay', t: 12 });
  });

  it('draws exactly the actions `next` offers, through the registry, inside the MANAGER gate', () => {
    const { unmount } = render(<PrescriptionCard siteId="site-1" prescription={prescription({ next: ['fix', 'ticket', 'dismiss'] })} />);
    expect(actionButtons()).toEqual(['fix', 'ticket', 'dismiss']);
    expect(button('fix')).toHaveTextContent(`replay.prescription.actions.${PRESCRIPTION_ACTION_UI.fix.labelKey}`);
    expect(document.querySelector('[data-capability]')).toHaveAttribute('data-capability', 'insights.actOnFixes');
    unmount();

    render(<PrescriptionCard siteId="site-1" prescription={prescription({ status: 'worse', next: ['revert'] })} />);
    expect(actionButtons()).toEqual(['revert']);
  });

  it('has a registry row for every route action the API accepts', () => {
    for (const action of REPLAY_PRESCRIPTION_ROUTE_ACTIONS) expect(PRESCRIPTION_ACTION_UI[action]).toBeDefined();
  });

  it('runs a one-press action and keeps its answer', async () => {
    render(<PrescriptionCard siteId="site-1" prescription={prescription()} />);
    fireEvent.click(button('ticket'));
    await waitFor(() => expect(replayApi.actOnPrescription).toHaveBeenCalledWith('site-1', 'rx-1', 'ticket', {}));
    expect(await screen.findByText('replay.prescription.status.applied')).toBeInTheDocument();
  });

  it('Dismiss requires a written reason before anything is sent', async () => {
    render(<PrescriptionCard siteId="site-1" prescription={prescription()} />);
    fireEvent.click(button('dismiss'));
    const form = screen.getByRole('form', { name: 'replay.prescription.dismiss.title' });
    const submit = within(form).getByRole('button', { name: 'replay.prescription.dismiss.submit' });
    expect(submit).toBeDisabled();
    fireEvent.submit(form);
    expect(replayApi.actOnPrescription).not.toHaveBeenCalled();
    // Inline in the card: no second overlay.
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.change(within(form).getByRole('textbox', { name: 'replay.prescription.dismiss.reasonLabel' }), { target: { value: '  We redesigned that page.  ' } });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(replayApi.actOnPrescription).toHaveBeenCalledWith('site-1', 'rx-1', 'dismiss', { reason: 'We redesigned that page.' }));
  });

  it('Follow up shows the matched contacts and the draft before a confirm enrols them', async () => {
    vi.mocked(replayApi.actOnPrescription).mockImplementation(async (_site, id, _action, input) => (
      input?.confirm
        ? { prescription: prescription({ id, status: 'applied', actionKind: 'follow_up', next: ['follow-up', 'dismiss'] }), followUp: { ...preview, enrolled: 1 } }
        : { prescription: prescription({ id }), followUp: preview }
    ));
    render(<PrescriptionCard
      siteId="site-1"
      prescription={prescription({ ruleId: 'pricing_hesitation', area: 'sales', actions: ['follow_up', 'ticket'], next: ['follow-up', 'ticket', 'dismiss'] })}
    />);
    fireEvent.click(button('follow-up'));
    await waitFor(() => expect(replayApi.actOnPrescription).toHaveBeenCalledWith('site-1', 'rx-1', 'follow-up', { confirm: false }));

    const shown = await screen.findByTestId('follow-up-preview');
    expect(within(shown).getByText('Ana')).toBeInTheDocument();
    expect(within(shown).getByText('Bo')).toBeInTheDocument();
    expect(within(shown).getByText('Still deciding?')).toBeInTheDocument();
    expect(within(shown).getByTestId('follow-up-draft')).toHaveTextContent('Saw you looked at pricing.');
    expect(within(shown).getByText('replay.prescription.followUp.unmatched 3')).toBeInTheDocument();
    // Nothing enrolled yet, and nothing can be until a sequence is chosen.
    expect(replayApi.actOnPrescription).toHaveBeenCalledTimes(1);
    const enrol = within(shown).getByRole('button', { name: 'replay.prescription.followUp.enrol 2' });
    expect(enrol).toBeDisabled();

    fireEvent.click(within(shown).getByRole('checkbox', { name: 'replay.prescription.followUp.contactAria Bo' }));
    // The sequence is picked from the workspace's sequences, not pasted.
    const sequence = within(shown).getByRole('combobox', { name: 'replay.prescription.followUp.sequenceLabel' });
    await waitFor(() => expect(sequence).not.toBeDisabled());
    expect(replayApi.listSequences).toHaveBeenCalledWith('site-1');
    expect(within(sequence).getByRole('option', { name: 'Pricing follow-up' })).toBeInTheDocument();
    fireEvent.change(sequence, { target: { value: SEQUENCE } });
    const enrolOne = within(shown).getByRole('button', { name: 'replay.prescription.followUp.enrol 1' });
    expect(enrolOne).not.toBeDisabled();
    fireEvent.click(enrolOne);
    await waitFor(() => expect(replayApi.actOnPrescription).toHaveBeenLastCalledWith('site-1', 'rx-1', 'follow-up', {
      confirm: true,
      sequenceObjectId: SEQUENCE,
      contactIds: ['c-ana'],
    }));
    expect(await screen.findByText('replay.prescription.result.enrolled 1')).toBeInTheDocument();
  });

  it('Start test, Publish preview and Revert ask first', async () => {
    render(<PrescriptionCard siteId="site-1" prescription={prescription({ status: 'applied', actionKind: 'test', next: ['start-test', 'dismiss'] })} />);
    confirmSpy.mockResolvedValueOnce(false);
    fireEvent.click(button('start-test'));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'replay.prescription.confirm.start-test.title', destructive: true })));
    expect(replayApi.actOnPrescription).not.toHaveBeenCalled();

    confirmSpy.mockResolvedValueOnce(true);
    fireEvent.click(button('start-test'));
    await waitFor(() => expect(replayApi.actOnPrescription).toHaveBeenCalledWith('site-1', 'rx-1', 'start-test', {}));
  });

  it('prints the impact range with its confidence — and never a point estimate on low confidence', () => {
    const { unmount } = render(<PrescriptionCard siteId="site-1" prescription={prescription()} />);
    expect(screen.getByTestId('prescription-impact')).toHaveTextContent('replay.prescription.impact.estimateApprox 38 replay.prescription.unit.conversions 30 22 51');
    expect(screen.getByTestId('prescription-impact')).toHaveTextContent('replay.prescription.confidence.medium');
    unmount();

    render(<PrescriptionCard
      siteId="site-1"
      prescription={prescription({ impact: { estimate: 38, low: null, high: null, unit: 'conversions', confidence: 'low', horizonDays: 30, estimated: true } })}
    />);
    const impact = screen.getByTestId('prescription-impact');
    expect(impact).toHaveTextContent('replay.prescription.impact.none');
    expect(impact).not.toHaveTextContent('38');
    expect(impact).toHaveAttribute('data-confidence', 'low');
  });

  it('shows a range but no point on low confidence when the interval is known', () => {
    render(<PrescriptionCard
      siteId="site-1"
      prescription={prescription({ impact: { estimate: 38, low: 4, high: 61, unit: 'conversions', confidence: 'low', horizonDays: 30, estimated: false } })}
    />);
    const impact = screen.getByTestId('prescription-impact');
    expect(impact).toHaveTextContent('replay.prescription.impact.rangeExact 4 61');
    expect(impact).not.toHaveTextContent('38');
  });

  it('shows the measured before → after and its verdict', () => {
    render(<PrescriptionCard
      siteId="site-1"
      prescription={prescription({
        status: 'worked',
        next: [],
        measured: { before: 0.08, after: 0.03, delta: -0.05, verdict: 'worked', source: 'ticket_effect', releaseKey: 'rel-b', measuredAt: '2026-10-10T00:00:00.000Z' },
      })}
    />);
    const measured = screen.getByTestId('prescription-measured');
    expect(measured).toHaveAttribute('data-verdict', 'worked');
    expect(measured).toHaveTextContent('replay.prescription.measured.beforeAfter 0.08 0.03');
    expect(actionButtons()).toEqual([]);
  });

  it('compact: the finding as before → after, the impact and who makes it — and opens the fix kind', () => {
    const push = vi.fn();
    render(<PrescriptionCard compact siteId="site-1" prescription={prescription()} push={push} />);
    const card = screen.getByTestId('prescription-card');
    expect(card).toHaveAttribute('data-compact', 'true');
    expect(card).toHaveTextContent('Disable the button while the order is sent.');
    expect(card).toHaveTextContent('replay.prescription.maker.fix');
    expect(actionButtons()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /^replay\.prescription\.openAria / }));
    expect(push).toHaveBeenCalledWith({ kind: 'fix', id: 'rx-1', tab: 'change' });
  });

  it('Fix it runs on the coding agent picked (agentRef)', async () => {
    vi.mocked(replayApi.listCodingAgents).mockResolvedValue([
      { ref: '11', name: 'Builder' },
      { ref: '12', name: 'Reviewer' },
    ]);
    render(<PrescriptionCard siteId="site-1" prescription={prescription()} />);
    const picker = await screen.findByRole('combobox', { name: 'replay.prescription.agent.label' });
    expect(replayApi.listCodingAgents).toHaveBeenCalledWith('site-1');
    fireEvent.change(picker, { target: { value: '12' } });
    fireEvent.click(button('fix'));
    await waitFor(() => expect(replayApi.actOnPrescription).toHaveBeenCalledWith('site-1', 'rx-1', 'fix', { agentRef: '12' }));
  });

  it('with no coding agent, says Fix it creates a ticket only and sends no agent', async () => {
    render(<PrescriptionCard siteId="site-1" prescription={prescription()} />);
    expect(await screen.findByTestId('fix-ticket-only')).toHaveTextContent('replay.prescription.agent.none');
    expect(screen.queryByRole('combobox', { name: 'replay.prescription.agent.label' })).toBeNull();
    fireEvent.click(button('fix'));
    await waitFor(() => expect(replayApi.actOnPrescription).toHaveBeenCalledWith('site-1', 'rx-1', 'fix', {}));
  });

  it('Copy prompt opens the fix kind on its Prompt tab', () => {
    const push = vi.fn();
    render(<PrescriptionCard siteId="site-1" prescription={prescription({ next: ['copy-prompt', 'dismiss'] })} push={push} />);
    fireEvent.click(button('copy-prompt'));
    expect(push).toHaveBeenCalledWith({ kind: 'fix', id: 'rx-1', tab: 'prompt' });
    expect(replayApi.actOnPrescription).not.toHaveBeenCalled();
  });

  it('Apply to the page asks who the prompt is for, then shows the bundled prompt', async () => {
    vi.mocked(replayApi.actOnPrescription).mockResolvedValue({
      prescription: prescription({ status: 'applied', actionKind: 'apply_page', next: ['copy-prompt', 'dismiss'] }),
      prompt: 'Improve one page of my website.',
      selectors: [],
      prescriptionIds: ['rx-1', 'rx-2'],
    });
    render(<PrescriptionCard siteId="site-1" prescription={prescription({ next: ['apply-page', 'dismiss'] })} />);
    fireEvent.click(button('apply-page'));
    expect(replayApi.actOnPrescription).not.toHaveBeenCalled();
    const form = screen.getByRole('form', { name: 'replay.prescription.applyPage.title' });
    fireEvent.click(within(form).getByRole('tab', { name: 'replay.prompt.audience.site_builder' }));
    fireEvent.click(within(form).getByRole('button', { name: 'replay.prescription.applyPage.submit' }));
    await waitFor(() => expect(replayApi.actOnPrescription).toHaveBeenCalledWith('site-1', 'rx-1', 'apply-page', { audience: 'site_builder' }));
    expect(await screen.findByDisplayValue('Improve one page of my website.')).toBeInTheDocument();
    expect(screen.getByText('replay.prescription.result.page 2')).toBeInTheDocument();
  });
});
