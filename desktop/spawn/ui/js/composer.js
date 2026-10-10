// The build prompt: the same box every Builderforce prompt draws (web, editor, Synapse).
// One filled box, the text on top, and ONE round trailing button under it that is the
// mic on an empty box (where this window can listen) and Build once there is text.
// Enter builds; Shift+Enter starts a new line. The box is never greyed out while a build
// runs — what you send then waits its turn (see `send` in app.js).
import { t } from "./i18n.js";
import { dictation } from "./dictation.js";

const ICON_SEND = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const ICON_MIC = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

/** Wire the template's box to `onSend(text)`. Returns `paint`, for when a build starts or ends. */
export function mountComposer(onSend) {
  const form = document.getElementById("composer");
  const box = document.getElementById("composer-box");
  const input = document.getElementById("prompt");
  const action = document.getElementById("send");
  const voice = dictation(() => input.value, (text) => { input.value = text; paint(); });

  function paint() {
    const hasText = input.value.trim().length > 0;
    const mic = voice.recording || (!hasText && voice.supported);
    const label = mic ? (voice.recording ? t("build.stopDictation") : t("build.dictate")) : t("build.send");
    action.innerHTML = mic ? ICON_MIC : ICON_SEND;
    action.className = `composer-action ${mic ? "is-voice" : "is-send"}${voice.recording ? " is-listening" : ""}`;
    action.title = label;
    action.setAttribute("aria-label", label);
    action.setAttribute("aria-pressed", mic ? String(voice.recording) : "false");
    action.disabled = !mic && !hasText;
    box.classList.toggle("is-active", hasText || document.activeElement === input);
  }

  function submit() {
    const text = input.value.trim();
    if (!text) return;
    voice.stop();
    input.value = "";
    paint();
    onSend(text);
  }

  voice.onChange(paint);
  action.onclick = () => (action.classList.contains("is-voice") ? voice.toggle() : submit());
  form.onsubmit = (event) => {
    event.preventDefault();
    submit();
  };
  input.onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  input.oninput = paint;
  input.onfocus = paint;
  input.onblur = paint;
  paint();
  return { paint };
}
