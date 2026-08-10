import { apiRequest } from './apiClient';

export type CanvasImageResolveMode = 'find' | 'generate' | 'auto';

export interface CanvasImageAsset {
  url: string;
  thumbnailUrl: string;
  provider: string;
  source: 'stock' | 'ai';
  title?: string;
  author?: string;
  authorUrl?: string;
  licence?: string;
  width?: number;
  height?: number;
  model?: string;
}

interface SearchResponse { results: Array<CanvasImageAsset & { providerAssetId: string }> }
interface GenerateResponse {
  data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
  model?: string;
  _builderforce?: { resolvedModel?: string; resolvedVendor?: string };
}

export async function findCanvasImage(query: string): Promise<CanvasImageAsset | null> {
  const response = await apiRequest<SearchResponse>(`/api/creative/images/search?q=${encodeURIComponent(query)}&limit=12`);
  const result = response.results[0];
  return result ? { ...result, source: 'stock' } : null;
}

export async function generateCanvasImage(prompt: string): Promise<CanvasImageAsset> {
  const response = await apiRequest<GenerateResponse>('/llm/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, n: 1, size: '1024x1024', response_format: 'url', useCase: 'canvas_image_create' }),
  });
  const first = response.data[0];
  const url = first?.url || (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : '');
  if (!url) throw new Error('The image generator returned no image');
  return {
    url, thumbnailUrl: url, source: 'ai',
    provider: response._builderforce?.resolvedVendor ?? 'builderforce-image',
    model: response._builderforce?.resolvedModel ?? response.model,
    title: first?.revised_prompt,
  };
}

/** Find first for ambiguous requests, then create when search is unavailable or empty. */
export async function resolveCanvasImage(query: string, mode: CanvasImageResolveMode): Promise<CanvasImageAsset> {
  if (mode === 'generate') return generateCanvasImage(query);
  if (mode === 'find') {
    const found = await findCanvasImage(query);
    if (!found) throw new Error('No matching stock image was found');
    return found;
  }
  try {
    const found = await findCanvasImage(query);
    if (found) return found;
  } catch { /* A missing stock-provider configuration should fall through to generation. */ }
  return generateCanvasImage(query);
}
