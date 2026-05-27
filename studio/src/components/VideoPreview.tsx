import { useEffect, useRef } from 'react';

interface VideoPreviewProps {
  frames: ImageBitmap[];
  videoUrl: string | null;
  width: number;
  height: number;
}

/**
 * Live preview canvas + final-video player.
 * - During generation: renders the most recent ImageBitmap onto a canvas.
 * - After generation: shows an HTML5 <video> bound to the muxed MP4 URL.
 *
 * Single component handles both states so we don't end up with two parallel
 * "render frames" code paths.
 */
export function VideoPreview({ frames, videoUrl, width, height }: VideoPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (videoUrl) return; // video element is showing the final MP4
    const canvas = canvasRef.current;
    if (!canvas || frames.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const latest = frames[frames.length - 1];
    ctx.drawImage(latest, 0, 0, canvas.width, canvas.height);
  }, [frames, videoUrl]);

  return (
    <div className="bfs-preview" style={{ aspectRatio: `${width} / ${height}` }}>
      {videoUrl ? (
        <video src={videoUrl} controls autoPlay loop className="bfs-preview-video" />
      ) : (
        <canvas ref={canvasRef} width={width} height={height} className="bfs-preview-canvas" />
      )}
      {!videoUrl && frames.length === 0 && (
        <div className="bfs-preview-empty">Preview will appear here as frames generate.</div>
      )}
    </div>
  );
}
