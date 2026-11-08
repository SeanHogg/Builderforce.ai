/** The ArrayBuffers inside a reply, so the worker can hand them over instead of copying them. Looks only where typed arrays live (shallow objects and arrays of objects). */

const MAX_DEPTH = 3;

export function transferablesOf(value: unknown): ArrayBuffer[] {
    const found = new Set<ArrayBuffer>();
    const visit = (v: unknown, depth: number): void => {
        if (v === null || typeof v !== 'object') return;
        if (ArrayBuffer.isView(v)) { if (v.buffer instanceof ArrayBuffer) found.add(v.buffer); return; }
        if (depth >= MAX_DEPTH || v instanceof Map || v instanceof Set) return;
        if (Array.isArray(v)) {
            // An array of strings or numbers holds no buffers: do not walk 20,000 of them to find out.
            if (v.length > 0 && typeof v[0] === 'object' && v[0] !== null) for (const item of v) visit(item, depth + 1);
            return;
        }
        for (const item of Object.values(v)) visit(item, depth + 1);
    };
    visit(value, 0);
    return [...found];
}
