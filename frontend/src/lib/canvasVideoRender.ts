import {
  canvasVideoDuration,
  type CanvasVideoClip,
  type CanvasVideoSource,
  type CanvasVideoTimeline,
} from '@builderforce/creation-canvas-contract';

type RenderElement = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

function recorderMime(): string {
  return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((mime) => MediaRecorder.isTypeSupported?.(mime)) ?? 'video/webm';
}

async function loadElement(source: CanvasVideoSource): Promise<RenderElement> {
  if (source.kind === 'image') return new Promise((resolve, reject) => {
    const image = new Image(); image.crossOrigin = 'anonymous'; image.onload = () => resolve(image); image.onerror = reject; image.src = source.url;
  });
  return new Promise((resolve, reject) => {
    const media = document.createElement(source.kind === 'audio' ? 'audio' : 'video');
    media.crossOrigin = 'anonymous'; media.preload = 'auto'; media.onloadeddata = () => resolve(media); media.onerror = reject; media.src = source.url; media.load();
  });
}

function drawContained(context: CanvasRenderingContext2D, element: HTMLVideoElement | HTMLImageElement, width: number, height: number) {
  const sourceWidth = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
  const sourceHeight = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(element, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

type CaptionContext = { save(): void; restore(): void; measureText(text: string): { width: number }; fillRect(x: number, y: number, width: number, height: number): void; fillText(text: string, x: number, y: number, maxWidth?: number): void; fillStyle: string | CanvasGradient | CanvasPattern; font: string; textAlign: CanvasTextAlign; textBaseline: CanvasTextBaseline };
export function drawCanvasVideoCaptions(context: CaptionContext, caption: string, width: number, height: number) {
  const text = caption.trim(); if (!text) return;
  context.save(); context.font = `600 ${Math.max(22, Math.round(height * .038))}px Arial`; context.textAlign = 'center'; context.textBaseline = 'bottom';
  const padding = Math.round(height * .018); const boxWidth = Math.min(width * .9, context.measureText(text).width + padding * 2); const boxHeight = Math.round(height * .075);
  context.fillStyle = 'rgba(0,0,0,.72)'; context.fillRect((width - boxWidth) / 2, height - boxHeight - padding, boxWidth, boxHeight);
  context.fillStyle = '#fff'; context.fillText(text, width / 2, height - padding * 1.8, boxWidth - padding * 2); context.restore();
}

/**
 * Browser-native first renderer. It records the Canvas compositor plus the Web
 * Audio mix in real time, producing an editable object's derived WebM rendition.
 */
export async function renderCanvasVideo(
  timeline: CanvasVideoTimeline,
  sources: readonly CanvasVideoSource[],
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const duration = canvasVideoDuration(timeline);
  if (!duration) throw new Error('The timeline has no clips');
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const clipElements = new Map<string, RenderElement>();
  await Promise.all(timeline.clips.map(async (clip) => {
    const source = sourceById.get(clip.sourceId);
    if (source) clipElements.set(clip.id, await loadElement(source));
  }));

  const canvas = document.createElement('canvas');
  canvas.width = timeline.width;
  canvas.height = timeline.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas video rendering is unavailable');
  const audio = new AudioContext();
  const mix = audio.createMediaStreamDestination();
  for (const clip of timeline.clips) {
    const element = clipElements.get(clip.id);
    if (!(element instanceof HTMLMediaElement)) continue;
    const node = audio.createMediaElementSource(element);
    const gain = audio.createGain(); gain.gain.value = Math.max(0, Math.min(2, clip.volume));
    node.connect(gain).connect(mix);
  }
  await audio.resume();
  const output = new MediaStream([...canvas.captureStream(timeline.fps).getVideoTracks(), ...mix.stream.getAudioTracks()]);
  const recorder = new MediaRecorder(output, { mimeType: recorderMime(), videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.start(500);
  const start = performance.now();

  await new Promise<void>((resolve) => {
    const frame = () => {
      const elapsed = Math.min(duration, (performance.now() - start) / 1000);
      context.fillStyle = timeline.backgroundColor;
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (const clip of timeline.clips) {
        const source = sourceById.get(clip.sourceId);
        const element = clipElements.get(clip.id);
        const active = elapsed >= clip.startSeconds && elapsed < clip.startSeconds + clip.durationSeconds;
        if (element instanceof HTMLMediaElement) {
          if (active && element.paused) {
            element.currentTime = Math.max(0, clip.trimStartSeconds + elapsed - clip.startSeconds);
            void element.play();
          } else if (!active && !element.paused) element.pause();
        }
        if (active && clip.track === 'visual' && source && element && !(element instanceof HTMLAudioElement)) {
          drawContained(context, element, canvas.width, canvas.height);
          if (clip.captions) drawCanvasVideoCaptions(context, clip.captions, canvas.width, canvas.height);
        }
      }
      onProgress?.(elapsed / duration);
      if (elapsed >= duration) resolve(); else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

  clipElements.forEach((element) => { if (element instanceof HTMLMediaElement) element.pause(); });
  await new Promise<void>((resolve) => { recorder.addEventListener('stop', () => resolve(), { once: true }); recorder.stop(); });
  output.getTracks().forEach((track) => track.stop());
  await audio.close();
  const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
  if (!blob.size) throw new Error('The browser produced an empty video');
  return blob;
}
