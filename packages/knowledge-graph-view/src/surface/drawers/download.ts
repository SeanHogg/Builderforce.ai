/**
 * Hands a JSON document to the person as a file: a Blob, an object URL and a click on a
 * transient link. Returns false where the browser cannot (no `URL.createObjectURL`), so the
 * caller can say so rather than fail silently.
 */

export function downloadJson(filename: string, value: unknown): boolean {
    try {
        if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
        const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        return true;
    } catch {
        return false;
    }
}
