import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import { BOOT_STRINGS_ELEMENT_ID, type RootFallbackStrings } from '../../src/webviewBundleShell';
import { errorReport, type WebviewErrorReport } from './uncaughtErrorRelay';
import { post } from './vscodeBridge';

/**
 * THE PANEL NEVER GOES BLANK.
 *
 * A React tree that throws unmounts everything above the nearest boundary. Inner
 * boundaries (`CanvasBoundary` around the board and the Knowledge view) degrade the
 * surfaces that have somewhere better to fall back to; this one sits above ALL of
 * `WorkspaceApp`, so a throw anywhere else — the chat surface, Changes, Evermind,
 * Project 360, a page screen — ends on a readable, themed notice with a way out
 * instead of a black panel.
 *
 * Its copy cannot come from the label bundle: that arrives with `init`, and the crash
 * may come first or take the bundle's holder down with it. The host localizes it at
 * boot instead (`renderWebviewHtml` → `bootStrings`), as a JSON data block in the
 * document; English is only the fallback for a document without one (tests).
 */

/** English, for a document that carries no boot strings. */
export const DEFAULT_ROOT_FALLBACK_STRINGS: RootFallbackStrings = {
  title: 'BuilderForce hit an error',
  body: 'This panel stopped drawing. The error was sent to the BuilderForce output log.',
  reload: 'Reload panel',
  copy: 'Copy details',
};

/** The host-localized copy embedded in the document, over the English defaults. */
export function readBootStrings(doc: Pick<Document, 'getElementById'> | undefined = typeof document === 'undefined' ? undefined : document): RootFallbackStrings {
  const raw = doc?.getElementById(BOOT_STRINGS_ELEMENT_ID)?.textContent;
  if (!raw) return DEFAULT_ROOT_FALLBACK_STRINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof RootFallbackStrings, unknown>>;
    const pick = (key: keyof RootFallbackStrings) => (typeof parsed[key] === 'string' && parsed[key] ? (parsed[key] as string) : DEFAULT_ROOT_FALLBACK_STRINGS[key]);
    return { title: pick('title'), body: pick('body'), reload: pick('reload'), copy: pick('copy') };
  } catch {
    return DEFAULT_ROOT_FALLBACK_STRINGS;
  }
}

/** What "Copy details" puts on the clipboard: the message, then each stack. */
export function errorDetails(report: WebviewErrorReport): string {
  return [report.message, report.stack, report.componentStack && `Component stack:${report.componentStack}`].filter(Boolean).join('\n\n');
}

// Editor theme variables, so the notice reads in light, dark and high-contrast themes;
// inline because a crash may also mean a stylesheet never applied.
const shell: CSSProperties = {
  boxSizing: 'border-box',
  minHeight: '100vh',
  padding: 16,
  background: 'var(--vscode-editor-background)',
  color: 'var(--vscode-foreground)',
  fontFamily: 'var(--vscode-font-family)',
  fontSize: 'var(--vscode-font-size)',
  overflowWrap: 'anywhere',
};
const detail: CSSProperties = {
  margin: '12px 0',
  padding: 8,
  maxHeight: '40vh',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  fontFamily: 'var(--vscode-editor-font-family)',
  background: 'var(--vscode-textCodeBlock-background)',
  border: '1px solid var(--vscode-panel-border, transparent)',
};
const button: CSSProperties = {
  padding: '4px 12px',
  border: '1px solid var(--vscode-button-border, transparent)',
  borderRadius: 2,
  cursor: 'pointer',
  font: 'inherit',
};
const primary: CSSProperties = { ...button, background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)' };
const secondary: CSSProperties = { ...button, background: 'var(--vscode-button-secondaryBackground)', color: 'var(--vscode-button-secondaryForeground)' };

export function RootFallback({ strings, message, onReload, onCopy }: { strings: RootFallbackStrings; message: string; onReload: () => void; onCopy: () => void }) {
  return (
    <div role="alert" style={shell} data-testid="bf-root-fallback">
      <h2 style={{ margin: '0 0 8px', fontSize: '1.2em' }}>{strings.title}</h2>
      <p style={{ margin: 0 }}>{strings.body}</p>
      <pre style={detail}>{message}</pre>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" style={primary} onClick={onReload}>{strings.reload}</button>
        <button type="button" style={secondary} onClick={onCopy}>{strings.copy}</button>
      </div>
    </div>
  );
}

/** A class because `componentDidCatch` has no hook equivalent. */
export class RootBoundary extends Component<{ children: ReactNode }, { report: WebviewErrorReport | null }> {
  state: { report: WebviewErrorReport | null } = { report: null };

  static getDerivedStateFromError(error: unknown): { report: WebviewErrorReport } {
    return { report: errorReport('render', error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const report = errorReport('render', error, info.componentStack);
    this.setState({ report });
    post('webview.error', { ...report });
  }

  /** The host re-renders the document (a fresh nonce), so the panel boots from scratch. */
  readonly reload = (): void => post('webview.reload');

  /** Through the host: a webview's own clipboard access is not reliable. */
  readonly copy = (): void => {
    if (this.state.report) post('webview.copy', { text: errorDetails(this.state.report) });
  };

  render(): ReactNode {
    const { report } = this.state;
    if (!report) return this.props.children;
    return <RootFallback strings={readBootStrings()} message={report.message} onReload={this.reload} onCopy={this.copy} />;
  }
}
