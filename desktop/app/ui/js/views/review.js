// Review: the step between recording and a skill. Every step shows what Train Once will
// do with it — the compiler's own defaults, previewed live — and the person decides:
// keep or drop it, ask for a value each run or keep the recorded one, and whether to
// pause for approval.
import { dialog, h, invoke, route, showError } from "../bridge.js";
import { t } from "../i18n.js";
import { stepText, stepWhere } from "../stepText.js";

function thumb(episodeId, file) {
  const img = h("img", { class: "thumb", alt: "", loading: "lazy" });
  if (file) invoke("step_image", { episodeId, file }).then((src) => src && (img.src = src)).catch(() => {});
  else img.hidden = true;
  return img;
}

export function render(host, params) {
  const episodeId = params.get("episode");
  const edits = { name: "", removed: [], fixed: [], approvals: {}, paramNames: {} };
  let episode = null;
  let preview = null;

  const nameInput = h("input", { attrs: { "aria-label": t("review.name") }, on: { input: (e) => (edits.name = e.target.value) } });
  const list = h("ol", { class: "review-steps" });
  const summary = h("p", { class: "muted small" });

  const toggle = (arr, id, on) => {
    const i = arr.indexOf(id);
    if (on && i < 0) arr.push(id);
    if (!on && i >= 0) arr.splice(i, 1);
  };

  async function refreshPreview() {
    try {
      preview = await invoke("skill_preview", { episodeId, edits });
      paint();
    } catch (e) {
      showError(e);
    }
  }

  function stepRow(rec) {
    const compiled = preview?.steps.find((s) => s.id === rec.id);
    const removed = edits.removed.includes(rec.id);
    const a = rec.action;
    const valueControls =
      a.kind === "setValue" && !a.secret && !removed
        ? h(
            "div",
            { class: "row wrap" },
            h(
              "select",
              {
                attrs: { "aria-label": t("review.valueMode") },
                on: { change: (e) => { toggle(edits.fixed, rec.id, e.target.value === "fixed"); refreshPreview(); } },
              },
              h("option", { value: "param", text: t("review.askEachRun"), selected: !edits.fixed.includes(rec.id) }),
              h("option", { value: "fixed", text: t("review.keepRecorded"), selected: edits.fixed.includes(rec.id) }),
            ),
            !edits.fixed.includes(rec.id) &&
              h("input", {
                class: "param-name",
                value: edits.paramNames[rec.id] ?? (compiled?.action.value?.name || ""),
                attrs: { "aria-label": t("review.paramName") },
                on: { change: (e) => { edits.paramNames[rec.id] = e.target.value; refreshPreview(); } },
              }),
          )
        : null;
    return h(
      "li",
      { class: `card review-step ${removed ? "removed" : ""}` },
      thumb(episodeId, rec.screenshot),
      h(
        "div",
        { class: "stack min0 grow" },
        h("div", {}, h("strong", { text: stepText(a) }), h("div", { class: "muted small", text: stepWhere(a) })),
        a.kind === "setValue" && a.secret && h("span", { class: "pill idle", text: t("review.secret") }),
        valueControls,
        h(
          "div",
          { class: "row wrap" },
          h("label", { class: "check" }, h("input", { type: "checkbox", checked: !removed, on: { change: (e) => { toggle(edits.removed, rec.id, !e.target.checked); refreshPreview(); } } }), t("review.keep")),
          !removed &&
            h(
              "label",
              { class: "check" },
              h("input", { type: "checkbox", checked: !!compiled?.requiresApproval, on: { change: (e) => { edits.approvals[rec.id] = e.target.checked; refreshPreview(); } } }),
              t("review.askFirst"),
            ),
        ),
      ),
    );
  }

  function paint() {
    if (!episode) return;
    list.replaceChildren(...episode.steps.map(stepRow));
    if (preview) {
      const approvals = preview.steps.filter((s) => s.requiresApproval).length;
      summary.textContent = t("review.summary", { steps: preview.steps.length, params: preview.params.length, approvals });
    }
  }

  async function save() {
    try {
      await invoke("skill_compile", { episodeId, edits });
      location.hash = route("skills");
    } catch (e) {
      showError(e);
    }
  }

  async function discard() {
    const ok = await dialog.ask(t("review.discardConfirm"), { title: t("review.discard"), kind: "warning" });
    if (!ok) return;
    await invoke("episode_delete", { id: episodeId }).catch(showError);
    location.hash = route("teach");
  }

  host.append(
    h("a", { class: "back", href: route("teach"), text: `← ${t("nav.teach")}` }),
    h("header", { class: "page-head" }, h("div", {}, h("h1", { text: t("review.title") }), h("p", { class: "muted", text: t("review.intro") }))),
    h(
      "section",
      { class: "card row wrap between" },
      h("label", { class: "field grow" }, h("span", { text: t("review.name") }), nameInput),
      h("div", { class: "row" }, h("button", { class: "primary", text: t("review.save"), on: { click: save } }), h("button", { class: "ghost danger", text: t("review.discard"), on: { click: discard } })),
    ),
    summary,
    list,
  );

  invoke("episode_get", { id: episodeId })
    .then((ep) => {
      if (!ep) {
        location.hash = route("teach");
        return;
      }
      episode = ep;
      nameInput.value = edits.name = ep.name;
      return refreshPreview();
    })
    .catch(showError);
  return null;
}
