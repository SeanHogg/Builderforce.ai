import { useEffect, useRef, useState } from 'react';

interface VideoPreviewProps {
  frames: ImageBitmap[];
  videoUrl: string | null;
  width: number;
  height: number;
  /** Renders the loading state (progress bar + label) during generation. When
   *  null, the preview shows either the final video or the empty hint. */
  loading?: { label: string; framesDone: number; framesTotal: number } | null;
}

/**
 * Three states, one component (DRY — consumer never branches on which one):
 *
 *   1. loading != null            → progress bar + label, no per-frame preview.
 *                                    Per-frame canvas was visually noisy
 *                                    (frames pop in at varying quality during
 *                                    LCM denoise, looks like a glitch). The
 *                                    progress bar reads as "the engine is
 *                                    working" without distracting noise.
 *   2. videoUrl set               → <video> player + clickable thumbnail strip
 *                                    so the user can scrub the result.
 *   3. neither                    → empty hint.
 *
 * Click a thumbnail → seeks the video to that frame. Lets the user inspect
 * any single frame without scrubbing the timeline pixel-perfectly.
 */
export function VideoPreview({ frames, videoUrl, width, height, loading }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [thumbUrls, setThumbUrls] = useState<string[]>([]);
  const [selectedThumb, setSelectedThumb] = useState<number | null>(null);
  const [fps, setFps] = useState(8);

  // Convert finished frames to thumbnail object URLs once per generation.
  // Skip during loading state so we don't waste cycles on partial output.
  useEffect(() => {
    if (loading || !videoUrl || frames.length === 0) {
      setThumbUrls([]);
      return;
    }
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      for (const bm of frames) {
        if (cancelled) break;
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = Math.round((96 / bm.width) * bm.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(bm, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((r) =>
          canvas.toBlob(r, 'image/jpeg', 0.7),
        );
        if (!blob) continue;
        urls.push(URL.createObjectURL(blob));
      }
      if (!cancelled) setThumbUrls(urls);
    })();
    return () => {
      cancelled = true;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [frames, videoUrl, loading]);

  // Read fps off the video element so seek-by-frame lands on the right time.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoUrl || frames.length === 0) return;
    const onLoaded = () => {
      if (v.duration > 0) setFps(Math.max(1, Math.round(frames.length / v.duration)));
    };
    v.addEventListener('loadedmetadata', onLoaded);
    return () => v.removeEventListener('loadedmetadata', onLoaded);
  }, [videoUrl, frames.length]);

  const handleThumbClick = (idx: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = idx / fps;
    setSelectedThumb(idx);
  };

  return (
    <div>
      <div className="bfs-preview" style={{ aspectRatio: `${width} / ${height}` }}>
        {loading ? (
          <LoadingState {...loading} />
        ) : videoUrl ? (
          <video ref={videoRef} src={videoUrl} controls autoPlay loop className="bfs-preview-video" />
        ) : (
          <div className="bfs-preview-empty">Enter a prompt and press Generate.</div>
        )}
      </div>

      {!loading && videoUrl && thumbUrls.length > 0 ? (
        <div
          className="bfs-thumb-strip"
          style={{
            display: 'flex',
            gap: 4,
            overflowX: 'auto',
            padding: '8px 0',
            marginTop: 8,
          }}
        >
          {thumbUrls.map((url, idx) => {
            const selected = selectedThumb === idx;
            return (
              <button
                key={url}
                type="button"
                onClick={() => handleThumbClick(idx)}
                title={`Frame ${idx + 1} of ${thumbUrls.length}`}
                style={{
                  flex: '0 0 auto',
                  padding: 0,
                  border: selected ? '2px solid var(--bfs-accent)' : '2px solid transparent',
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: 'transparent',
                }}
              >
                <img
                  src={url}
                  alt={`Frame ${idx + 1}`}
                  width={64}
                  height={Math.round((64 / width) * height)}
                  style={{ borderRadius: 2, display: 'block' }}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function LoadingState({
  label,
  framesDone,
  framesTotal,
}: {
  label: string;
  framesDone: number;
  framesTotal: number;
}) {
  const pct = framesTotal > 0 ? Math.min(100, Math.round((framesDone / framesTotal) * 100)) : 0;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        width: '100%',
        height: '100%',
      }}
    >
      <div style={{ fontSize: '0.85rem', textAlign: 'center', opacity: 0.85 }}>{label}</div>
      <div
        style={{
          width: '80%',
          height: 8,
          background: 'rgba(127,127,127,0.2)',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'var(--bfs-accent, #3b82f6)',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <div className="bfs-mono" style={{ fontSize: '0.75rem', opacity: 0.7 }}>
        {framesDone} / {framesTotal} frames
      </div>
    </div>
  );
}
