import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  EvermindConsole,
  type EvermindConsoleAdapter,
  type EvermindConsoleData,
} from '@seanhogg/builderforce-brain-ui';

/**
 * Non-`evermind` builds (video, voice, designer, finetune) deliberately have no
 * Evermind of their own and INHERIT their container project's — that is the intended
 * model, not an oversight (see the decision note on the IDE-project create handler).
 *
 * The bug that made it feel like one: reads inherit but writes keep exact-id
 * semantics, so the console rendered the container's stats (hence `seeded: true`)
 * while every control on it posted to a `project_evermind` row that does not exist.
 * Those writes updated zero rows and returned OK — an affordance that silently did
 * nothing. So the states that matter are: an inheriting build still SHOWS the shared
 * model, offers no controls that would no-op, and says whose model it is; while a
 * build with its own Evermind keeps the full management surface.
 */
const data = (over: Partial<EvermindConsoleData> = {}): EvermindConsoleData => ({
  version: 4,
  seeded: true,
  mode: 'connected',
  contributions: 12,
  inferenceEnabled: true,
  teacherModel: null,
  lastLearnedAt: null,
  pending: 0,
  recent: [],
  ...over,
});

function adapterFor(d: EvermindConsoleData): EvermindConsoleAdapter {
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
  } as unknown as EvermindConsoleAdapter;
}

describe('EvermindConsole — inherited Evermind', () => {
  it('explains that the model is shared and where training lives', async () => {
    render(<EvermindConsole adapter={adapterFor(data({ inherited: true, inheritedFromProjectId: 9 }))} canManage refreshMs={0} />);
    expect(await screen.findByRole('note')).toBeInTheDocument();
  });

  it('still shows the inherited model’s stats — the build is genuinely using it', async () => {
    render(<EvermindConsole adapter={adapterFor(data({ inherited: true }))} canManage refreshMs={0} />);
    await screen.findByRole('note');
    // The version readout is the proof the container's trained model is on screen,
    // rather than the "Not set up" state a per-build provisioning model would show.
    expect(screen.getByText('v4')).toBeInTheDocument();
  });

  it('offers no write controls a manager could click to no effect', async () => {
    render(<EvermindConsole adapter={adapterFor(data({ inherited: true }))} canManage refreshMs={0} />);
    await screen.findByRole('note');
    // Toggles/pickers/teach are all the container project's business.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps the full management surface for a build with its OWN Evermind', async () => {
    render(<EvermindConsole adapter={adapterFor(data({ inherited: false }))} canManage refreshMs={0} />);
    // No inheritance note, and the manageable controls are present.
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });

  it('treats a payload with no `inherited` field as owning its Evermind (back-compat)', async () => {
    render(<EvermindConsole adapter={adapterFor(data())} canManage refreshMs={0} />);
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
