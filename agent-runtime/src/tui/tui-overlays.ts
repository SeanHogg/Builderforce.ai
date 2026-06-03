import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { theme } from "./theme/theme.js";

type OverlayHost = Pick<TUI, "showOverlay" | "hideOverlay" | "hasOverlay" | "setFocus">;

type FocusableComponent = Component & { focused?: boolean };

class ModalOverlayFrame implements Component {
  private _focused = false;

  constructor(private readonly inner: Component) {}

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 2);
    const innerLines = this.inner.render(innerWidth);
    const contentLines = innerLines.length > 0 ? innerLines : [""];
    const top = theme.modalBorder(`┌${"─".repeat(innerWidth)}┐`);
    const bottom = theme.modalBorder(`└${"─".repeat(innerWidth)}┘`);
    const body = contentLines.map((line) => {
      const trimmed = truncateToWidth(line, innerWidth, "");
      const pad = " ".repeat(Math.max(0, innerWidth - visibleWidth(trimmed)));
      return `${theme.modalBorder("│")}${theme.modalBg(`${trimmed}${pad}`)}${theme.modalBorder("│")}`;
    });
    return [top, ...body, bottom];
  }

  handleInput?(data: string): void {
    this.inner.handleInput?.(data);
  }

  invalidate(): void {
    this.inner.invalidate();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    const maybeFocusable = this.inner as FocusableComponent;
    if (typeof maybeFocusable.focused === "boolean") {
      maybeFocusable.focused = value;
    }
  }
}

export function createOverlayHandlers(host: OverlayHost, fallbackFocus: Component) {
  const openOverlay = (component: Component) => {
    host.showOverlay(new ModalOverlayFrame(component));
  };

  const closeOverlay = () => {
    if (host.hasOverlay()) {
      host.hideOverlay();
      return;
    }
    host.setFocus(fallbackFocus);
  };

  return { openOverlay, closeOverlay };
}
