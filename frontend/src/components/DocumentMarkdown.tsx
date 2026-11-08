import { Children, isValidElement, lazy, Suspense, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { MARKDOWN_REHYPE_PLUGINS, MARKDOWN_REMARK_PLUGINS } from '@/lib/markdownPipeline';

const DRAWING_LANGUAGE = 'language-bf-drawing';

/** The JSON body of a `bf-drawing` fenced block, or `null` for any other `<pre>`. */
function drawingFenceJson(children: ReactNode): string | null {
  const code = Children.toArray(children).find(isValidElement) as { props?: { className?: string; children?: ReactNode } } | undefined;
  if (!code?.props?.className?.split(/\s+/).includes(DRAWING_LANGUAGE)) return null;
  return Children.toArray(code.props.children).map((child) => (typeof child === 'string' ? child : '')).join('').trim();
}

/** Loaded only when a page holds a drawing, so the drawing model stays out of every first paint. */
const ReadOnlyDrawing = lazy(() => import('@/components/drawing/MarkdownDrawing').then((m) => ({ default: m.ReadOnlyDrawing })));

/** Code fences render as `<pre>`, except a `bf-drawing` fence, which renders as the picture. */
const DRAWING_AWARE_COMPONENTS: Components = {
  pre({ children, node: _node, ...rest }: ComponentProps<'pre'> & { node?: unknown }) {
    const json = drawingFenceJson(children);
    return json === null ? <pre {...rest}>{children}</pre> : <Suspense fallback={null}><ReadOnlyDrawing json={json} /></Suspense>;
  },
};

export interface DocumentMarkdownProps {
  /** Document body (Markdown / GFM). */
  content: string;
  /** Extra class names appended to the `.markdown-body` document wrapper. */
  className?: string;
  /** Element overrides (e.g. link hardening for untrusted tenant content). */
  components?: Components;
}

/**
 * Document-scale Markdown renderer.
 *
 * The counterpart to {@link ChatMessageContent}: where that renders short
 * conversational turns at *chat* typography (small text, IDE code-apply buttons),
 * this renders long-form documents — SOPs, knowledge articles, legal terms — at
 * *document* scale. Typography comes entirely from the `.markdown-body` class
 * (theme-token driven, defined once in globals.css) so every long-form surface
 * stays in lockstep. No per-element inline styles, no chat affordances.
 */
export function DocumentMarkdown({ content, className, components }: DocumentMarkdownProps) {
  return (
    <div className={className ? `markdown-body ${className}` : 'markdown-body'}>
      <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS} components={components ? { ...DRAWING_AWARE_COMPONENTS, ...components } : DRAWING_AWARE_COMPONENTS}>{content}</ReactMarkdown>
    </div>
  );
}
