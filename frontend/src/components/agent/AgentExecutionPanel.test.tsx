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
// Stub the Monaco-backed viewer (jsdom can't load the editor) — assert it's
// mounted with the clicked file rather than rendering a real editor.
vi.mock('./FileChangeViewer', () => ({
  FileChangeViewer: ({ path }: { path: string }) => <div data-testid="file-change-viewer">viewing {path}</div>,
}));

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
    vi.spyOn(builderforceApi.runtimeApi, 'taskCost').mockResolvedValue({ estimatedCostUsd: 0, totalTokens: 0, requests: 0 });
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

  it('rebuilds Output from persisted agent.message telemetry when the live stream is empty (cloud run)', async () => {
    const cloudRun: Execution = { id: 21, taskId: 1, status: 'running', agentHostId: null };
    vi.spyOn(builderforceApi.runtimeApi, 'listForTask').mockResolvedValue([cloudRun]);
    vi.spyOn(builderforceApi.runtimeApi, 'trace').mockResolvedValue({
      execution: cloudRun,
      trace: {
        source: 'cloud-telemetry',
        usageSnapshots: [],
        toolEvents: [
          { id: 2, ts: '2026-06-08T21:54:30Z', toolName: 'agent.message', args: JSON.stringify({ step: 2, content: 'Now wiring the Outlook UI.' }) },
          { id: 1, ts: '2026-06-08T21:54:25Z', toolName: 'agent.message', args: JSON.stringify({ step: 1, content: 'Creating the plugin core logic.' }) },
        ],
      },
    });
    // Cloud WS dropped cross-isolate → no live assistant messages.
    mockStream.mockReturnValue({ status: 'running', execution: null, messages: [], fileChanges: [], connected: false });

    const { findByText, queryByText } = render(<AgentExecutionPanel task={task} agentHosts={[]} />);

    // Both narrations render (oldest-first), not the "working…" placeholder.
    expect(await findByText('Creating the plugin core logic.')).toBeTruthy();
    expect(await findByText('Now wiring the Outlook UI.')).toBeTruthy();
    expect(queryByText(/output will stream here/i)).toBeNull();
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

  it('shows ticket-level spend beside the Executions heading', async () => {
    vi.spyOn(builderforceApi.runtimeApi, 'taskCost').mockResolvedValue({ estimatedCostUsd: 0.42, totalTokens: 12345, requests: 7 });
    const { findByText } = render(<AgentExecutionPanel task={task} agentHosts={[]} />);
    expect(await findByText(/\$0\.42 spent on this ticket/)).toBeTruthy();
  });

  it('does not show a re-run action on a running execution', async () => {
    const { queryByLabelText, findByRole } = render(<AgentExecutionPanel task={task} agentHosts={[]} />);
    await findByRole('button', { name: /#10/ });
    expect(queryByLabelText(/Re-run this task|Resume this run/i)).toBeNull();
  });

  it('opens a changed file in the Monaco diff viewer when its Changes row is clicked', async () => {
    const cloudRun: Execution = { id: 30, taskId: 1, status: 'completed', agentHostId: null };
    vi.spyOn(builderforceApi.runtimeApi, 'listForTask').mockResolvedValue([cloudRun]);
    vi.spyOn(builderforceApi.runtimeApi, 'taskFileChanges').mockResolvedValue({
      changes: [{ path: 'src/outlook-plugin.ts', change: 'created', agent: 'Coder Agent (V2)', executionId: 30, createdAt: '2026-06-08T21:00:00Z' }],
    });
    mockStream.mockReturnValue({ status: 'completed', execution: null, messages: [], fileChanges: [], connected: false });

    const { findByText, getByText, getByTestId, queryByTestId } = render(<AgentExecutionPanel task={task} agentHosts={[]} />);

    // Open the Changes tab and click the file row.
    fireEvent.click(await findByText(/^Changes/));
    expect(queryByTestId('file-change-viewer')).toBeNull();
    fireEvent.click(getByText('src/outlook-plugin.ts'));

    // The viewer mounts for that file; "All changes" returns to the list.
    expect(getByTestId('file-change-viewer').textContent).toContain('src/outlook-plugin.ts');
    fireEvent.click(getByText(/All changes/));
    expect(queryByTestId('file-change-viewer')).toBeNull();
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
