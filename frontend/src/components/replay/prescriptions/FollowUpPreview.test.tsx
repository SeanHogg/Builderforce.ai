import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReplayFollowUpPreviewDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { prescription } from '@/test/replayPrescriptionFixtures';
import { PrescriptionCard } from './PrescriptionCard';

/**
 * Follow up → "Draft a new sequence" (PRD 33 §5.1.4): choosing it asks the API for a
 * draft drawn from the finding; the steps are shown EDITABLE before anyone is
 * enrolled, and confirming sends the person's edit (not the API's draft) to be
 * created as a draft sequence and enrolled into.
 */

vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: ReactNode }) => <>{children}</> }));

const preview: ReplayFollowUpPreviewDto = {
  matched: [{ contactId: 'c-ana', name: 'Ana', email: 'ana@example.com' }],
  unmatched: 0,
  draft: { subject: 'Still deciding?', body: 'Saw you looked at pricing.' },
  platformLeadIds: [],
  enrolled: 0,
};

const drafted = {
  name: 'Setup costs follow-up',
  steps: [
    { subject: 'Is setup included?', body: 'Hi {{firstName}}, setup is part of every plan.', delayDays: 0 },
    { subject: 'Still comparing?', body: 'Happy to walk through it.', delayDays: 3 },
  ],
};

const RX = prescription({ ruleId: 'objection_pattern', area: 'sales', actions: ['ticket', 'follow_up'], next: ['follow-up', 'ticket', 'dismiss'] });
const button = (action: string) => document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;

beforeEach(() => {
  vi.spyOn(replayApi, 'listSequences').mockResolvedValue([{ id: 'bbbbbbbb-cccc-4ddd-8eee-000000000001', name: 'Pricing follow-up' }]);
  vi.spyOn(replayApi, 'listCodingAgents').mockResolvedValue([]);
  vi.spyOn(replayApi, 'actOnPrescription').mockImplementation(async (_site, id, _action, input) => {
    if (input?.confirm) {
      return {
        prescription: prescription({ id, status: 'applied', actionKind: 'follow_up', next: ['dismiss'] }),
        followUp: { ...preview, enrolled: 1, createdSequence: { id: 'seq-new', name: 'Setup follow-up' } },
      };
    }
    return { prescription: prescription({ id }), followUp: input?.draftSequence ? { ...preview, draftSequence: drafted } : preview };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Follow up — draft a new sequence', () => {
  it('drafts on request, shows the steps editable, and enrols the EDITED sequence', async () => {
    render(<PrescriptionCard siteId="site-1" prescription={RX} />);
    fireEvent.click(button('follow-up'));
    const shown = await screen.findByTestId('follow-up-preview');
    // No model call until the person asks for a new sequence.
    expect(replayApi.actOnPrescription).toHaveBeenCalledTimes(1);
    expect(replayApi.actOnPrescription).toHaveBeenLastCalledWith('site-1', 'rx-1', 'follow-up', { confirm: false });

    fireEvent.click(within(shown).getByRole('radio', { name: 'replay.prescription.followUp.modeNew' }));
    await waitFor(() => expect(replayApi.actOnPrescription).toHaveBeenLastCalledWith('site-1', 'rx-1', 'follow-up', { confirm: false, draftSequence: true }));

    const editor = await screen.findByTestId('follow-up-sequence-draft');
    const name = within(editor).getByRole('textbox', { name: 'replay.prescription.followUp.newSequence.nameLabel' });
    expect(name).toHaveValue('Setup costs follow-up');
    const subjects = within(editor).getAllByRole('textbox', { name: 'replay.prescription.followUp.newSequence.subjectLabel' });
    expect(subjects.map((s) => (s as HTMLInputElement).value)).toEqual(['Is setup included?', 'Still comparing?']);
    // Nothing enrolled while the draft is only shown.
    expect(replayApi.actOnPrescription).toHaveBeenCalledTimes(2);

    fireEvent.change(name, { target: { value: 'Setup follow-up' } });
    fireEvent.change(subjects[1]!, { target: { value: 'Any questions left?' } });
    const delays = within(editor).getAllByRole('spinbutton', { name: 'replay.prescription.followUp.newSequence.delayLabel' });
    fireEvent.change(delays[1]!, { target: { value: '5' } });

    const create = within(screen.getByTestId('follow-up-preview')).getByRole('button', { name: 'replay.prescription.followUp.createAndEnrol 1' });
    expect(create).not.toBeDisabled();
    fireEvent.click(create);
    await waitFor(() => expect(replayApi.actOnPrescription).toHaveBeenLastCalledWith('site-1', 'rx-1', 'follow-up', {
      confirm: true,
      newSequence: {
        name: 'Setup follow-up',
        steps: [
          { subject: 'Is setup included?', body: 'Hi {{firstName}}, setup is part of every plan.', delayDays: 0 },
          { subject: 'Any questions left?', body: 'Happy to walk through it.', delayDays: 5 },
        ],
      },
      contactIds: ['c-ana'],
    }));
    expect(await screen.findByText('replay.prescription.result.sequenceCreated Setup follow-up 1')).toBeInTheDocument();
  });

  it('a draft with no name cannot be created', async () => {
    render(<PrescriptionCard siteId="site-1" prescription={RX} />);
    fireEvent.click(button('follow-up'));
    const shown = await screen.findByTestId('follow-up-preview');
    fireEvent.click(within(shown).getByRole('radio', { name: 'replay.prescription.followUp.modeNew' }));
    const editor = await screen.findByTestId('follow-up-sequence-draft');
    fireEvent.change(within(editor).getByRole('textbox', { name: 'replay.prescription.followUp.newSequence.nameLabel' }), { target: { value: '  ' } });
    expect(within(shown).getByRole('button', { name: 'replay.prescription.followUp.createAndEnrol 1' })).toBeDisabled();
  });
});
