import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PodcastSegment } from '@/lib/creation/podcast/podcastEpisode';
import { useAuthedMediaUrl } from '@/lib/useAuthedMediaUrl';

/**
 * Plays the episode's segments back to back through ONE `<audio>` element, honouring
 * each segment's trim window. The element is the caller's to render (`bindAudio`, `src`,
 * `onLoadedMetadata`, `onTimeUpdate`) so the markup stays in the presentational layer.
 */
export function usePodcastPlayback(segments: readonly PodcastSegment[]) {
  const playable = useMemo(() => segments.filter((segment) => !!segment.source), [segments]);
  const audio = useRef<HTMLAudioElement | null>(null);
  /** The `<audio>` element's callback ref, handed out as a function so callers never hold a ref object. */
  const bindAudio = useCallback((element: HTMLAudioElement | null) => { audio.current = element; }, []);
  const [index, setIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const current = index !== null ? playable[index] ?? null : null;
  // A tenant-authenticated upload cannot be an `<audio src>` directly (no bearer token): it is fetched to a blob.
  const authed = useAuthedMediaUrl(current?.source?.url);
  const trimStart = current?.clip.trimStartSeconds ?? 0;
  const windowEnd = current ? trimStart + current.clip.durationSeconds : 0;

  const stop = () => { setPlaying(false); setIndex(null); setElapsed(0); };

  const currentClipId = current?.clip.id ?? null;

  useEffect(() => {
    const element = audio.current;
    if (!element || currentClipId === null) return;
    if (!playing) { element.pause(); return; }
    // A new source is positioned by `onLoadedMetadata`; a source already loaded (the
    // next segment is a slice of the same recording) is positioned here.
    if (element.readyState >= 1) {
      element.currentTime = trimStart;
      void element.play().catch(() => setPlaying(false));
    }
  }, [currentClipId, trimStart, playing]);

  return {
    bindAudio,
    src: authed.url ?? '',
    playing,
    currentClipId,
    elapsed,
    toggle: () => {
      if (playing) { setPlaying(false); return; }
      if (index === null) setIndex(playable.length ? 0 : null);
      setPlaying(playable.length > 0);
    },
    playFrom: (clipId: string) => {
      const at = playable.findIndex((segment) => segment.clip.id === clipId);
      if (at >= 0) { setIndex(at); setPlaying(true); }
    },
    stop,
    onLoadedMetadata: () => {
      const element = audio.current;
      if (!element || !current) return;
      element.currentTime = trimStart;
      if (playing) void element.play().catch(() => setPlaying(false));
    },
    onTimeUpdate: () => {
      const element = audio.current;
      if (!element || !current) return;
      setElapsed(current.clip.startSeconds + Math.max(0, element.currentTime - trimStart));
      if (element.currentTime >= windowEnd - 0.05) {
        if (index !== null && index + 1 < playable.length) setIndex(index + 1); else stop();
      }
    },
  };
}
