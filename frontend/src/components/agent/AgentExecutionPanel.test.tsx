import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import type { Task, Execution } from '@/lib/builderforceApi';
import { AgentExecutionPanel } from './AgentExecutionPanel';
import * as builderforceApi from '@/lib/builderforceApi';
import { useExecutionStream } from './useExecutionStream';

vi.mock('@/lib/builderforceApi');
vi.mock('./useExecutionStream', () => ({ useExecutionStream: vi.fn() }));

// This panel is a DISPATCH surface: re-run / cancel / steer are gated on the
// `runtime.execute` capability (developer+, mirroring requireRole(DEVELOPER) on
// the /api/runtime routes). Drive the workspace role from a mutable stub so the
// suite can exercise both a permitted actor and a read-only viewer.
const auth = { role: 'developer' };
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ tenant: { role: auth.role } }),
  useOptionalAuth: () => ({ tenant: { role: auth.role } }),
}));

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
    auth.role = 'developer';
    vi.spyOn(builderforceApi.runtimeApi, 'listForTask').mockResolvedValue([RUNNING_EXECUTION]);
    vi.spyOn(builderforceApi.runtimeApi, 'taskFileChanges').mockResolvedValue({ changes: [] });
    vi.spyOn(builderforceApi.runtimeApi, 'taskCost').mockResolvedValue({ estimatedCostUsd: 0, totalTokens: 0, requests: 0 });
    // Logs/Timeline tabs resolve cloud-agent names from this list on mount.
    vi.spyOn(builderforceApi.cloudAgents, 'list').mockResolvedValue([]);
    // Repo-binding status is fetched per task on mount (review context).
    vi.spyOn(builderforceApi.runtimeApi, 'taskRepoStatus').mockResolvedValue({ bound: false, hasCredential: false });
    // PRD (materials for the copy-triage report) is fetched on mount.
    vi.spyOn(builderforceApi.taskSpecsApi, 'list').mockResolvedValue([]);
    vi.spyOn(builderforceApi.runtimeApi, 'trace').mockResolvedValue({
      execution: RUNNING_EXECUTION,
      trace: { source: 'test', usageSnapshots: [], toolEvents: [] },
    });
    // Role-coordination status is fetched per task on mount. The module is
    // automocked, so without this the call resolves to `undefined` and the
    // panel throws reading `.requiredCount` off it.
    vi.spyOn(builderforceApi.kanbanApi, 'accountability').mockResolvedValue({
      taskId: 1, requiredCount: 0, completedCount: 0, percentComplete: 0,
      participants: [], signoffs: [], gaps: [],
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
    const box = await waitFor(() => getByPlaceholderText('agentExecution.steerPlaceholder'));
    fireEvent.change(box, { target: { value: 'focus on the pricing page' } });
    fireEvent.click(getByText('agentExecution.send'));

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
    expect(queryByText(/agentExecution.outputPlaceholder/i)).toBeNull();
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

  it('leaves a viewer’s re-run visible but inert, with the role hint, instead of letting it 403', async () => {
    auth.role = 'viewer';
    const failed: Execution = { id: 17, taskId: 1, status: 'failed', agentHostId: null, payload: '{"cloudAgentRef":"agt_9"}' };
    vi.spyOn(builderforceApi.runtimeApi, 'listForTask').mockResolvedValue([failed]);
    mockStream.mockReturnValue({ status: null, execution: null, messages: [], fileChanges: [], connected: false });
    const submit = vi.spyOn(builderforceApi.runtimeApi, 'submitExecution');

    const { findByLabelText, findAllByTitle, findByRole } = render(<AgentExecutionPanel task={task} agentHosts={[]} />);

    // Per the product rule the control is DISABLED + labelled, never hidden…
    const retry = await findByLabelText(/Re-run this task/i);
    // The hint is localized (common.requiresRoleHint, an ICU select on the role), so
    // assert the gate's presence via the translation key the test harness echoes —
    // asserting the English sentence would re-break the moment copy is translated.
    expect((await findAllByTitle(/common\.requiresRoleHint/i)).length).toBeGreaterThan(0);

    // …and clicking it dispatches nothing (the gate swallows the click).
    fireEvent.click(retry);
    await new Promise((r) => setTimeout(r, 0));
    expect(submit).not.toHaveBeenCalled();

    // Reading the run is untouched — the execution chip still selects.
    expect(await findByRole('button', { name: /#17/ })).toBeTruthy();
  });

  it('shows the per-run agent in the execution header from the run’s own fields + telemetry', async () => {
    // A cloud run stamped with its own agent ref + a runtime.dispatch event that
    // recorded the engine type it ACTUALLY ran as.
    const cloudRun: Execution = { id: 40, taskId: 1, status: 'completed', agentHostId: null, cloudAgentRef: 'agt_v2' };
    vi.spyOn(builderforceApi.runtimeApi, 'listForTask').mockResolvedValue([cloudRun]);
    vi.spyOn(builderforceApi.cloudAgents, 'list').mockResolvedValue([{ ref: 'agt_v2', name: 'Coder Agent' }] as never);
    vi.spyOn(builderforceApi.runtimeApi, 'trace').mockResolvedValue({
      execution: cloudRun,
      trace: {
        source: 'cloud-telemetry',
        usageSnapshots: [],
        toolEvents: [
          { id: 1, ts: '2026-06-12T05:15:44Z', toolName: 'runtime.dispatch', args: JSON.stringify({ agentType: 'Cloud Agent (Node/Container)', engine: 'builderforce-v3', surface: 'container' }) },
        ],
      },
    });
    mockStream.mockReturnValue({ status: 'completed', execution: null, messages: [], fileChanges: [], connected: false });

    const { findByText, findByTitle } = render(<AgentExecutionPanel task={task} agentHosts={[]} />);

    // The header shows the run's own agent name (not the task's current assignment)…
    expect((await findByTitle('agentExecution.agentThatRan')).textContent).toContain('Coder Agent');
    // …and the engine type it actually dispatched as, from its own telemetry.
    expect(await findByText(/agentExecution\.ranAs Cloud Agent \(Node\/Container\)/)).toBeTruthy();
  });

  it('shows ticket-level spend beside the Executions heading', async () => {
    vi.spyOn(builderforceApi.runtimeApi, 'taskCost').mockResolvedValue({ estimatedCostUsd: 0.42, totalTokens: 12345, requests: 7 });
    const { findByText } = render(<AgentExecutionPanel task={task} agentHosts={[]} />);
    expect(await findByText(/agentExecution\.spentOnTicket \$0\.42/)).toBeTruthy();
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
    fireEvent.click(await findByText(/agentExecution.tabChanges/));
    expect(queryByTestId('file-change-viewer')).toBeNull();
    fireEvent.click(getByText('src/outlook-plugin.ts'));

    // The viewer mounts for that file; the "back to list" control returns to it.
    // (The label is localized — `taskChanges.allChanges` — so match the key the
    // test-env passthrough i18n mock renders, not the English copy.)
    expect(getByTestId('file-change-viewer').textContent).toContain('src/outlook-plugin.ts');
    fireEvent.click(getByText(/allChanges/i));
    expect(queryByTestId('file-change-viewer')).toBeNull();
  });

  // ── revert a finished run ────────────────────────────────────────────────────
  // Destructive + manager-gated. The cases that matter are: it confirms first, it
  // does NOT offer itself on a live run, a developer sees it disabled rather than
  // gone, and a server REFUSAL is shown verbatim (the reason is the product).
  describe('revert', () => {
    const completed: Execution = { id: 55, taskId: 1, status: 'completed', agentHostId: null };
    const settle = () => {
      vi.spyOn(builderforceApi.runtimeApi, 'listForTask').mockResolvedValue([completed]);
      mockStream.mockReturnValue({ status: 'completed', execution: null, messages: [], fileChanges: [], connected: false });
    };

    it('confirms, then reverts, and reports the branch it deleted', async () => {
      auth.role = 'manager';
      settle();
      const revert = vi.spyOn(builderforceApi.runtimeApi, 'revert').mockResolvedValue({
        reverted: true, branch: 'builderforce/task-1', branchDeleted: true, prClosed: true, commits: 2,
      });

      const { findByText } = render(<AgentExecutionPanel task={task} agentHosts={[]} />);
      fireEvent.click(await findByText('agentExecution.revert'));

      await waitFor(() => expect(revert).toHaveBeenCalledWith(55));
      expect(await findByText(/agentExecution\.revertDone/)).toBeTruthy();
    });

    it('shows the server’s refusal reason verbatim instead of a generic failure', async () => {
      auth.role = 'manager';
      settle();
      vi.spyOn(builderforceApi.runtimeApi, 'revert').mockRejectedValue(
        new Error('pull request #7 was already merged — its commits are on \'main\' and cannot be undone by deleting the branch'),
      );

      const { findByText } = render(<AgentExecutionPanel task={task} agentHosts={[]} />);
      fireEvent.click(await findByText('agentExecution.revert'));

      expect(await findByText(/already merged/)).toBeTruthy();
    });

    it('is not offered while the run is still going', async () => {
      auth.role = 'manager';
      const { queryByText, findByRole } = render(<AgentExecutionPanel task={task} agentHosts={[]} />);
      await findByRole('button', { name: /#10/ });
      expect(queryByText('agentExecution.revert')).toBeNull();
    });

    it('is visible but inert for a developer (manager-gated, disabled not hidden)', async () => {
      auth.role = 'developer';
      settle();
      const revert = vi.spyOn(builderforceApi.runtimeApi, 'revert');

      const { findByText } = render(<AgentExecutionPanel task={task} agentHosts={[]} />);
      const btn = await findByText('agentExecution.revert');
      fireEvent.click(btn);

      await new Promise((r) => setTimeout(r, 0));
      expect(revert).not.toHaveBeenCalled();
    });
  });

  it('rolls the optimistic echo back when the post fails', async () => {
    vi.spyOn(builderforceApi.runtimeApi, 'postMessage').mockRejectedValue(new Error('offline'));
    const { getByPlaceholderText, getByText, queryByText } = render(
      <AgentExecutionPanel task={task} agentHosts={[]} />,
    );

    const box = (await waitFor(() => getByPlaceholderText('agentExecution.steerPlaceholder'))) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'retry me' } });
    fireEvent.click(getByText('agentExecution.send'));

    // After the failed post the thread echo (a "You" message) is removed and the
    // draft is restored for retry. ("You" only renders for a user thread message.)
    await waitFor(() => expect(queryByText('agentExecution.you')).toBeNull());
    expect(box.value).toBe('retry me');
  });
});
