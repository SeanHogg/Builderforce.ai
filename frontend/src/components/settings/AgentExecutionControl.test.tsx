import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentExecutionControl from './AgentExecutionControl';
import { runtimeApi } from '@/lib/builderforceApi';

const confirmSpy = vi.fn();
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));
vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: unknown }) => children }));

/**
 * Both saves go through an AWAITED confirm promise, so the assertion has to
 * survive two microtask hops plus React's commit — which is enough when this
 * file runs alone and is not when it runs as one of 267 on a loaded machine.
 *
 * That is why there is NO local timeout here. This file used to carry
 * `const SAVE_TIMEOUT = { timeout: 5_000 }`, written to raise Testing Library's
 * 1s default — and by the time the suite grew, `src/test/setup.ts` had
 * configured `asyncUtilTimeout: 20_000` for every wait in the project. An
 * explicit `timeout` OVERRIDES the configured one, so the constant that was
 * added to be more patient had silently become the only thing in the file that
 * was less patient, applied to exactly the assertion that kept failing. It
 * failed the full suite again on 2026-08-15 while passing in 472ms alone.
 *
 * One place decides how long a wait waits, and it is the setup file.
 */

describe('AgentExecutionControl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    confirmSpy.mockReset();
  });

  it('confirms, disables execution, and reports drained runs', async () => {
    vi.spyOn(runtimeApi, 'executionControl').mockResolvedValue({ enabled: true });
    const save = vi.spyOn(runtimeApi, 'setExecutionControl').mockResolvedValue({
      enabled: false,
      stopped: { requested: 3, cancelled: 3, failed: [] },
    });
    confirmSpy.mockResolvedValue(true);
    render(<AgentExecutionControl />);

    const button = await screen.findByRole('button', { name: 'Disable and stop all agents' });
    await act(async () => { fireEvent.click(button); });

    await waitFor(() => expect(save).toHaveBeenCalledWith(false));
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(await screen.findByText('Status: EXECUTION DISABLED')).toBeInTheDocument();
    expect(screen.getByText('Execution is disabled. 3 active runs stopped.')).toBeInTheDocument();
  });

  it('re-enables execution without a destructive confirmation', async () => {
    vi.spyOn(runtimeApi, 'executionControl').mockResolvedValue({ enabled: false });
    const save = vi.spyOn(runtimeApi, 'setExecutionControl').mockResolvedValue({ enabled: true });
    render(<AgentExecutionControl />);

    const button = await screen.findByRole('button', { name: 'Enable agent execution' });
    await act(async () => { fireEvent.click(button); });

    await waitFor(() => expect(save).toHaveBeenCalledWith(true));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await screen.findByText('Status: Execution enabled')).toBeInTheDocument();
  });
});
