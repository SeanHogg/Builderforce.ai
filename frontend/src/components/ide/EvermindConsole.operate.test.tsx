import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import {
  EvermindConsole,
  type EvermindConsoleAdapter,
  type EvermindConsoleData,
  type EvermindKnowledgeAnalysis,
  type EvermindProbeResult,
} from '@seanhogg/builderforce-brain-ui';

/**
 * The console's OPERATE surface — the answer to "how does a person validate what this
 * model will produce, and clean it up when it goes wrong?".
 *
 * Before these sections existed, the only affordance was Validate, which previews which
 * learned MEMORIES would be recalled and generates nothing — so a model emitting fluent
 * gibberish looked perfectly healthy until a user received some, and there was no way to
 * repair it afterwards. What is asserted here is exactly that gap being closed: the
 * model can be run and graded on demand, its knowledge audited and fixed, and its
 * weights replaced — with the destructive actions confirming inline (a VS Code webview
 * has no `window.confirm`, so a native dialog would silently do nothing there).
 */
const data = (over: Partial<EvermindConsoleData> = {}): EvermindConsoleData => ({
  version: 4,
  seeded: true,
  mode: 'connected',
  contributions: 12,
  inferenceEnabled: false,
  teacherModel: null,
  lastLearnedAt: null,
  pending: 0,
  recent: [],
  ...over,
});

const refusedProbe: EvermindProbeResult = {
  version: 4,
  mode: 'prompt',
  ready: false,
  passRate: 0,
  samples: [{
    prompt: 'Summarise where this project stands.',
    text: 'Oredionisiing chats code related tot, bound reposea this inatic exie.',
    coherent: false,
    failure: 'non-words',
    detail: 'most of the content words are not real words',
  }],
};

const analysis: EvermindKnowledgeAnalysis = {
  version: 4,
  analyzed: 3,
  model: 'claude-opus-5',
  findings: [{
    id: 11,
    verdict: 'incorrect',
    issue: 'The retry limit is three, not thirty.',
    prompt: 'How many retries does the pipeline do?',
    excerpt: 'The pipeline retries thirty times.',
    correction: 'The pipeline retries a failed step three times before giving up.',
    source: 'frontier',
  }],
};

function adapterFor(over: Partial<EvermindConsoleAdapter> = {}, d = data()): EvermindConsoleAdapter {
  return {
    loadData: vi.fn().mockResolvedValue(d),
    loadSeedModels: vi.fn().mockResolvedValue([{ slug: 'base', name: 'Base' }]),
    loadTeacherOptions: vi.fn().mockResolvedValue({ models: [], isPaid: true }),
    seedFromModel: vi.fn(),
    setInference: vi.fn(),
    setMode: vi.fn(),
    setTeacher: vi.fn(),
    teach: vi.fn(),
    flush: vi.fn(),
    validate: vi.fn(),
    ...over,
  } as unknown as EvermindConsoleAdapter;
}

describe('EvermindConsole — test bench', () => {
  it('shows the raw generation AND why it would be refused', async () => {
    const probe = vi.fn().mockResolvedValue(refusedProbe);
    render(<EvermindConsole adapter={adapterFor({ probe })} canManage refreshMs={0} />);

    const box = await screen.findByPlaceholderText(/Ask the model something/i);
    fireEvent.change(box, { target: { value: 'Summarise where this project stands.' } });
    fireEvent.click(screen.getByRole('button', { name: /Run prompt/i }));

    // The verbatim output — seeing the actual text is the whole point.
    expect(await screen.findByText(/Oredionisiing/)).toBeInTheDocument();
    // …plus the production verdict, in words an operator can act on.
    expect(screen.getByText(/not real words/i)).toBeInTheDocument();
    expect(screen.getByText(/not coherent enough to serve/i)).toBeInTheDocument();
    expect(probe).toHaveBeenCalledWith('Summarise where this project stands.');
  });

  it('runs the readiness suite with no prompt (the same gate that blocks enabling replies)', async () => {
    const probe = vi.fn().mockResolvedValue({ ...refusedProbe, mode: 'readiness', ready: true, passRate: 1, samples: [{ ...refusedProbe.samples[0]!, coherent: true, failure: null, detail: '' }] });
    render(<EvermindConsole adapter={adapterFor({ probe })} canManage refreshMs={0} />);

    fireEvent.click(await screen.findByRole('button', { name: /Readiness check/i }));
    await waitFor(() => expect(probe).toHaveBeenCalledWith(undefined));
    expect(await screen.findByText(/coherent enough to serve/i)).toBeInTheDocument();
  });

  it('is not rendered at all by a host that cannot probe', async () => {
    render(<EvermindConsole adapter={adapterFor()} canManage refreshMs={0} />);
    await screen.findByRole('combobox');
    expect(screen.queryByPlaceholderText(/Ask the model something/i)).not.toBeInTheDocument();
  });
});

describe('EvermindConsole — knowledge analyzer', () => {
  it('lists what is wrong with each memory and the correction that would replace it', async () => {
    const analyze = vi.fn().mockResolvedValue(analysis);
    render(<EvermindConsole adapter={adapterFor({ analyze })} canManage refreshMs={0} />);

    fireEvent.click(await screen.findByRole('button', { name: /Check knowledge/i }));
    expect(await screen.findByText(/retry limit is three/i)).toBeInTheDocument();
    expect(screen.getByText(/retries a failed step three times/i)).toBeInTheDocument();
  });

  it('applies only the SELECTED findings', async () => {
    const applyFindings = vi.fn().mockResolvedValue({ corrected: 1, forgotten: 1, merged: 1, version: 5, skipped: [] });
    render(<EvermindConsole adapter={adapterFor({ analyze: vi.fn().mockResolvedValue(analysis), applyFindings })} canManage refreshMs={0} />);

    fireEvent.click(await screen.findByRole('button', { name: /Check knowledge/i }));
    await screen.findByText(/retry limit is three/i);
    // Findings default to selected — the common intent is "fix it all".
    fireEvent.click(screen.getByRole('button', { name: /Fix 1 selected/i }));

    await waitFor(() => expect(applyFindings).toHaveBeenCalledWith([expect.objectContaining({ id: 11 })]));
    expect(await screen.findByText(/1 corrected, 1 forgotten/i)).toBeInTheDocument();
  });

  it('reports a clean bill rather than silence', async () => {
    render(<EvermindConsole adapter={adapterFor({ analyze: vi.fn().mockResolvedValue({ ...analysis, findings: [] }) })} canManage refreshMs={0} />);
    fireEvent.click(await screen.findByRole('button', { name: /Check knowledge/i }));
    expect(await screen.findByText(/nothing looks wrong/i)).toBeInTheDocument();
  });
});

describe('EvermindConsole — maintenance', () => {
  it('confirms INLINE before replacing the model, then re-seeds', async () => {
    const reseed = vi.fn().mockResolvedValue({ version: 101 });
    render(<EvermindConsole adapter={adapterFor({ reseed })} canManage refreshMs={0} />);

    fireEvent.click(await screen.findByRole('button', { name: /^Replace…$/ }));
    // An inline alertdialog, NOT window.confirm — the VS Code webview has no native one.
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    expect(reseed).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: /^Replace…$/ }));
    await waitFor(() => expect(reseed).toHaveBeenCalledWith(undefined)); // starter base
    expect(await screen.findByText(/now at v101/i)).toBeInTheDocument();
  });

  it('abandons the replacement on cancel', async () => {
    const reseed = vi.fn();
    render(<EvermindConsole adapter={adapterFor({ reseed })} canManage refreshMs={0} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Replace…$/ }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Clear/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(reseed).not.toHaveBeenCalled();
  });

  it('rebuilds the recall index without a confirmation (non-destructive)', async () => {
    const reindex = vi.fn().mockResolvedValue({ reindexed: 7, skipped: 0, version: 4 });
    render(<EvermindConsole adapter={adapterFor({ reindex })} canManage refreshMs={0} />);
    fireEvent.click(await screen.findByRole('button', { name: /Rebuild index/i }));
    await waitFor(() => expect(reindex).toHaveBeenCalled());
    expect(await screen.findByText(/Re-filed 7 memories/i)).toBeInTheDocument();
  });

  it('hides the whole section from a host that implements none of it', async () => {
    render(<EvermindConsole adapter={adapterFor()} canManage refreshMs={0} />);
    await screen.findByRole('combobox');
    expect(screen.queryByText(/Maintenance/i)).not.toBeInTheDocument();
  });
});

