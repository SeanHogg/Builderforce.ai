import ReactMarkdown from 'react-markdown';
import { MARKDOWN_REHYPE_PLUGINS, MARKDOWN_REMARK_PLUGINS } from '@/lib/markdownPipeline';

export interface DocumentMarkdownProps {
  /** Document body (Markdown / GFM). */
  content: string;
  /** Extra class names appended to the `.markdown-body` document wrapper. */
  className?: string;
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
export function DocumentMarkdown({ content, className }: DocumentMarkdownProps) {
  return (
    <div className={className ? `markdown-body ${className}` : 'markdown-body'}>
      <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS}>{content}</ReactMarkdown>
    </div>
  );
}
