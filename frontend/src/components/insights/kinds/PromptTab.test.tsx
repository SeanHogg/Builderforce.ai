import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ImprovementAudience } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { prescription } from '@/test/replayPrescriptionFixtures';
import { panelKindDef } from '../panelKinds';
import { FixPromptTab } from './FixPromptTab';

/**
 * The `fix` kind's Prompt tab (PRD 33 §4.1, §5.2): the audience switch reads the
 * prompt for that audience; Copy writes the clipboard and records `copy-prompt`;
 * "Apply to the page" bundles the page's fixes (`apply-page`) and shows that prompt.
 */

vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/rbac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rbac')>()),
  usePermission: () => ({ allowed: true, role: 'manager', required: 'manager' }),
}));

const writeText = vi.fn(async (_text: string) => {});

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  writeText.mockClear();
  vi.spyOn(replayApi, 'getPrescription').mockResolvedValue(prescription({ next: ['copy-prompt', 'apply-page', 'dismiss'] }));
  vi.spyOn(replayApi, 'improvementPrompt').mockImplementation(async (_site, id, audience: ImprovementAudience) => ({
    audience, prompt: `prompt ${id} for ${audience}`, selectors: ['button.buy'], prescriptionIds: [id],
  }));
  vi.spyOn(replayApi, 'actOnPrescription').mockImplementation(async (_site, id, action) => ({
    prescription: prescription({ id, status: 'applied', next: ['copy-prompt', 'dismiss'] }),
    prompt: action === 'apply-page' ? 'the whole page' : 'one fix',
    selectors: [],
    prescriptionIds: action === 'apply-page' ? ['rx-1', 'rx-2'] : undefined,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderTab() {
  render(<FixPromptTab siteId="site-1" id="rx-1" push={vi.fn()} />);
}

describe('fix kind Prompt tab', () => {
  it('is registered between Change and Measure', () => {
    expect(panelKindDef('fix')!.tabs.map((tab) => tab.id)).toEqual(['change', 'prompt', 'measure']);
  });

  it('reads the prompt for the audience picked', async () => {
    renderTab();
    expect(await screen.findByDisplayValue('prompt rx-1 for coding_agent')).toBeInTheDocument();
    expect(replayApi.improvementPrompt).toHaveBeenCalledWith('site-1', 'rx-1', 'coding_agent');

    fireEvent.click(screen.getByRole('tab', { name: 'replay.prompt.audience.site_builder' }));
    expect(await screen.findByDisplayValue('prompt rx-1 for site_builder')).toBeInTheDocument();
    expect(replayApi.improvementPrompt).toHaveBeenLastCalledWith('site-1', 'rx-1', 'site_builder');
    expect(screen.getByRole('tab', { name: 'replay.prompt.audience.site_builder' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Copy writes the clipboard and records the copy-prompt action for that audience', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('tab', { name: 'replay.prompt.audience.composer' }));
    await screen.findByDisplayValue('prompt rx-1 for composer');
    fireEvent.click(screen.getByRole('button', { name: /replay\.prompt\.copy$/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('prompt rx-1 for composer'));
    await waitFor(() => expect(replayApi.actOnPrescription).toHaveBeenCalledWith('site-1', 'rx-1', 'copy-prompt', { audience: 'composer' }));
    expect(await screen.findByText('replay.prompt.markedApplied')).toBeInTheDocument();
  });

  it('"Apply to the page" bundles the page’s fixes and shows that prompt', async () => {
    renderTab();
    await screen.findByDisplayValue('prompt rx-1 for coding_agent');
    fireEvent.click(screen.getByRole('button', { name: /replay\.prompt\.applyPage/ }));
    await waitFor(() => expect(replayApi.actOnPrescription).toHaveBeenCalledWith('site-1', 'rx-1', 'apply-page', { audience: 'coding_agent' }));
    expect(await screen.findByDisplayValue('the whole page')).toBeInTheDocument();
    expect(screen.getByText('replay.prompt.bundled 2')).toBeInTheDocument();
  });
});
