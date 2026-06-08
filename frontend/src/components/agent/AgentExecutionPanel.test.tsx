import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import type { Task, Execution } from '@/lib/builderforceApi';
import { AgentExecutionPanel } from './AgentExecutionPanel';
import * as builderforceApi from '@/lib/builderforceApi';
import { useExecutionStream } from './useExecutionStream';

vi.mock('@/lib/builderforceApi');
vi.mock('./useExecutionStream', () => ({ useExecutionStream: vi.fn() }));

// Isolate from the run control + markdown renderer + status palette + Link.
vi.mock('../task/RunAgentControl', () => ({ RunAgentControl: () => <div data-testid="run-control" /> }));
vi.mock('../ChatMessageContent', () => ({ ChatMessageContent: ({ content }: { content: string }) => <div>{content}</div> }));
vi.mock('../board/AgentChip', () => ({
  EXECUTION_STATUS_COLOR: {} as Record<string, string>,
  rerunAffordance: (s: string) => (s === 'failed' || s === 'cancelled' ? 'retry' : s === 'paused' ? 'resume' : null),
}));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

const mockStream = vi.mocked(useExecutionStream);
const RUNNING_EXECUTION: Execution = { id: 10, taskId: 1, status: 'running', agentHostId: 3 };
const task = { id: 1 } as Task;

describe('AgentExecutionPanel — steering echo', () => {
  // jsdom doesn't implement Element.scrollTo (used by the output auto-scroll).
  beforeAll(() => { Element.prototype.scrollTo = vi.fn(); });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(builderforceApi.runtimeApi, 'listForTask').mockResolvedValue([RUNNING_EXECUTION]);
    vi.spyOn(builderforceApi.runtimeApi, 'taskFileChanges').mockResolvedValue({ changes: [] });
    // Logs/Timeline tabs resolve cloud-agent names from this list on mount.
    vi.spyOn(builderforceApi.cloudAgents, 'list').mockResolvedValue([]);
    vi.spyOn(builderforceApi.runtimeApi, 'trace').mockResolvedValue({
      execution: RUNNING_EXECUTION,
      trace: { source: 'test', usageSnapshots: [], toolEvents: [] },
    });
    // Simulate the per-isolate drop: the stream NEVER echoes the user message back.
    mockStream.mockReturnValue({
      status: 'running', execution: null, messages: [], fileChanges: [], connected: false,
    });
  });

  it('renders a sent direction optimistically even when the stream never echoes it', async () => {
    const post = vi.spyOn(builderforceApi.runtimeApi, 'postMessage').mockResolvedValue({ ok: true });
    const { getByPlaceholderText, getByText, findByText } = render(
      <AgentExecutionPanel task={task} agentHosts={[]} />,
    );

    // Wait for the running execution to load (chatbox becomes active).
    const box = await waitFor(() => getByPlaceholderText(/Send the agent a new direction/i));
    fireEvent.change(box, { target: { value: 'focus on the pricing page' } });
    fireEvent.click(getByText('Send'));

    // The directive shows in the thread without waiting on a round-trip echo.
    expect(await findByText('focus on the pricing page')).toBeTruthy();
    expect(post).toHaveBeenCalledWith(10, 'focus on the pricing page');
  });

  it('shows a re-run action on a failed execution and re-submits with its target + payload', async () => {
    const failed: Execution = { id: 17, taskId: 1, status: 'failed', agentHostId: null, payload: '{"cloudAgentRef":"agt_9","model":"x"}' };
    vi.spyOn(builderforceApi.runtimeApi, 'listForTask').mockResolvedValue([failed]);
    // Not running → no live stream status, so the chip shows the failed status.
    mockStream.mockReturnValue({ status: null, execution: null, messages: [], fileChanges: [], connected: false });
    const submit = vi.spyOn(builderforceApi.runtimeApi, 'submitExecution').mockResolvedValue({ id: 18, taskId: 1, status: 'pending' });
    vi.spyOn(builderforceApi, 'isAwaitingApprovalExecution').mockReturnValue(false);

    const { findByLabelText } = render(<AgentExecutionPanel task={task} agentHosts={[]} />);

    const retry = await findByLabelText(/Re-run this task/i);
    fireEvent.click(retry);

    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      taskId: 1,
      agentHostId: undefined,
      payload: '{"cloudAgentRef":"agt_9","model":"x"}',
    }));
  });

  it('does not show a re-run action on a running execution', async () => {
    const { queryByLabelText, findByRole } = render(<AgentExecutionPanel task={task} agentHosts={[]} />);
    await findByRole('button', { name: /#10/ });
    expect(queryByLabelText(/Re-run this task|Resume this run/i)).toBeNull();
  });

  it('rolls the optimistic echo back when the post fails', async () => {
    vi.spyOn(builderforceApi.runtimeApi, 'postMessage').mockRejectedValue(new Error('offline'));
    const { getByPlaceholderText, getByText, queryByText } = render(
      <AgentExecutionPanel task={task} agentHosts={[]} />,
    );

    const box = (await waitFor(() => getByPlaceholderText(/Send the agent a new direction/i))) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'retry me' } });
    fireEvent.click(getByText('Send'));

    // After the failed post the thread echo (a "You" message) is removed and the
    // draft is restored for retry. ("You" only renders for a user thread message.)
    await waitFor(() => expect(queryByText('You')).toBeNull());
    expect(box.value).toBe('retry me');
  });
});
