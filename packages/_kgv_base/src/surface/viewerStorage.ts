/**
 * Per-viewer choices kept in localStorage (the panels' visibility, the 3D / Flat switch). The ONE guarded access: every
 * read and write is wrapped, so a blocked store just means "not remembered".
 */

/** The stored JSON under `key`, or null when absent, unreadable or storage is blocked. */
export function readStored(key: string): unknown {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/** Stores `value` as JSON under `key`; a blocked store keeps the choice for this session only. */
export function writeStored(key: string, value: unknown): void {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* storage blocked: the choice lasts for this session only */
    }
}
