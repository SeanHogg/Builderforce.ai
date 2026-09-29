/**
 * Publish a published Evermind model to the Hugging Face Hub, from the browser, with
 * the person's OWN write token — the token goes from this page straight to
 * huggingface.co and is never sent to Builderforce or stored.
 *
 * The repo bundle is the one the export already builds (safetensors + ONNX + GGUF +
 * config + tokenizer + model card, zipped); this unpacks it into the engine's
 * `ExportResult` file list and hands it to the package's `publishToHuggingFace`, with
 * `@huggingface/hub` injected (it handles LFS for the binary weights). Both are loaded
 * on demand, so a page that never publishes never downloads them.
 */
import { unzipSync } from 'fflate';
import type { ExportResult } from '@seanhogg/builderforce-memory-engine';
import type { HubClient, HuggingFaceTarget, PublishOutcome } from '@seanhogg/builderforce-memory';
import { fetchPublishedModelExport } from './studioModelsApi';

/** "owner/name", each part in the Hub's allowed characters. */
const REPO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isHuggingFaceRepoId(repoId: string): boolean {
  return REPO_ID.test(repoId.trim());
}

const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  md: 'text/markdown',
  txt: 'text/plain',
};

function contentTypeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** The zipped repo bundle as the engine's export file list (directories dropped). */
export function unzipExportBundle(zip: Uint8Array): ExportResult {
  const files = Object.entries(unzipSync(zip))
    .filter(([path]) => !path.endsWith('/'))
    .map(([path, data]) => ({ path, data, contentType: contentTypeOf(path) }));
  // The zip carries files only; the publisher reads nothing but `files`.
  return { format: 'huggingface', files, paramCount: 0 } as ExportResult;
}

export async function publishModelToHuggingFace(
  slug: string,
  target: HuggingFaceTarget,
  fp16 = false,
): Promise<PublishOutcome> {
  const { blob } = await fetchPublishedModelExport(slug, 'huggingface', fp16);
  const bundle = unzipExportBundle(new Uint8Array(await blob.arrayBuffer()));
  const [{ publishToHuggingFace }, hub] = await Promise.all([
    import('@seanhogg/builderforce-memory'),
    import('@huggingface/hub'),
  ]);
  return publishToHuggingFace(bundle, { ...target, repoId: target.repoId.trim() }, { hub: hub as unknown as HubClient });
}
