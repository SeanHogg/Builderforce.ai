/**
 * knowledge/blobDataUrl.ts - a Blob as a base64 data URL: the form a screenshot crosses
 * `postMessage` (webview to extension host) and a vision model request in, the same on
 * every host. Needs only `Blob.arrayBuffer` and `btoa` (browser, Worker, Node 18+).
 */

const CHUNK = 0x8000;

export async function blobDataUrl(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}
