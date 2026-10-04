import { useCallback, useRef, useState } from 'react';

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
};

/**
 * Dictation into the composer through the browser's Speech Recognition. Each final
 * phrase is appended to the CURRENT text — read through `getValue` at the moment it
 * lands, not the text as it stood when recording began.
 */
export function useVoiceDictation(getValue: () => string, onChange: (value: string) => void) {
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const [recording, setRecording] = useState(false);

  const startVoice = useCallback(() => {
    const Win = typeof window !== 'undefined' ? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance; SpeechRecognition?: new () => SpeechRecognitionInstance }) : null;
    const Recognition = Win?.SpeechRecognition ?? Win?.webkitSpeechRecognition;
    if (!Recognition) return;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setRecording(false);
      return;
    }
    const r = new Recognition();
    recognitionRef.current = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    let lastFinal = '';
    r.onresult = (event: SpeechRecognitionResultEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) lastFinal += transcript;
      }
      if (lastFinal) {
        const current = getValue();
        onChange(current + (current ? ' ' : '') + lastFinal);
        lastFinal = '';
      }
    };
    r.onend = () => {
      recognitionRef.current = null;
      setRecording(false);
    };
    r.start();
    setRecording(true);
  }, [getValue, onChange]);

  const stopVoice = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setRecording(false);
  }, []);

  return { recording, startVoice, stopVoice };
}
