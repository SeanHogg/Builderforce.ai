/**
 * captureAudio — turn a file or a microphone recording into mono PCM for the
 * on-device clone engine (Voice PRD: enrolment / capture-to-PCM, the IDE gap).
 *
 * Both paths converge on `decodeToPcm` (Web Audio `decodeAudioData`), so file
 * upload and mic capture share one decode + downmix + resample-free path — the
 * engine takes whatever sample rate the device decoded at and analyses against
 * it. Browser-only (guards `window`); returns the studio engine's PcmAudio shape.
 */

export interface PcmAudio {
  samples: Float32Array;
  sampleRate: number;
}

/** Decode any browser-supported audio blob/file to mono PCM. */
export async function decodeToPcm(data: Blob | ArrayBuffer): Promise<PcmAudio> {
  const buffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
  const Ctx =
    (window.AudioContext as typeof AudioContext) ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    return { samples: downmixToMono(decoded), sampleRate: decoded.sampleRate };
  } finally {
    void ctx.close();
  }
}

/** Average all channels to a single mono track (the engine analyses mono). */
function downmixToMono(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const out = new Float32Array(buf.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < data.length; i++) out[i] += data[i] / buf.numberOfChannels;
  }
  return out;
}

/**
 * A one-shot microphone recorder. `start()` opens the mic; `stop()` ends it and
 * resolves the captured audio as mono PCM. Releases the stream on stop.
 */
export class MicRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private stream: MediaStream | null = null;

  static get supported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  /** Stop, decode, and return the recording as mono PCM. */
  async stop(): Promise<PcmAudio> {
    const rec = this.recorder;
    if (!rec) throw new Error('Recorder not started');
    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' }));
    });
    rec.stop();
    const blob = await done;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    return decodeToPcm(blob);
  }
}
