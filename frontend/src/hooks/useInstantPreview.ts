'use client';

import { useCallback, useRef } from 'react';
import type { PreviewRuntime } from '@seanhogg/builderforce-webcontainers';
import { bootSharedPreviewRuntime } from '@/lib/browserRuntime/previewRuntime';

export type InstantPreviewResult =
  | { kind: 'ready'; url: string }
  /** The project needs the full dev environment; `reason` is the runtime's own words. */
  | { kind: 'declined'; reason: string };

/**
 * The canvas's instant preview: the project served straight from memory by our
 * own in-browser runtime. No `npm install`, no dev server, no StackBlitz session,
 * and edits reload the preview on their own.
 *
 * It serves Vite, Create React App and static projects. For anything else (Next.js,
 * Vue, Svelte, Node servers) `start` declines with a reason and the caller falls
 * back to the WebContainer. Until the next `start`, `write` keeps the preview in
 * step with edits; it reports `false` when the instant preview is not the one
 * showing, so the caller can send the edit to the WebContainer instead.
 */
export function useInstantPreview() {
  const activeRef = useRef<PreviewRuntime | null>(null);

  const start = useCallback(async (files: Record<string, string>): Promise<InstantPreviewResult> => {
    activeRef.current = null;
    let runtime: PreviewRuntime;
    try {
      runtime = await bootSharedPreviewRuntime();
    } catch (error) {
      return { kind: 'declined', reason: error instanceof Error ? error.message : String(error) };
    }
    // One runtime per page: clear the previous run's files (another project, or
    // files deleted since) before mounting this one.
    runtime.fs.rm('/');
    runtime.mount(files);
    const profile = runtime.profile();
    if (!profile.supported) return { kind: 'declined', reason: profile.reason ?? '' };
    activeRef.current = runtime;
    return { kind: 'ready', url: runtime.url };
  }, []);

  const write = useCallback((path: string, contents: string): boolean => {
    const runtime = activeRef.current;
    if (!runtime) return false;
    runtime.fs.writeFile(path, contents);
    return true;
  }, []);

  return { start, write };
}
