import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentExecutionControl from './AgentExecutionControl';
import { runtimeApi } from '@/lib/builderforceApi';

const confirmSpy = vi.fn();
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirmSpy }));
vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: unknown }) => children }));

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
