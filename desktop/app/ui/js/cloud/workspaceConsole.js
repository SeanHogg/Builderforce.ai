// A workspace Evermind's console — the SAME Teach / Test / Check / Maintain surface the
// VS Code extension shows, rendered from the shared bundle for whichever workspace model
// is chosen. Every call goes through the signed-in session; "Import from builderforce-memory"
// folds this machine's facts into the model and compacts them through the live store.
import { h, invoke } from "../bridge.js";
import { lang, t } from "../i18n.js";
import { refreshBrain } from "../brain/brainStore.js";
import { cloudRequest, consoleBundle } from "./cloudApi.js";
import { acceptData, selectedBuild, subscribeSource } from "./evermindSource.js";

const host = {
  request: cloudRequest,
  pickMemory: () => invoke("facts_learnable"),
  compactMemory: async ({ files, version }) => {
    const r = await invoke("facts_compact", { keys: files.flatMap((f) => f.absorbedKeys), version });
    refreshBrain();
    return r;
  },
};

export function workspaceConsole() {
  const status = h("p", { class: "muted", hidden: true });
  const el = h("section", { class: "card ev-console", hidden: true }, status);
  let mounted = null;
  let mountedFor = null;
  let disposed = false;

  const stop = subscribeSource(async (s) => {
    const build = selectedBuild(s);
    el.hidden = !build;
    const id = build?.storageProjectId ?? null;
    if (id === mountedFor) return;
    mounted?.unmount();
    mounted = null;
    mountedFor = id;
    el.replaceChildren(status);
    if (!build) return;
    status.textContent = t("evermind.consoleLoading");
    status.hidden = false;
    try {
      const m = await consoleBundle();
      if (disposed || mountedFor !== id) return;
      status.hidden = true;
      // A fresh container per model, so the console's state never carries across.
      const box = h("div");
      el.append(box);
      mounted = m.mountEvermindConsole(box, {
        host,
        projectId: id,
        projectName: build.name,
        canManage: s.canManage,
        locale: lang,
        onData: (data) => acceptData(id, data),
      });
    } catch (e) {
      status.textContent = t("evermind.consoleFailed", { error: String(e) });
    }
  });

  return {
    el,
    stop: () => {
      disposed = true;
      stop();
      mounted?.unmount();
    },
  };
}
