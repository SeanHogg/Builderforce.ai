// No `'use client'`: a plain module holding the page's one channel, not a component.
/**
 * The web page's ONE model-fallback channel (brain-embedded `createModelFallbackChannel`):
 * the Brain stream (`./localFirst`, `createHostModelStream`'s `onFallback`) reports into
 * it when Hybrid's pick failed and Auto answered, and `WebAiSurface` — the one AI body
 * every web surface mounts — shows brain-ui's `ModelFallbackNotice` from it. One per
 * page, like the page engines.
 */
import { createModelFallbackChannel } from '@seanhogg/builderforce-brain-embedded';

export const webModelFallback = createModelFallbackChannel();
