// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAssistantGate } from '@/lib/academic/useAssistantGate';
import { ActiveCanvasProvider, useOptionalActiveCanvas, type ActiveCanvas } from './ActiveCanvasContext';

/**
 * The exam gate, held by the shell: a board publishes the strictest assessment being
 * sat on it, and every composer reads the verdict for the board on STAGE.
 */

const board = (sessionId: string): ActiveCanvas => ({
  sessionId, persistence: 'server', focusId: null, shareOpen: false, buildOpen: false,
  buildChatId: null, buildTicket: null, prompt: null, present: false, modelComparisonIds: [],
});

function Probe() {
  const canvas = useOptionalActiveCanvas()!;
  const gate = useAssistantGate();
  return <>
    <button onClick={() => canvas.open(board('exam'))}>exam</button>
    <button onClick={() => canvas.open(board('notes'))}>notes</button>
    <button onClick={() => canvas.publishAssessmentMode('exam', 'closed')}>close-exam</button>
    <output>{`${gate.mode}:${gate.assistantAllowed ? 'allowed' : 'refused'}`}</output>
  </>;
}

describe('the shell-held assistant gate', () => {
  it('is open until the board on stage publishes a live closed-book assessment', () => {
    render(<ActiveCanvasProvider stageHosted><Probe /></ActiveCanvasProvider>);
    expect(screen.getByRole('status').textContent).toBe('open:allowed');
    fireEvent.click(screen.getByText('exam'));
    fireEvent.click(screen.getByText('close-exam'));
    expect(screen.getByRole('status').textContent).toBe('closed:refused');
  });

  it('follows the board on stage — another board is not under the exam', () => {
    render(<ActiveCanvasProvider stageHosted><Probe /></ActiveCanvasProvider>);
    fireEvent.click(screen.getByText('exam'));
    fireEvent.click(screen.getByText('close-exam'));
    fireEvent.click(screen.getByText('notes'));
    expect(screen.getByRole('status').textContent).toBe('open:allowed');
    fireEvent.click(screen.getByText('exam'));
    expect(screen.getByRole('status').textContent).toBe('closed:refused');
  });

  it('is open outside a shell with a stage', () => {
    const { result } = renderHook(() => useAssistantGate());
    expect(result.current.assistantAllowed).toBe(true);
  });
});
