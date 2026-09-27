// The agents assigned to a chat — each can be addressed in the composer and removed here —
// and assigning another from the workspace's pool (its own, purchased and registered
// agents). Assigned agents answer with their own tools, as the person.
import { h, invoke, showError } from "../bridge.js";
import { t } from "../i18n.js";

let poolCache = null;

/** The workspace's assignable agents, read once per window (stable tenant data). */
export async function agentPool(force = false) {
  if (!poolCache || force) poolCache = invoke("agent_pool").then((r) => r.agents ?? []).catch(() => []);
  return poolCache;
}

export function resetAgentPool() {
  poolCache = null;
}

/** An assigned agent's display name: its own, else the pool's, else its ref. */
export const assignedName = (a, pool) => a.name || pool.find((p) => p.ref === String(a.agentRef))?.name || String(a.agentRef);

export function agentsBar(onChange) {
  const chips = h("div", { class: "row wrap agent-chips" });
  const pick = h("select", { attrs: { "aria-label": t("chat.assignAgent") } });
  const el = h("div", { class: "agents-bar row wrap" }, h("span", { class: "muted small", text: t("chat.agents") }), chips, pick);
  let chatId = null;

  pick.addEventListener("change", async () => {
    const choice = pick.selectedOptions[0];
    if (!choice?.value || chatId == null) return;
    pick.disabled = true;
    try {
      await invoke("chat_invite", { chatId, agentRef: choice.value, agentKind: choice.dataset.kind });
      await onChange();
    } catch (e) {
      showError(e);
    } finally {
      pick.disabled = false;
    }
  });

  async function update(id, assigned) {
    chatId = id;
    const pool = await agentPool();
    chips.replaceChildren(
      ...(assigned.length
        ? assigned.map((a) =>
            h(
              "span",
              { class: "chip agent-chip" },
              assignedName(a, pool),
              h("button", {
                class: "chip-x",
                type: "button",
                text: "×",
                attrs: { "aria-label": t("chat.removeAgent", { name: assignedName(a, pool) }) },
                on: {
                  click: async () => {
                    await invoke("chat_uninvite", { chatId, assignmentId: a.id }).catch(showError);
                    await onChange();
                  },
                },
              }),
            ),
          )
        : [h("span", { class: "muted small", text: t("chat.noAgents") })]),
    );
    const taken = new Set(assigned.map((a) => String(a.agentRef)));
    const free = pool.filter((p) => !taken.has(p.ref));
    pick.replaceChildren(
      h("option", { value: "", text: free.length ? t("chat.assignAgent") : t("chat.noMoreAgents") }),
      ...free.map((p) => h("option", { value: p.ref, text: p.name, attrs: { "data-kind": p.kind } })),
    );
    pick.disabled = free.length === 0;
  }

  return { el, update };
}
