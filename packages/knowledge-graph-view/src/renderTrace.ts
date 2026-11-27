import { createContext, useContext } from 'react';

export type RenderTrace = (phase: string, detail?: string, error?: Error) => void;

export function createRenderTrace() {
    const events: { line: string; failed: boolean }[] = [];
    const record: RenderTrace = (phase, detail, error) => {
        const line = `render ${new Date().toISOString()} ${phase}: ${[detail, error?.stack ?? error?.message].filter(Boolean).join('\n  ').slice(0, 2400)}`;
        events.push({ line, failed: !!error });
        if (events.length > 48) events.shift();
        if (error) console.error('[knowledge-graph-view]', phase, detail, error);
    };
    return { record, snapshot: () => ({ lines: events.map((e) => e.line), attention: events.some((e) => e.failed) }) };
}

export const RenderTraceContext = createContext<RenderTrace>((phase, detail, error) => {
    if (error) console.error('[knowledge-graph-view]', phase, detail, error);
});
export const useRenderTrace = () => useContext(RenderTraceContext);
