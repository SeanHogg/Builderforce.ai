import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { AgentWorker } from './AgentWorker';
import type { BrowserRuntimeTransport, ClaimedDispatch } from '@/lib/browserRuntime/runner';

const dispatch: ClaimedDispatch = {
  dispatchId: 'd1',
  model: 'anthropic/claude-3-haiku',
  role: 'implementer',
  input: 'do it',
  taskId: 1,
};

describe('AgentWorker tab', () => {
  it('renders the worker surface with a run control', () => {
    const { getByLabelText, getByText } = render(<AgentWorker />);
    expect(getByText('Browser Agent Worker')).toBeInTheDocument();
    expect(getByLabelText('Run pending agents')).toBeInTheDocument();
  });

  it('runs the agent loop in the tab and reports the result (drives autonomous advance)', async () => {
    let claimed = false;
    const report = vi.fn(async () => {});
    const transport: BrowserRuntimeTransport = {
      claim: vi.fn(async () => {
        if (claimed) return null;
        claimed = true;
        return dispatch;
      }),
      callModel: vi.fn(async () => 'agent produced this output'),
      report,
      openPullRequest: vi.fn(async () => null),
    };

    const { getByLabelText, getByTestId } = render(<AgentWorker transport={transport} />);
    fireEvent.click(getByLabelText('Run pending agents'));

    await waitFor(() => {
      expect(getByTestId('worker-summary').textContent).toContain('Completed 1');
    });
    // The agent ran on its OWN model and the result was reported to the server.
    expect(transport.callModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-3-haiku' }),
    );
    expect(report).toHaveBeenCalledWith('d1', {
      status: 'completed',
      output: 'agent produced this output',
    });
  });

  it('runs CODING mode for a repo-targeted dispatch (clone/edit/push in-browser)', async () => {
    const code = vi.fn(async () => ({ status: 'completed' as const, output: 'pushed agentHost/x' }));
    let claimed = false;
    const transport: BrowserRuntimeTransport = {
      claim: vi.fn(async () => {
        if (claimed) return null;
        claimed = true;
        return { ...dispatch, repo: { repoId: 'r1', defaultBranch: 'main' } };
      }),
      callModel: vi.fn(async () => 'should not be used in coding mode'),
      report: vi.fn(async () => {}),
      openPullRequest: vi.fn(async () => null),
    };

    const { getByLabelText, getByTestId } = render(<AgentWorker transport={transport} handlers={{ code }} />);
    fireEvent.click(getByLabelText('Run pending agents'));

    await waitFor(() => {
      expect(getByTestId('worker-summary').textContent).toContain('Completed 1');
    });
    expect(code).toHaveBeenCalled();
    expect(transport.report).toHaveBeenCalledWith('d1', { status: 'completed', output: 'pushed agentHost/x' });
  });

  it('surfaces a failure outcome without throwing', async () => {
    const transport: BrowserRuntimeTransport = {
      claim: vi
        .fn()
        .mockResolvedValueOnce(dispatch)
        .mockResolvedValue(null),
      callModel: vi.fn(async () => {
        throw new Error('gateway down');
      }),
      report: vi.fn(async () => {}),
      openPullRequest: vi.fn(async () => null),
    };

    const { getByLabelText, getByTestId } = render(<AgentWorker transport={transport} />);
    fireEvent.click(getByLabelText('Run pending agents'));

    await waitFor(() => {
      expect(getByTestId('worker-summary').textContent).toContain('Failed 1');
    });
    expect(transport.report).toHaveBeenCalledWith('d1', expect.objectContaining({ status: 'failed' }));
  });
});
