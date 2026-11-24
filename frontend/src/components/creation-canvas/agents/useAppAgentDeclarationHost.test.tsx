import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Real English copy: the notice is asserted as the sentence a person reads.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));
// The three server calls the declaration makes; what they answer is the server's business.
// The form's pure helpers (gaps, preview) stay real.
vi.mock('@/lib/canvas/appAgentDeclaration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/canvas/appAgentDeclaration')>()),
  projectHasAppManifest: vi.fn(async () => true),
  loadAgentToolOptions: vi.fn(async () => ['env.fs.read']),
  declareAppAgent: vi.fn(async () => ({ ok: true, agentId: 'triage' })),
}));

import { declareAppAgent, projectHasAppManifest } from '@/lib/canvas/appAgentDeclaration';
import { useAppAgentDeclarationHost } from './useAppAgentDeclarationHost';

type Host = ReturnType<typeof useAppAgentDeclarationHost>;

/** Draws the host the way the canvas does — its panel beside whatever reads `appAgents`. */
function renderHost(projectId: number | null) {
  const notify = vi.fn();
  const seen: { current: Host | null } = { current: null };
  function Probe() {
    const host = useAppAgentDeclarationHost(projectId, notify);
    seen.current = host;
    return <>{host.panel}</>;
  }
  render(<Probe />);
  return { notify, host: () => seen.current! };
}

/** The host once its manifest check has answered, so later updates are the test's own. */
async function renderSettledHost(projectId: number) {
  const rendered = renderHost(projectId);
  await waitFor(() => expect(rendered.host().appAgents?.hasAppManifest).toBe(true));
  return rendered;
}

const form = () => screen.queryByTestId('agent-declaration-form');

describe('useAppAgentDeclarationHost', () => {
  beforeEach(() => vi.clearAllMocks());

  /** No project, or a reader who may not write: the composer is offered nothing, so it
   *  never asks a question whose answer cannot be acted on. */
  it('offers nothing without a project', () => {
    const { host } = renderHost(null);
    expect(host().appAgents).toBeUndefined();
    expect(host().panel).toBeNull();
    expect(projectHasAppManifest).not.toHaveBeenCalled();
  });

  it("reports whether the project's app has a manifest", async () => {
    await renderSettledHost(7);
    expect(projectHasAppManifest).toHaveBeenCalledWith(7);
  });

  it('opens the declaration panel when the composer defines an agent', async () => {
    const { host } = await renderSettledHost(7);
    expect(form()).toBeNull();
    act(() => host().appAgents!.onDefine());
    expect(form()).toBeInTheDocument();
    // The tools the reader may grant arrive after the panel opens.
    expect(await screen.findByText('env.fs.read')).toBeInTheDocument();
  });

  it('closes the panel and tells the reader once the agent is declared', async () => {
    const { host, notify } = await renderSettledHost(7);
    act(() => host().appAgents!.onDefine());
    await screen.findByText('env.fs.read');

    fireEvent.change(screen.getByLabelText('Agent id'), { target: { value: 'triage' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. developer'), { target: { value: 'developer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Declare agent' }));

    await waitFor(() => expect(form()).toBeNull());
    expect(declareAppAgent).toHaveBeenCalledWith(7, expect.objectContaining({ id: 'triage', role: { kind: 'role', key: 'developer' } }));
    expect(notify).toHaveBeenCalledWith('Agent "triage" declared in the app manifest.');
  });
});
