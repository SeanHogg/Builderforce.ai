// Dictation into a text box through the window's Speech Recognition, where it has one
// (the system webview may not). Each final phrase is appended to the text as it stands
// when the phrase lands, so typing while dictating is never overwritten. The same
// behaviour as the shared `useVoiceDictation` the web and editor composers use; Spawn
// keeps an identical copy at `desktop/spawn/ui/js/dictation.js` (its own `ui/` root).

function recognitionCtor() {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function dictation(getText, setText) {
  const Recognition = recognitionCtor();
  const listeners = new Set();
  let rec = null;
  const state = {
    supported: Recognition != null,
    get recording() { return rec != null; },
    onChange(fn) { listeners.add(fn); },
    toggle() { rec ? state.stop() : start(); },
    stop() {
      if (!rec) return;
      const r = rec;
      rec = null;
      try { r.stop(); } catch { /* already ended */ }
      emit();
    },
  };
  const emit = () => listeners.forEach((fn) => fn());

  function start() {
    if (!Recognition) return;
    const r = new Recognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    r.onresult = (event) => {
      let phrase = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) phrase += event.results[i][0].transcript;
      }
      if (!phrase) return;
      const current = getText();
      setText(current + (current && !/\s$/.test(current) ? " " : "") + phrase.trim());
    };
    const done = () => {
      if (rec !== r) return;
      rec = null;
      emit();
    };
    r.onend = done;
    r.onerror = done;
    rec = r;
    try {
      r.start();
    } catch {
      done();
    }
    emit();
  }

  return state;
}
