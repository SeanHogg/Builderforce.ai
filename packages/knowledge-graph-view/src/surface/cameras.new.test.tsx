// @vitest-environment jsdom
/**
 * The Sequence diagram (the path strip's Sequence toggle): a lifeline per stop of the path, a message per hop, the step
 * in step with the diagram, and *Copy as Mermaid* exports exactly what is drawn. (The System and Heat DOM cameras
 * retired at make-default, PRD 43 P1 — the placement facts they held now live in
 * `compute/tasks/placement/rowCameras.parity.test.ts`.)
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { EMPTY_PATH, pathOfLine } from './path';
import { SequenceView } from './SequenceDiagram';
import { lines, model } from './testFixtures';

const path = pathOfLine(lines.lines[0]!, model.byId);

function Diagram({ p = path }: { p?: typeof path }) {
    const [step, setStep] = useState(0);
    return <SequenceView path={p} step={step} onStep={setStep} labels={L} />;
}

describe('SequenceDiagram', () => {
    it('draws a lifeline per stop and a message per hop, and the step follows the diagram', () => {
        render(<Diagram />);
        expect(document.querySelectorAll('[data-lifeline]')).toHaveLength(4);
        expect(document.querySelectorAll('[data-message]')).toHaveLength(3);
        expect(document.querySelector('[data-lifeline][aria-current="step"]')!.getAttribute('aria-label')).toBe('main.tsx');
        fireEvent.click(document.querySelectorAll('[data-lifeline]')[2]!);
        expect(document.querySelector('[data-lifeline][aria-current="step"]')!.getAttribute('aria-label')).toBe('API');
        expect(document.querySelector('[data-message][data-active]')!.getAttribute('data-message')).toBe('1-2');
    });

    it('copies the Mermaid of what is drawn', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        render(<Diagram />);
        fireEvent.click(screen.getByRole('button', { name: L.copyMermaid }));
        expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^sequenceDiagram\n    participant P1 as main\.tsx/));
    });

    it('says what to pick when there is no path', () => {
        render(<Diagram p={EMPTY_PATH} />);
        expect(screen.getByText(L.surface.sequence.empty)).toBeTruthy();
    });
});
