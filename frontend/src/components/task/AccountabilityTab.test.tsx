import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AccountabilityTab } from './AccountabilityTab';
import { kanbanApi } from '@/lib/builderforceApi';
import type { AccountabilityGap, AccountabilityReport, ManifestParticipant } from '@/lib/kanban';

vi.mock('@/lib/builderforceApi', () => ({
  kanbanApi: {
    accountability: vi.fn(),
    listRoles: vi.fn(),
    signoff: vi.fn(),
    assessResource: vi.fn(),
    materializeParticipants: vi.fn(),
  },
}));

const mockAccountability = vi.mocked(kanbanApi.accountability);
const mockSignoff = vi.mocked(kanbanApi.signoff);

function participant(over: Partial<ManifestParticipant> = {}): ManifestParticipant {
  return {
    id: 'p1', stageKey: 'in_review', roleKey: 'product-owner', roleName: 'Product Owner',
    responsibility: 'reviewer', required: true, source: 'template',
    assigneeKind: 'agent', assigneeRef: 'pm-t1', assigneeName: 'Product Manager',
    state: 'in_progress', signoffId: null, childTaskId: null, evidence: null, note: null,
    ...over,
  };
}

function report(over: Partial<AccountabilityReport> = {}): AccountabilityReport {
  return {
    taskId: 169, requiredCount: 1, completedCount: 0, percentComplete: 0,
    participants: [participant()], signoffs: [], gaps: [], ...over,
  };
}

function gap(over: Partial<AccountabilityGap> = {}): AccountabilityGap {
  return {
    kind: 'unsigned', severity: 'advisory', roleKey: 'product-owner', roleName: 'Product Owner',
    stageKey: 'in_review', responsibility: 'reviewer', state: 'in_progress', reason: null,
    detail: 'Work is in progress; sign-off not recorded yet.',
    ...over,
  };
}

beforeEach(() => {
  mockAccountability.mockReset();
  mockSignoff.mockReset();
  vi.mocked(kanbanApi.listRoles).mockResolvedValue([]);
});

describe('AccountabilityTab gap banner', () => {
  /**
   * The reported bug: the banner listed every required role as an error while the
   * table below showed those same roles as `Assigned` / `In progress`. Outstanding
   * work now sits in its own advisory list, and its label is the row's state.
   */
  it('lists outstanding roles under the advisory heading, using their State wording', async () => {
    mockAccountability.mockResolvedValue(report({ gaps: [gap()] }));
    render(<AccountabilityTab taskId={169} />);

    expect(await screen.findByText(/accountability\.gaps\.outstandingTitle 1/)).toBeInTheDocument();
    expect(screen.queryByText(/accountability\.gaps\.title/)).not.toBeInTheDocument();
    // The gap line says what the row's chip says ("In progress"), not a blanket
    // "Unsigned" — so the phrase appears twice: once in the banner, once in the chip.
    expect(screen.getAllByText(/accountability\.state\.in_progress/)).toHaveLength(2);
  });

  it('keeps genuinely-wrong gaps in the blocking banner', async () => {
    mockAccountability.mockResolvedValue(report({
      gaps: [gap({ kind: 'unstaffed', severity: 'blocking', state: 'unstaffed', detail: 'x' })],
    }));
    render(<AccountabilityTab taskId={169} />);

    expect(await screen.findByText(/accountability\.gaps\.title 1/)).toBeInTheDocument();
    expect(screen.queryByText(/accountability\.gaps\.outstandingTitle/)).not.toBeInTheDocument();
  });

  /** Two identical "Architect" lines were unmatchable to the two Architect rows. */
  it('qualifies each gap by responsibility and lane so duplicate roles are distinguishable', async () => {
    mockAccountability.mockResolvedValue(report({
      gaps: [
        gap({ roleKey: 'architect', roleName: 'Architect', responsibility: 'owner', stageKey: 'in_progress' }),
        gap({ roleKey: 'architect', roleName: 'Architect', responsibility: 'reviewer', stageKey: 'in_review' }),
      ],
    }));
    render(<AccountabilityTab taskId={169} />);

    await screen.findByText(/accountability\.gaps\.outstandingTitle 2/);
    // Lane rendered through the shared status label, not the raw `in_review` key.
    expect(screen.getByText(/accountability\.responsibility\.owner · In Progress/)).toBeInTheDocument();
    expect(screen.getByText(/accountability\.responsibility\.reviewer · In Review/)).toBeInTheDocument();
  });

  it('renders no banner at all when there is nothing to report', async () => {
    mockAccountability.mockResolvedValue(report());
    render(<AccountabilityTab taskId={169} />);

    await screen.findByText('Product Owner');
    expect(screen.queryByText(/accountability\.gaps\./)).not.toBeInTheDocument();
  });
});

describe('AccountabilityTab sign-off', () => {
  /**
   * `kanbanApi.signoff` shipped with no caller: the tab listed every unsigned role
   * and offered no way to sign one, so an operator who navigated here to clear a
   * blocker found a read-only table. This locks the action to the row.
   */
  it('records a sign-off for the row’s role and reloads the report', async () => {
    mockAccountability.mockResolvedValue(report());
    // `signoff` returns the recomputed ticket AUDIT, not the accountability report —
    // the tab re-reads the report itself, which is what this asserts.
    mockSignoff.mockResolvedValue({ status: 'pass', coverage: 1, requiredCount: 1, satisfiedCount: 1, missing: [] });
    render(<AccountabilityTab taskId={169} />);

    fireEvent.click(await screen.findByText('accountability.signoff.action'));
    fireEvent.click(screen.getByText(/accountability\.signoff\.confirm Product Owner/));

    await waitFor(() => expect(mockSignoff).toHaveBeenCalledWith(169, {
      roleKey: 'product-owner',
      laneKey: 'in_review',
      verdict: 'approved',
      summary: undefined,
      waiveReason: undefined,
    }));
    await waitFor(() => expect(mockAccountability).toHaveBeenCalledTimes(2));
  });

  it('blocks a waiver until a reason is given (the server rejects one without)', async () => {
    mockAccountability.mockResolvedValue(report());
    render(<AccountabilityTab taskId={169} />);

    fireEvent.click(await screen.findByText('accountability.signoff.action'));
    // The shared <Select> is a custom combobox (button + portaled listbox), so the
    // verdict is chosen by opening it and clicking the option — not fireEvent.change.
    fireEvent.click(screen.getByLabelText('accountability.table.verdict'));
    fireEvent.click(screen.getByRole('option', { name: 'accountability.verdict.waived' }));

    const confirm = screen.getByText(/accountability\.signoff\.confirm/) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('accountability.signoff.reasonRequired'), {
      target: { value: 'Covered by the platform audit' },
    });
    expect(confirm.disabled).toBe(false);

    fireEvent.click(confirm);
    await waitFor(() => expect(mockSignoff).toHaveBeenCalledWith(169, expect.objectContaining({
      verdict: 'waived',
      waiveReason: 'Covered by the platform audit',
    })));
  });

  it('offers no action on a slot that is already satisfied', async () => {
    mockAccountability.mockResolvedValue(report({
      participants: [participant({ state: 'completed' })], completedCount: 1, percentComplete: 100,
    }));
    render(<AccountabilityTab taskId={169} />);

    await screen.findByText('Product Owner');
    expect(screen.queryByText('accountability.signoff.action')).not.toBeInTheDocument();
  });

  it('surfaces the server’s refusal verbatim rather than guessing capability', async () => {
    mockAccountability.mockResolvedValue(report());
    mockSignoff.mockRejectedValue(new Error("not authorized to sign off as role 'product-owner'"));
    render(<AccountabilityTab taskId={169} />);

    fireEvent.click(await screen.findByText('accountability.signoff.action'));
    fireEvent.click(screen.getByText(/accountability\.signoff\.confirm/));

    expect(await screen.findByText(/not authorized to sign off as role/)).toBeInTheDocument();
  });
});
