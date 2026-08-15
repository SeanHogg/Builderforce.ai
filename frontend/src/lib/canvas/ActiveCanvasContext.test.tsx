// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActiveCanvasProvider, useOptionalActiveCanvas, type ActiveCanvas } from './ActiveCanvasContext';

const board = (sessionId: string): ActiveCanvas => ({
  sessionId,
  persistence: 'server',
  focusId: null,
  shareOpen: false,
  buildOpen: false,
  buildChatId: null,
  buildTicket: null,
  prompt: null,
  present: false,
  modelComparisonIds: [],
});

function Probe() {
  const canvas = useOptionalActiveCanvas()!;
  return <>
    <button onClick={() => canvas.open(board('a'))}>A</button>
    <button onClick={() => canvas.open(board('b'))}>B</button>
    <button onClick={() => canvas.publishProjectIds('a', [11])}>PA</button>
    <button onClick={() => canvas.publishProjectIds('b', [22])}>PB</button>
    <output>{JSON.stringify({ active: canvas.active?.sessionId, opened: canvas.opened.map((item) => item.sessionId), projects: canvas.projectIds })}</output>
  </>;
}

describe('ActiveCanvasProvider board instances', () => {
  it('keeps each opened board registered and restores its own project scope on switch', () => {
    render(<ActiveCanvasProvider stageHosted><Probe /></ActiveCanvasProvider>);
    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByText('PA'));
    fireEvent.click(screen.getByText('B'));
    fireEvent.click(screen.getByText('PB'));
    expect(screen.getByRole('status').textContent).toContain('"opened":["a","b"]');
    expect(screen.getByRole('status').textContent).toContain('"projects":[22]');
    fireEvent.click(screen.getByText('A'));
    expect(screen.getByRole('status').textContent).toContain('"active":"a"');
    expect(screen.getByRole('status').textContent).toContain('"projects":[11]');
  });
});
