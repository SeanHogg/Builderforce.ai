'use client';

import { useEffect, useRef } from 'react';

/**
 * useSpeechCaptions — browser-native live speech-to-text for the local mic, used to
 * caption + transcribe a meeting without any server STT infrastructure.
 *
 * Built on the Web Speech API (`SpeechRecognition` / vendor `webkitSpeechRecognition`
 * — Chrome/Edge today). Each participant transcribes only their OWN mic locally;
 * final lines are sent up (persisted + broadcast to peers as captions). Where the API
 * is unavailable the hook is a no-op — everything else (agent voice, remote captions,
 * minutes) still works, so it degrades gracefully.
 */

/** Minimal shape of the vendor Web Speech API (absent from the TS DOM lib). */
interface SpeechRecognitionResultLike { readonly isFinal: boolean; readonly length: number; [i: number]: { transcript: string }; }
interface SpeechRecognitionEventLike { resultIndex: number; results: { length: number; [i: number]: SpeechRecognitionResultLike }; }
interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** True when this browser can transcribe locally (drives the "captions on" UI hint). */
export function isSpeechCaptionsSupported(): boolean {
  return recognitionCtor() != null;
}

export function useSpeechCaptions(opts: {
  enabled: boolean;
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
}): void {
  const { enabled, onInterim, onFinal } = opts;
  const onInterimRef = useRef(onInterim);
  const onFinalRef = useRef(onFinal);
  onInterimRef.current = onInterim;
  onFinalRef.current = onFinal;

  useEffect(() => {
    const Ctor = recognitionCtor();
    if (!enabled || !Ctor) return;
    let rec: SpeechRecognitionLike | null = null;
    let stopped = false;
    try { rec = new Ctor(); } catch { return; }

    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0]?.transcript ?? '';
        if (r.isFinal) { const t = txt.trim(); if (t) onFinalRef.current(t); }
        else interim += txt;
      }
      const it = interim.trim();
      if (it) onInterimRef.current?.(it);
    };
    // Recognition stops itself after a silence; restart it while still enabled.
    rec.onend = () => { if (!stopped) { try { rec?.start(); } catch { /* ignore */ } } };
    rec.onerror = () => { /* transient (no-speech / network) — onend re-arms */ };
    try { rec.start(); } catch { /* mic busy / not-allowed — no-op */ }

    return () => { stopped = true; try { rec?.abort(); } catch { /* ignore */ } };
  }, [enabled]);
}
