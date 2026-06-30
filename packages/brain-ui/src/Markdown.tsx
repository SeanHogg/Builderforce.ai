import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface MarkdownLabels {
  copy: string;
  copied: string;
  apply: string;
  createFile: string;
}

export interface MarkdownProps {
  content: string;
  /** Route an in-app link (e.g. `/tasks/12`) through the host's router. */
  onInternalLink?: (href: string) => void;
  /** When set, code blocks show an "Apply" button handing back the code. */
  onApplyCode?: (code: string) => void;
  /** When set, code blocks show a "Create file" button (path heuristically parsed). */
  onCreateFile?: (path: string, content: string) => void;
  labels?: Partial<MarkdownLabels>;
}

const DEFAULT_LABELS: MarkdownLabels = { copy: 'Copy', copied: 'Copied', apply: 'Apply', createFile: 'Create file' };

/** A leading `// path: x` / `# path: x` / `<!-- path: x -->` comment, if present. */
function detectPath(code: string): string {
  const first = code.split('\n', 1)[0] ?? '';
  const m = first.match(/(?:\/\/|#|<!--)\s*(?:path|file):\s*([^\s>]+)/i);
  return m ? m[1].trim() : '';
}

function isExternal(href: string): boolean {
  return /^(https?:)?\/\//i.test(href) || href.startsWith('mailto:');
}

function CodeBlock({
  code,
  onApplyCode,
  onCreateFile,
  labels,
}: {
  code: string;
  onApplyCode?: (code: string) => void;
  onCreateFile?: (path: string, content: string) => void;
  labels: MarkdownLabels;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <div className="bf-md__code">
      <div className="bf-md__code-actions">
        <button type="button" className="bf-md__code-btn" onClick={copy}>
          {copied ? labels.copied : labels.copy}
        </button>
        {onApplyCode && (
          <button type="button" className="bf-md__code-btn" onClick={() => onApplyCode(code)}>
            {labels.apply}
          </button>
        )}
        {onCreateFile && (
          <button type="button" className="bf-md__code-btn" onClick={() => onCreateFile(detectPath(code), code)}>
            {labels.createFile}
          </button>
        )}
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * XSS-safe markdown (react-markdown does not render raw HTML by default) with
 * custom code blocks (copy / apply / create) and router-aware internal links.
 * Self-contained so both the web app and the VS Code webview render assistant
 * replies identically.
 */
export function Markdown({ content, onInternalLink, onApplyCode, onCreateFile, labels }: MarkdownProps) {
  const lab = { ...DEFAULT_LABELS, ...labels };
  return (
    <div className="bf-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children, ...rest }) {
            const target = href ?? '';
            if (target && !isExternal(target) && onInternalLink) {
              return (
                <a
                  href={target}
                  onClick={(e) => {
                    e.preventDefault();
                    onInternalLink(target);
                  }}
                  {...rest}
                >
                  {children}
                </a>
              );
            }
            return (
              <a href={target} target="_blank" rel="noopener noreferrer" {...rest}>
                {children}
              </a>
            );
          },
          code(props) {
            const { inline, className, children } = props as {
              inline?: boolean;
              className?: string;
              children?: React.ReactNode;
            };
            const text = String(children ?? '').replace(/\n$/, '');
            if (inline || (!className && !text.includes('\n'))) {
              return <code className="bf-md__inline">{children}</code>;
            }
            return <CodeBlock code={text} onApplyCode={onApplyCode} onCreateFile={onCreateFile} labels={lab} />;
          },
          pre({ children }) {
            // CodeBlock already emits its own <pre>; passthrough avoids double-wrapping.
            return <>{children}</>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
