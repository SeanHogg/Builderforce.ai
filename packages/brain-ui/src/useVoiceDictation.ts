import { useCallback, useEffect, useRef, useState } from 'react';

/** Browser Web Speech API (not in all TS libs). */
type SpeechRecognitionResultEvent = { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; [0]: { transcript: string } } } };
type SpeechRecognitionInstance = {
  start(): void;
  stop(): void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type RecognitionCtor = new () => SpeechRecognitionInstance;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Dictation into a composer through the runtime's Speech Recognition — the one hook
 * every React prompt surface uses (web composer, editor panel).
 *
 * Each final phrase is appended to the CURRENT text, read through `getValue` at the
 * moment it lands rather than the text as it stood when recording began, so typing
 * while dictating is never overwritten. `supported` is false where the runtime cannot
 * listen (several embedded webviews), and a host then shows no mic at all rather than a
 * button that does nothing.
 */
export function useVoiceDictation(getValue: () => string, onChange: (value: string) => void) {
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const [recording, setRecording] = useState(false);
  const [supported] = useState(() => recognitionCtor() != null);

  const stopVoice = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecording(false);
  }, []);

  const startVoice = useCallback(() => {
    const Recognition = recognitionCtor();
    if (!Recognition) return;
    if (recognitionRef.current) { stopVoice(); return; }
    const r = new Recognition();
    recognitionRef.current = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    r.onresult = (event) => {
      let phrase = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) phrase += event.results[i][0].transcript;
      }
      if (!phrase) return;
      const current = getValue();
      onChange(current + (current && !/\s$/.test(current) ? ' ' : '') + phrase.trim());
    };
    const done = () => {
      recognitionRef.current = null;
      setRecording(false);
    };
    r.onend = done;
    r.onerror = done;
    try {
      r.start();
      setRecording(true);
    } catch {
      done();
    }
  }, [getValue, onChange, stopVoice]);

  // A recognizer outliving its composer keeps the microphone open.
  useEffect(() => () => { recognitionRef.current?.stop(); }, []);

  return { supported, recording, startVoice, stopVoice };
}
