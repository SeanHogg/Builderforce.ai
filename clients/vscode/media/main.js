// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const messagesEl = /** @type {HTMLElement} */ (document.getElementById("messages"));
  const inputEl = /** @type {HTMLTextAreaElement} */ (document.getElementById("input"));
  const sendBtn = /** @type {HTMLButtonElement} */ (document.getElementById("send"));
  const stopBtn = /** @type {HTMLButtonElement} */ (document.getElementById("stop"));
  const modelChip = /** @type {HTMLElement} */ (document.getElementById("model-chip"));
  const scanChip = /** @type {HTMLElement} */ (document.getElementById("scan-chip"));
  const copyBtn = /** @type {HTMLButtonElement} */ (document.getElementById("copy-output"));

  /** id -> { el: bubble, raw: string } for streaming assistant messages. */
  const bubbles = {};
  /** Ordered plain-text log for the "Copy output" debug button. */
  const log = [];
  let activeAssistantLogIdx = -1;
  let signedIn = false;

  // ---------- helpers ----------
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
  }

  /** Minimal, XSS-safe markdown: escape first, then transform the escaped string. */
  function renderMarkdown(md) {
    const parts = String(md).split(/```/);
    let html = "";
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        // code fence (odd segments). Drop an optional leading language token.
        const body = parts[i].replace(/^[a-zA-Z0-9_-]*\n/, "");
        html += `<pre><code>${escapeHtml(body)}</code></pre>`;
      } else {
        html += renderInline(parts[i]);
      }
    }
    return html;
  }

  function renderInline(text) {
    const blocks = escapeHtml(text).split(/\n{2,}/);
    return blocks
      .map((block) => {
        const lines = block.split("\n");
        // bullet list
        if (lines.every((l) => /^\s*[-*]\s+/.test(l) || l.trim() === "")) {
          const items = lines
            .filter((l) => l.trim() !== "")
            .map((l) => `<li>${inlineFmt(l.replace(/^\s*[-*]\s+/, ""))}</li>`)
            .join("");
          return `<ul>${items}</ul>`;
        }
        // heading
        const h = block.match(/^(#{1,6})\s+(.*)$/);
        if (h && lines.length === 1) return `<h4>${inlineFmt(h[2])}</h4>`;
        return `<p>${lines.map(inlineFmt).join("<br>")}</p>`;
      })
      .join("");
  }

  function inlineFmt(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>',
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
      div.textContent = "Ask BuilderForce to build or change something in your open folder.";
    } else {
      div.innerHTML = "Sign in to start.<br/><button id='signin-btn' class='primary'>Sign in</button>";
    }
    messagesEl.appendChild(div);
    const btn = document.getElementById("signin-btn");
    if (btn) btn.addEventListener("click", () => vscode.postMessage({ type: "signin" }));
  }

  function addMessage(role, text, isMarkdown) {
    clearEmptyState();
    const wrap = document.createElement("div");
    wrap.className = "msg " + role;
    const r = document.createElement("div");
    r.className = "role";
    r.textContent = role === "assistant" ? "BuilderForce" : role === "user" ? "You" : role;
    const b = document.createElement("div");
    b.className = "bubble";
    if (isMarkdown) b.innerHTML = renderMarkdown(text || "");
    else b.textContent = text || "";
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
    log.push(`• tool ${phase === "end" ? (ok === false ? "failed" : "done") : "start"}: ${label}`);
  }

  function setStreaming(on) {
    sendBtn.hidden = on;
    stopBtn.hidden = !on;
  }
  function setGrounded(on) {
    scanChip.hidden = !on;
  }

  function submit() {
    const text = inputEl.value.trim();
    if (!text) return;
    if (!signedIn) return vscode.postMessage({ type: "signin" });
    inputEl.value = "";
    vscode.postMessage({ type: "submit", text });
  }

  // ---------- events ----------
  sendBtn.addEventListener("click", submit);
  stopBtn.addEventListener("click", () => vscode.postMessage({ type: "stop" }));
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(log.join("\n\n") || "(empty)");
      const prev = copyBtn.textContent;
      copyBtn.textContent = "✓ Copied";
      setTimeout(() => (copyBtn.textContent = prev), 1200);
    } catch {
      /* clipboard blocked */
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
      case "cleared":
        log.length = 0;
        renderEmptyState();
        break;
      case "restore":
        messagesEl.innerHTML = "";
        Object.keys(bubbles).forEach((k) => delete bubbles[k]);
        log.length = 0;
        for (const item of m.messages || []) {
          if (item.role === "user") {
            addMessage("user", item.text, false);
            log.push(`USER:\n${item.text}`);
          } else if (item.role === "assistant") {
            addMessage("assistant", item.text, true);
            log.push(`ASSISTANT:\n${item.text}`);
          }
        }
        if (!messagesEl.querySelector(".msg")) renderEmptyState();
        break;
      case "user":
        addMessage("user", m.text, false);
        log.push(`USER:\n${m.text}`);
        break;
      case "assistantStart":
        bubbles[m.id] = { el: addMessage("assistant", "", true), raw: "" };
        log.push("ASSISTANT:\n");
        activeAssistantLogIdx = log.length - 1;
        setStreaming(true);
        break;
      case "chunk":
        if (bubbles[m.id]) {
          bubbles[m.id].raw += m.delta;
          bubbles[m.id].el.innerHTML = renderMarkdown(bubbles[m.id].raw);
          if (activeAssistantLogIdx >= 0) log[activeAssistantLogIdx] = `ASSISTANT:\n${bubbles[m.id].raw}`;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        break;
      case "assistantDone":
        setStreaming(false);
        delete bubbles[m.id];
        activeAssistantLogIdx = -1;
        break;
      case "error":
        setStreaming(false);
        addMessage("error", "Error: " + m.message, false);
        log.push(`ERROR: ${m.message}`);
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
