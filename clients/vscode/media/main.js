// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const messagesEl = /** @type {HTMLElement} */ (document.getElementById("messages"));
  const inputEl = /** @type {HTMLTextAreaElement} */ (document.getElementById("input"));
  const sendBtn = /** @type {HTMLButtonElement} */ (document.getElementById("send"));
  const stopBtn = /** @type {HTMLButtonElement} */ (document.getElementById("stop"));
  const modelChip = /** @type {HTMLElement} */ (document.getElementById("model-chip"));
  const scanChip = /** @type {HTMLElement} */ (document.getElementById("scan-chip"));

  /** @type {Record<string, HTMLElement>} */
  const bubbles = {};
  let signedIn = false;

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
  }

  function clearEmptyState() {
    const empty = document.getElementById("empty");
    if (empty) empty.remove();
  }

  function renderEmptyState() {
    messagesEl.innerHTML = "";
    Object.keys(bubbles).forEach((k) => delete bubbles[k]);
    const div = document.createElement("div");
    div.id = "empty";
    if (signedIn) {
      div.textContent = "Ask BuilderForce anything about your code.";
    } else {
      div.innerHTML =
        "Sign in to start chatting with BuilderForce." +
        '<br/><button id="signin-btn">Sign In</button>';
    }
    messagesEl.appendChild(div);
    const btn = document.getElementById("signin-btn");
    if (btn) btn.addEventListener("click", () => vscode.postMessage({ type: "signin" }));
  }

  function addMessage(role, text) {
    clearEmptyState();
    const wrap = document.createElement("div");
    wrap.className = "msg " + role;
    const r = document.createElement("div");
    r.className = "role";
    r.textContent = role;
    const b = document.createElement("div");
    b.className = "bubble";
    b.textContent = text || "";
    wrap.appendChild(r);
    wrap.appendChild(b);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return b;
  }

  function addToolRow(label, phase, ok) {
    clearEmptyState();
    const row = document.createElement("div");
    row.className = "tool-row" + (phase === "end" && ok === false ? " failed" : "");
    const icon = phase === "end" ? (ok === false ? "✗" : "✓") : "⟳";
    row.textContent = `${icon} ${label}`;
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setGrounded(on) {
    scanChip.hidden = !on;
  }

  function setStreaming(on) {
    sendBtn.hidden = on;
    stopBtn.hidden = !on;
  }

  function submit() {
    const text = inputEl.value.trim();
    if (!text) return;
    if (!signedIn) {
      vscode.postMessage({ type: "signin" });
      return;
    }
    inputEl.value = "";
    vscode.postMessage({ type: "submit", text });
  }

  sendBtn.addEventListener("click", submit);
  stopBtn.addEventListener("click", () => vscode.postMessage({ type: "stop" }));
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  window.addEventListener("message", (event) => {
    const m = event.data;
    switch (m.type) {
      case "state":
        signedIn = !!m.signedIn;
        modelChip.textContent = m.model || "(auto)";
        setGrounded(!!m.grounded);
        if (!messagesEl.querySelector(".msg")) renderEmptyState();
        break;
      case "model":
        modelChip.textContent = m.model || "(auto)";
        break;
      case "scan":
        setGrounded(!!m.grounded);
        break;
      case "tool":
        addToolRow(m.label, m.phase, m.ok);
        break;
      case "cleared":
        renderEmptyState();
        break;
      case "user":
        addMessage("user", m.text);
        break;
      case "assistantStart":
        bubbles[m.id] = addMessage("assistant", "");
        setStreaming(true);
        break;
      case "chunk":
        if (bubbles[m.id]) {
          bubbles[m.id].textContent += m.delta;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        break;
      case "assistantDone":
        setStreaming(false);
        delete bubbles[m.id];
        break;
      case "error":
        setStreaming(false);
        addMessage("error", "Error: " + m.message);
        delete bubbles[m.id];
        break;
      case "needSignIn":
        signedIn = false;
        renderEmptyState();
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
})();
