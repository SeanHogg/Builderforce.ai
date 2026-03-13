import { LitElement, html } from "lit";

// Reimplementation of the quickstart block without decorators so Next.js can
// compile it. Reactive state is declared via the static `properties` map and
// the component is registered manually at the bottom.


type Mode = "oneliner" | "quick" | "hackable" | "macos";
type Pm = "npm" | "pnpm";
type HackableMode = "installer" | "pnpm";
type Os = "unix" | "windows";
type WinShell = "powershell" | "cmd";

type CommentSet = { stable: string; beta: string };

export class CclQuickstart extends LitElement {
  override createRenderRoot() { return this; }

  static properties = {
    currentPm: { type: String, state: true },
    currentMode: { type: String, state: true },
    currentHackable: { type: String, state: true },
    currentBeta: { type: Boolean, state: true },
    osPickerExpanded: { type: Boolean, state: true },
    currentWinShell: { type: String, state: true },
    copiedCommand: { type: String, state: true },
  };

  currentPm: Pm = "npm";
  currentMode: Mode = "oneliner";
  currentHackable: HackableMode = "installer";
  currentBeta = false;
  osPickerExpanded = false;
  currentWinShell: WinShell = "powershell";
  copiedCommand: string | null = null;

  private readonly comments: {
    oneliner: CommentSet;
    quickInstall: CommentSet;
    quickOnboard: CommentSet;
  } = {
    oneliner: {
      stable: "# Works everywhere. Installs everything. You're welcome. 🦞",
      beta: "# Living on the edge. Bugs are features you found first. 🦞",
    },
    quickInstall: {
      stable: "# Install CoderClaw",
      beta: "# Install CoderClaw (beta) — Fresh from the lab 🧪",
    },
    quickOnboard: {
      stable: "# Meet your lobster",
      beta: "# Meet your experimental lobster",
    },
  };

  private readonly windowsPsCmd = "iwr -useb https://coderclaw.ai/install.ps1 | iex";
  private readonly windowsPsBetaCmd = "& ([scriptblock]::Create((iwr -useb https://coderclaw.ai/install.ps1))) -Tag beta";
  private readonly windowsCmdCmd = "curl -fsSL https://coderclaw.ai/install.cmd -o install.cmd && install.cmd && del install.cmd";
  private readonly windowsCmdBetaCmd = "curl -fsSL https://coderclaw.ai/install.cmd -o install.cmd && install.cmd --tag beta && del install.cmd";

  private get currentOs(): Os {
    const isWindows = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform === "Windows"
      || navigator.userAgent.toLowerCase().includes("windows");
    return isWindows ? "windows" : "unix";
  }

  private get selectedOs(): Os {
    return this._selectedOs;
  }

  private set selectedOs(value: Os) {
    this._selectedOs = value;
  }

  private _selectedOs: Os = this.currentOs;

  private get osLabel() {
    return this.selectedOs === "windows" ? "Windows" : "macOS/Linux";
  }

  private get betaMode() {
    return this.currentBeta ? "beta" : "stable";
  }

  private get onelinerCommand() {
    if (this.selectedOs === "unix") {
      return this.currentBeta
        ? "curl -fsSL https://coderclaw.ai/install.sh | bash -s -- --beta"
        : "curl -fsSL https://coderclaw.ai/install.sh | bash";
    }
    if (this.currentWinShell === "cmd") {
      return this.currentBeta ? this.windowsCmdBetaCmd : this.windowsCmdCmd;
    }
    return this.currentBeta ? this.windowsPsBetaCmd : this.windowsPsCmd;
  }

  private get quickInstallCommand() {
    const betaSuffix = this.currentBeta ? "@beta" : "";
    return this.currentPm === "npm"
      ? `npm i -g coderclaw${betaSuffix}`
      : `pnpm add -g coderclaw${betaSuffix}`;
  }

  private async copyCommand(kind: string, command: string) {
    let success = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
        success = true;
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = command;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        try {
          textArea.select();
          success = document.execCommand("copy");
        } finally {
          textArea.remove();
        }
      }
    } catch {
      success = false;
    }

    if (!success) return;

    this.copiedCommand = kind;
    window.setTimeout(() => {
      if (this.copiedCommand === kind) this.copiedCommand = null;
    }, 2000);
  }

  private renderCopyButton(kind: string, command: string) {
    const copied = this.copiedCommand === kind;
    return html`
      <button class="copy-line-btn ${copied ? "copied" : ""}" @click=${() => this.copyCommand(kind, command)} title="Copy">
        <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style=${copied ? "display:none" : ""}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style=${copied ? "display:block" : "display:none"}><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    `;
  }

  override render() {
    const showOsControls = this.currentMode === "oneliner";
    const showPmControls = this.currentMode === "quick";
    const showHackableControls = this.currentMode === "hackable";
    const showBetaControls = this.currentMode === "oneliner" || this.currentMode === "quick";
    const showWinShellControls = showOsControls && this.selectedOs === "windows";

    return html`
      <section class="quickstart quickstart-skin">
        <h2 class="section-title">
          <span class="claw-accent">⟩</span> Quick Start
        </h2>
        <div class="code-block">
          <div class="code-header">
            <span class="code-dot"></span>
            <span class="code-dot"></span>
            <span class="code-dot"></span>

            <div class="mode-switch">
              <button class="mode-btn ${this.currentMode === "oneliner" ? "active" : ""}" @click=${() => { this.currentMode = "oneliner"; this.osPickerExpanded = false; }}>One-liner</button>
              <button class="mode-btn ${this.currentMode === "quick" ? "active" : ""}" @click=${() => { this.currentMode = "quick"; this.osPickerExpanded = false; }}>npm</button>
              <button class="mode-btn ${this.currentMode === "hackable" ? "active" : ""}" @click=${() => { this.currentMode = "hackable"; this.osPickerExpanded = false; }}>Hackable</button>
              <button class="mode-btn ${this.currentMode === "macos" ? "active" : ""}" @click=${() => { this.currentMode = "macos"; this.osPickerExpanded = false; }}>macOS</button>
            </div>

            <div class="pm-switch" style=${showPmControls ? "display:flex" : "display:none"}>
              <button class="pm-btn ${this.currentPm === "npm" ? "active" : ""}" @click=${() => { this.currentPm = "npm"; }}>npm</button>
              <button class="pm-btn ${this.currentPm === "pnpm" ? "active" : ""}" @click=${() => { this.currentPm = "pnpm"; }}>pnpm</button>
            </div>

            <div class="hackable-switch" style=${showHackableControls ? "display:flex" : "display:none"}>
              <button class="hackable-btn ${this.currentHackable === "installer" ? "active" : ""}" @click=${() => { this.currentHackable = "installer"; }}>installer</button>
              <button class="hackable-btn ${this.currentHackable === "pnpm" ? "active" : ""}" @click=${() => { this.currentHackable = "pnpm"; }}>pnpm</button>
            </div>

            <div class="os-indicator" style=${showOsControls && !this.osPickerExpanded ? "display:flex" : "display:none"}>
              <span class="os-detected">${this.osLabel}</span>
              <button class="os-change-btn" @click=${() => { this.osPickerExpanded = true; }}>change</button>
            </div>

            <div class="os-switch" style=${showOsControls && this.osPickerExpanded ? "display:flex" : "display:none"}>
              <button class="os-btn ${this.selectedOs === "unix" ? "active" : ""}" @click=${() => { this.selectedOs = "unix"; this.osPickerExpanded = false; }}>macOS/Linux</button>
              <button class="os-btn ${this.selectedOs === "windows" ? "active" : ""}" @click=${() => { this.selectedOs = "windows"; this.osPickerExpanded = false; }}>Windows</button>
            </div>

            <div class="win-shell-switch" style=${showWinShellControls ? "display:flex" : "display:none"}>
              <button class="win-shell-btn ${this.currentWinShell === "powershell" ? "active" : ""}" @click=${() => { this.currentWinShell = "powershell"; }}>PowerShell</button>
              <button class="win-shell-btn ${this.currentWinShell === "cmd" ? "active" : ""}" @click=${() => { this.currentWinShell = "cmd"; }}>CMD</button>
            </div>

            <div class="beta-switch" style=${showBetaControls ? "display:flex" : "display:none"}>
              <button class="beta-btn ${this.currentBeta ? "active" : ""}" @click=${() => { this.currentBeta = !this.currentBeta; }}>
                <span class="beta-label">β</span>
                <span class="beta-text">Beta</span>
              </button>
            </div>

            <div class="switch-placeholder" style=${!showOsControls && !showPmControls && !showHackableControls && !showBetaControls ? "display:block" : "display:none"} aria-hidden="true"></div>
          </div>

          <div class="code-content" style=${this.currentMode === "oneliner" ? "display:block" : "display:none"}>
            <div class="code-line comment">${this.comments.oneliner[this.betaMode]}</div>
            <div class="code-line cmd">
              <span class="code-prompt">$</span>
              <span class="os-cmd">${this.onelinerCommand}</span>
              ${this.renderCopyButton("oneliner", this.onelinerCommand)}
            </div>
          </div>

          <div class="code-content" style=${this.currentMode === "quick" ? "display:block" : "display:none"}>
            <div class="code-line comment">${this.comments.quickInstall[this.betaMode]}</div>
            <div class="code-line cmd">
              <span class="code-prompt">$</span>
              <span class="pm-install">${this.quickInstallCommand}</span>
              ${this.renderCopyButton("install", this.quickInstallCommand)}
            </div>
            <div class="code-line comment">${this.comments.quickOnboard[this.betaMode]}</div>
            <div class="code-line cmd">
              <span class="code-prompt">$</span>
              <span>coderclaw onboard</span>
              ${this.renderCopyButton("onboard", "coderclaw onboard")}
            </div>
          </div>

          <div class="code-content" style=${this.currentMode === "hackable" ? "display:block" : "display:none"}>
            <div style=${this.currentHackable === "installer" ? "display:block" : "display:none"}>
              <div class="code-line comment"># For those who read source code for fun</div>
              <div class="code-line cmd">
                <span class="code-prompt">$</span>
                <span class="os-cmd-hackable">curl -fsSL https://coderclaw.ai/install.sh | bash -s -- --install-method git</span>
                ${this.renderCopyButton("hackable-installer", "curl -fsSL https://coderclaw.ai/install.sh | bash -s -- --install-method git")}
              </div>
            </div>
            <div style=${this.currentHackable === "pnpm" ? "display:block" : "display:none"}>
              <div class="code-line comment"># You clearly know what you're doing</div>
              <div class="code-line cmd">
                <span class="code-prompt">$</span>
                <span>git clone https://github.com/seanhogg/coderclaw.git</span>
                ${this.renderCopyButton("clone", "git clone https://github.com/seanhogg/coderclaw.git")}
              </div>
              <div class="code-line cmd">
                <span class="code-prompt">$</span>
                <span>cd coderclaw && pnpm install && pnpm run build</span>
                ${this.renderCopyButton("build", "cd coderclaw && pnpm install && pnpm run build")}
              </div>
              <div class="code-line comment"># You built it, now meet it</div>
              <div class="code-line cmd">
                <span class="code-prompt">$</span>
                <span>pnpm run coderclaw onboard</span>
                ${this.renderCopyButton("hackable-onboard", "node coderclaw.mjs onboard")}
              </div>
            </div>
          </div>

          <div class="code-content" style=${this.currentMode === "macos" ? "display:block" : "display:none"}>
            <div class="macos-app-content">
              <div class="macos-description">
                <span class="macos-tagline">Companion App (Beta)</span>
                <span class="macos-subtitle">Menubar access to your lobster. Works great alongside the CLI.</span>
              </div>
              <a href="https://github.com/SeanHogg/coderClaw/releases/latest" class="macos-download-btn" target="_blank" rel="noopener">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download for macOS
              </a>
              <span class="macos-meta">Requires macOS 14+ · Universal Binary</span>
            </div>
          </div>
        </div>

        <p class="quickstart-note">Works on macOS, Windows & Linux. The one-liner installs Node.js and everything else for you.</p>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ccl-quickstart": CclQuickstart;
  }
}

// register element
if (!customElements.get("ccl-quickstart")) {
  customElements.define("ccl-quickstart", CclQuickstart);
}
