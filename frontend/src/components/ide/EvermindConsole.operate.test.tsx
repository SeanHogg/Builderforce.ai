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
 * model will produce, clean it up when it goes wrong, and TELL SOMEONE about it?".
 *
 * Before these surfaces existed, the only affordance was Validate, which previews which
 * learned MEMORIES would be recalled and generates nothing — so a model emitting fluent
 * gibberish looked perfectly healthy until a user received some, there was no way to
 * repair it afterwards, and no way to hand the evidence to anyone who could.
 *
 * The four surfaces are TABS, not a stack: they are four separate jobs on one model, and
 * stacked they buried "Replace the model" a page and a half below the state it repairs.
 * So these tests navigate the way a user does — the tab first, then the control.
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

/** Navigate to a tab the way a user does, once the console has loaded. */
async function openTab(name: RegExp): Promise<void> {
  fireEvent.click(await screen.findByRole('tab', { name }));
}

/**
 * The export is offered TWICE — from the console header and from the Maintain tab —
 * because the moment you need it is the moment something is broken, and an affordance
 * you have to go tab-hunting for at that moment is one people conclude does not exist.
 * `[0]` is the header, `[1]` the panel; both press the same action.
 */
function copyButtons(): HTMLElement[] {
  return screen.getAllByRole('button', { name: /Copy diagnostics/i });
}

describe('EvermindConsole — tabs', () => {
  it('offers the four working surfaces, with Teach open first', async () => {
    render(<EvermindConsole adapter={adapterFor({ probe: vi.fn(), analyze: vi.fn(), reseed: vi.fn() })} canManage refreshMs={0} />);

    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((el) => el.textContent)).toEqual(['Teach', 'Test', 'Check', 'Maintain']);
    // Teach is the only surface used on a healthy model; the other three are things you
    // go looking for.
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the model’s STATE outside the tabs — you cannot replace a model without seeing it is quarantined', async () => {
    render(
      <EvermindConsole
        adapter={adapterFor({ reseed: vi.fn() }, data({ quarantinedAt: '2026-07-26T09:00:00Z', quarantineReason: '3 incoherent serves' }))}
        canManage
        refreshMs={0}
      />,
    );
    await screen.findByRole('tab', { name: /Teach/ });
    await openTab(/Maintain/);

    // Still visible from the maintenance tab: the badge, the reason, and the version.
    expect(screen.getByText(/Quarantined/)).toBeInTheDocument();
    expect(screen.getByText(/3 incoherent serves/)).toBeInTheDocument();
    expect(screen.getByText('v4')).toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys', async () => {
    render(<EvermindConsole adapter={adapterFor({ probe: vi.fn() })} canManage refreshMs={0} />);
    const teach = await screen.findByRole('tab', { name: /Teach/ });

    fireEvent.keyDown(teach, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Test/ })).toHaveAttribute('aria-selected', 'true');
    // Wraps backwards from the first tab to the last.
    fireEvent.keyDown(screen.getByRole('tab', { name: /Test/ }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: /Teach/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('never offers a tab with nothing behind it', async () => {
    // No probe and no analyze on this host — Test and Check would be empty rooms.
    render(<EvermindConsole adapter={adapterFor()} canManage refreshMs={0} />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((el) => el.textContent)).toEqual(['Teach', 'Maintain']);
  });
});

describe('EvermindConsole — test bench', () => {
  it('shows the raw generation AND why it would be refused', async () => {
    const probe = vi.fn().mockResolvedValue(refusedProbe);
    render(<EvermindConsole adapter={adapterFor({ probe })} canManage refreshMs={0} />);

    await openTab(/Test/);
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

    await openTab(/Test/);
    fireEvent.click(await screen.findByRole('button', { name: /Readiness check/i }));
    await waitFor(() => expect(probe).toHaveBeenCalledWith(undefined));
    expect(await screen.findByText(/coherent enough to serve/i)).toBeInTheDocument();
  });

  it('KEEPS a refusal visible from the other tabs, and keeps the result when you come back', async () => {
    // A refusal you can only see while standing on the tab that found it is a refusal
    // you forget — and re-running a probe to see it again costs another generation.
    const probe = vi.fn().mockResolvedValue(refusedProbe);
    render(<EvermindConsole adapter={adapterFor({ probe })} canManage refreshMs={0} />);

    await openTab(/Test/);
    fireEvent.change(await screen.findByPlaceholderText(/Ask the model something/i), { target: { value: 'Where does this project stand?' } });
    fireEvent.click(screen.getByRole('button', { name: /Run prompt/i }));
    await screen.findByText(/Oredionisiing/);

    await openTab(/Teach/);
    expect(screen.getByRole('tab', { name: /Test/ })).toHaveTextContent('!');
    expect(screen.queryByText(/Oredionisiing/)).not.toBeInTheDocument();

    await openTab(/Test/);
    expect(screen.getByText(/Oredionisiing/)).toBeInTheDocument();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('is not offered at all by a host that cannot probe', async () => {
    render(<EvermindConsole adapter={adapterFor()} canManage refreshMs={0} />);
    await screen.findByRole('tab', { name: /Teach/ });
    expect(screen.queryByRole('tab', { name: /Test/ })).not.toBeInTheDocument();
  });
});

describe('EvermindConsole — knowledge analyzer', () => {
  it('lists what is wrong with each memory and the correction that would replace it', async () => {
    const analyze = vi.fn().mockResolvedValue(analysis);
    render(<EvermindConsole adapter={adapterFor({ analyze })} canManage refreshMs={0} />);

    await openTab(/Check/);
    fireEvent.click(await screen.findByRole('button', { name: /Check knowledge/i }));
    expect(await screen.findByText(/retry limit is three/i)).toBeInTheDocument();
    expect(screen.getByText(/retries a failed step three times/i)).toBeInTheDocument();
  });

  it('applies only the SELECTED findings', async () => {
    const applyFindings = vi.fn().mockResolvedValue({ corrected: 1, forgotten: 1, merged: 1, version: 5, skipped: [] });
    render(<EvermindConsole adapter={adapterFor({ analyze: vi.fn().mockResolvedValue(analysis), applyFindings })} canManage refreshMs={0} />);

    await openTab(/Check/);
    fireEvent.click(await screen.findByRole('button', { name: /Check knowledge/i }));
    await screen.findByText(/retry limit is three/i);
    // Findings default to selected — the common intent is "fix it all".
    fireEvent.click(screen.getByRole('button', { name: /Fix 1 selected/i }));

    await waitFor(() => expect(applyFindings).toHaveBeenCalledWith([expect.objectContaining({ id: 11 })]));
    expect(await screen.findByText(/1 corrected, 1 forgotten/i)).toBeInTheDocument();
  });

  it('survives a tab switch with its selection intact — an audit costs frontier tokens', async () => {
    const analyze = vi.fn().mockResolvedValue(analysis);
    render(<EvermindConsole adapter={adapterFor({ analyze, applyFindings: vi.fn() })} canManage refreshMs={0} />);

    await openTab(/Check/);
    fireEvent.click(await screen.findByRole('button', { name: /Check knowledge/i }));
    await screen.findByText(/retry limit is three/i);
    // The count on the tab is how a finding stays visible once you have left it.
    await openTab(/Teach/);
    expect(screen.getByRole('tab', { name: /Check/ })).toHaveTextContent('1');

    await openTab(/Check/);
    expect(screen.getByText(/retry limit is three/i)).toBeInTheDocument();
    // Not "Fix 0 selected" over a list of visible problems.
    expect(screen.getByRole('button', { name: /Fix 1 selected/i })).toBeInTheDocument();
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('reports a clean bill rather than silence', async () => {
    render(<EvermindConsole adapter={adapterFor({ analyze: vi.fn().mockResolvedValue({ ...analysis, findings: [] }) })} canManage refreshMs={0} />);
    await openTab(/Check/);
    fireEvent.click(await screen.findByRole('button', { name: /Check knowledge/i }));
    expect(await screen.findByText(/nothing looks wrong/i)).toBeInTheDocument();
  });
});

describe('EvermindConsole — maintenance', () => {
  it('confirms INLINE before replacing the model, then re-seeds', async () => {
    const reseed = vi.fn().mockResolvedValue({ version: 101 });
    render(<EvermindConsole adapter={adapterFor({ reseed })} canManage refreshMs={0} />);

    await openTab(/Maintain/);
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
    await openTab(/Maintain/);
    fireEvent.click(await screen.findByRole('button', { name: /^Replace…$/ }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Clear/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(reseed).not.toHaveBeenCalled();
  });

  it('rebuilds the recall index without a confirmation (non-destructive)', async () => {
    const reindex = vi.fn().mockResolvedValue({ reindexed: 7, skipped: 0, version: 4 });
    render(<EvermindConsole adapter={adapterFor({ reindex })} canManage refreshMs={0} />);
    await openTab(/Maintain/);
    fireEvent.click(await screen.findByRole('button', { name: /Rebuild index/i }));
    await waitFor(() => expect(reindex).toHaveBeenCalled());
    expect(await screen.findByText(/Re-filed 7 memories/i)).toBeInTheDocument();
  });

  it('hides the repair controls from a host that implements none of them — but still exports', async () => {
    render(<EvermindConsole adapter={adapterFor()} canManage refreshMs={0} />);
    await openTab(/Maintain/);
    expect(screen.queryByText(/^Maintenance$/)).not.toBeInTheDocument();
    // Describing a broken model is never a privileged act, so the export survives.
    expect(copyButtons()).toHaveLength(2);
  });
});

describe('EvermindConsole — diagnostics export', () => {
  it('hands over the model’s state AND the raw output it was refused for', async () => {
    // The gap this closes: an operator could SEE the gibberish and had no way to give it
    // to anyone. A screenshot loses the exact bytes, which are the entire evidence.
    const copyText = vi.fn().mockResolvedValue(undefined);
    const probe = vi.fn().mockResolvedValue(refusedProbe);
    render(
      <EvermindConsole
        adapter={adapterFor({ probe, copyText }, data({ version: 100, contributions: 1837 }))}
        canManage refreshMs={0} projectName="EverMind"
      />,
    );

    await openTab(/Test/);
    fireEvent.click(await screen.findByRole('button', { name: /Readiness check/i }));
    await screen.findByText(/Oredionisiing/);

    await openTab(/Maintain/);
    fireEvent.click(copyButtons()[1]!);
    await waitFor(() => expect(copyText).toHaveBeenCalled());

    const report = copyText.mock.calls[0]![0] as string;
    expect(report).toContain('# Evermind diagnostics — EverMind');
    expect(report).toContain('- Version: v100');
    expect(report).toContain('- Learned contributions: 1837');
    // The evidence, verbatim, produced on a DIFFERENT tab.
    expect(report).toContain('Oredionisiing');
    expect(report).toContain('Rejected by: `non-words`');
    expect(await screen.findByText(/Copied to your clipboard/i)).toBeInTheDocument();
  });

  it('exports from the HEADER too, without hunting for a tab', async () => {
    const copyText = vi.fn().mockResolvedValue(undefined);
    render(<EvermindConsole adapter={adapterFor({ copyText })} canManage refreshMs={0} />);

    await screen.findByRole('tab', { name: /Teach/ });
    fireEvent.click(copyButtons()[0]!);

    await waitFor(() => expect(copyText).toHaveBeenCalled());
    // Confirmed in place — the header press must not silently succeed. One confirmation
    // only: it lives in the header so it is seen whichever surface was pressed.
    expect(await screen.findByRole('status')).toHaveTextContent(/Copied to your clipboard/i);
  });

  it('exports even when the console FAILED to load — that failure is the diagnosis', async () => {
    const copyText = vi.fn().mockResolvedValue(undefined);
    render(
      <EvermindConsole
        adapter={adapterFor({ copyText, loadData: vi.fn().mockRejectedValue(new Error('HTTP 403')) })}
        canManage refreshMs={0}
      />,
    );

    // No tabs at all in this state — the header button is the only way out, which is
    // exactly why it lives there.
    await screen.findByRole('alert');
    fireEvent.click(copyButtons()[0]!);

    await waitFor(() => expect(copyText).toHaveBeenCalled());
    expect(copyText.mock.calls[0]![0]).toContain('could not load');
  });

  it('reveals the report for manual copying rather than claiming a copy that failed', async () => {
    const copyText = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    render(<EvermindConsole adapter={adapterFor({ copyText })} canManage refreshMs={0} />);

    await openTab(/Maintain/);
    fireEvent.click(copyButtons()[1]!);

    expect(await screen.findByText(/Copying automatically was blocked/i)).toBeInTheDocument();
    expect(screen.queryByText(/Copied to your clipboard/i)).not.toBeInTheDocument();
    expect((await screen.findByRole('textbox', { name: /Diagnostics/i })).textContent).toContain('# Evermind diagnostics');
  });
});
