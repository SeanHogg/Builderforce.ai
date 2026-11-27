import { useRef } from 'react';

interface SplitterProps {
    controls: string;
    label: string;
    width: number;
    min: number;
    max: number;
    onResize(width: number): void;
}

const STEP = 24;

export function CodePaneSplitter({ controls, label, width, min, max, onResize }: SplitterProps) {
    const drag = useRef<{ pointer: number; start: number; width: number; direction: number } | null>(null);
    const directionOf = (handle: HTMLElement) => getComputedStyle(handle).direction === 'rtl' ? -1 : 1;
    const change = (value: number) => onResize(Math.min(max, Math.max(min, value)));

    return <div
        className="kg-code-splitter" role="separator" aria-orientation="vertical" aria-controls={controls}
        aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} tabIndex={0}
        onPointerDown={(event) => {
            if (event.button !== 0 || drag.current) return;
            event.preventDefault();
            const handle = event.currentTarget;
            handle.focus();
            handle.setPointerCapture(event.pointerId);
            drag.current = { pointer: event.pointerId, start: event.clientX, width, direction: directionOf(handle) };
        }}
        onPointerMove={(event) => {
            const active = drag.current;
            if (active?.pointer === event.pointerId) change(active.width + (event.clientX - active.start) * active.direction);
        }}
        onLostPointerCapture={(event) => {
            if (drag.current?.pointer === event.pointerId) drag.current = null;
        }}
        onKeyDown={(event) => {
            switch (event.key) {
                case 'ArrowLeft': change(width - STEP * directionOf(event.currentTarget)); break;
                case 'ArrowRight': change(width + STEP * directionOf(event.currentTarget)); break;
                case 'Home': change(min); break;
                case 'End': change(max); break;
                default: return;
            }
            event.preventDefault();
        }}
    />;
}
