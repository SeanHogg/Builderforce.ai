import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { splitThinkSegments } from './thinkBlocks';

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
function MarkdownInner({ content, onInternalLink, onApplyCode, onCreateFile, labels }: MarkdownProps) {
  const lab = useMemo(() => ({ ...DEFAULT_LABELS, ...labels }), [labels]);
  const segments = useMemo(() => splitThinkSegments(content), [content]);
  const components = {
    a({ href, children, ...rest }: React.ComponentProps<'a'>) {
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
    code(props: React.ComponentProps<'code'>) {
      const { className, children } = props;
      const raw = String(children ?? '');
      const text = raw.replace(/\n$/, '');
      // react-markdown gives language fences a className and every fenced block
      // (including an unlabeled one-line fence) a trailing newline.
      const isBlock = className != null || raw.endsWith('\n');
      if (!isBlock) return <code className="bf-md__inline">{children}</code>;
      return <CodeBlock code={text} onApplyCode={onApplyCode} onCreateFile={onCreateFile} labels={lab} />;
    },
    pre({ children }: React.ComponentProps<'pre'>) {
      // CodeBlock already emits its own <pre>; passthrough avoids double-wrapping.
      return <>{children}</>;
    },
  };
  return (
    <div className="bf-md">
      {segments.map((segment, index) => segment.kind === 'thought' ? (
        <details className="bf-md__think" key={`${segment.kind}-${index}`}>
          <summary>Thought</summary>
          <div className="bf-md__think-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{segment.content}</ReactMarkdown>
          </div>
        </details>
      ) : (
        <ReactMarkdown key={`${segment.kind}-${index}`} remarkPlugins={[remarkGfm]} components={components}>
          {segment.content}
        </ReactMarkdown>
      ))}
    </div>
  );
}

/**
 * Memoized: parsing markdown through the remark pipeline is expensive, and the
 * transcript re-renders on every streaming token / composer keystroke. Skipping the
 * re-parse of settled messages (unchanged `content`/callbacks) keeps typing snappy.
 */
export const Markdown = React.memo(MarkdownInner);
