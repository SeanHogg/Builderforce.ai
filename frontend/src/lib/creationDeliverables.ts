import { apiRequest } from './apiClient';
import type { CreationNodeData } from '@/components/creation-canvas/types';

export type CreationDeliverableStatus = 'running' | 'delivered' | 'failed';

/** One transport-neutral record for every artifact Canvas actually produces. */
export interface CreationDeliverable {
  id: string;
  action: string;
  artifactKind: string;
  status: CreationDeliverableStatus;
  createdAt: string;
  completedAt?: string;
  url?: string;
  pathUrl?: string;
  mimeType?: string;
  fileName?: string;
  provider?: string;
  resourceRef?: string;
  validation?: { status: 'passed' | 'failed' | 'not_run'; detail?: string };
  metadata?: Record<string, unknown>;
  error?: string;
}

export function creationDeliverables(data: CreationNodeData): CreationDeliverable[] {
  return Array.isArray(data.deliverables)
    ? data.deliverables.filter((item): item is CreationDeliverable => !!item && typeof item === 'object' && typeof (item as CreationDeliverable).id === 'string')
    : [];
}

export function withCreationDeliverable(data: CreationNodeData, deliverable: CreationDeliverable): CreationDeliverable[] {
  return [deliverable, ...creationDeliverables(data).filter((item) => item.id !== deliverable.id)].slice(0, 50);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}

function safeColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#3978f6';
}

/** Build a complete, dependency-free site from an authored Website object. */
export function buildWebsiteAssets(data: CreationNodeData): Array<{ path: string; data: Uint8Array }> {
  const title = escapeHtml(data.title || 'Created with Builderforce');
  const headline = escapeHtml(data.websiteHeadline || data.title || 'Bring your idea to life');
  const body = escapeHtml(data.websiteBody || data.content || data.subtitle || 'Created collaboratively in Builderforce.');
  const cta = escapeHtml(data.websiteCta || 'Get started');
  const accent = safeColor(data.websiteAccent);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${body.slice(0, 155)}"><link rel="stylesheet" href="styles.css"></head>
<body><nav><strong>${title}</strong><a href="#main">Explore</a></nav><main id="main"><section><p class="eyebrow">Created with Builderforce</p><h1>${headline}</h1><p class="lead">${body}</p><a class="cta" href="#contact">${cta}</a></section><aside aria-hidden="true">${title.slice(0, 2).toUpperCase()}</aside></main><footer id="contact">${title}</footer></body></html>`;
  const css = `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f8fafc}*{box-sizing:border-box}body{margin:0}nav{height:72px;padding:0 clamp(24px,6vw,88px);display:flex;align-items:center;justify-content:space-between;background:white;border-bottom:1px solid #e5e7eb}nav a{color:${accent}}main{min-height:calc(100vh - 132px);padding:clamp(48px,9vw,128px) clamp(24px,8vw,120px);display:grid;grid-template-columns:minmax(0,1.25fr) minmax(240px,.75fr);gap:8vw;align-items:center}h1{font-size:clamp(44px,7vw,92px);line-height:.98;letter-spacing:-.055em;margin:12px 0 24px}.eyebrow{color:${accent};font-weight:750;text-transform:uppercase;letter-spacing:.12em}.lead{font-size:clamp(18px,2vw,25px);line-height:1.6;color:#526079;max-width:680px}.cta{display:inline-block;margin-top:24px;padding:14px 22px;border-radius:999px;background:${accent};color:white;text-decoration:none;font-weight:750}aside{aspect-ratio:1;border-radius:32%;display:grid;place-items:center;background:${accent};color:white;font-size:clamp(64px,10vw,150px);font-weight:850;box-shadow:0 40px 90px ${accent}44}footer{height:60px;padding:20px clamp(24px,6vw,88px);color:#64748b}@media(max-width:760px){main{grid-template-columns:1fr}aside{max-width:320px}}`;
  const encoder = new TextEncoder();
  return [{ path: 'index.html', data: encoder.encode(html) }, { path: 'styles.css', data: encoder.encode(css) }];
}

export interface EvermindMediaResult {
  model: string;
  modality: 'video' | 'image';
  width: number;
  height: number;
  channels: number;
  frameCount: number;
  frames: string[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function generateEvermindMedia(slug: string, input: { prompt?: string; maxFrames?: number; seed?: number }): Promise<EvermindMediaResult> {
  return apiRequest<EvermindMediaResult>(`/api/studio/models/${encodeURIComponent(slug)}/generate-media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

/** Convert one raw RGB/RGBA model frame to a browser-previewable PNG. */
export function mediaFrameDataUrl(frame: string, width: number, height: number, channels: number): string | null {
  if (typeof document === 'undefined' || (channels !== 3 && channels !== 4)) return null;
  const binary = atob(frame);
  if (binary.length < width * height * channels) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const pixels = context.createImageData(width, height);
  for (let source = 0, target = 0; source < width * height * channels; source += channels, target += 4) {
    pixels.data[target] = binary.charCodeAt(source);
    pixels.data[target + 1] = binary.charCodeAt(source + 1);
    pixels.data[target + 2] = binary.charCodeAt(source + 2);
    pixels.data[target + 3] = channels === 4 ? binary.charCodeAt(source + 3) : 255;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}
