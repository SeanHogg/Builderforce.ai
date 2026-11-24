import { memo } from 'react';
import { ToolRow } from './StepRows';
import { toolGroupSummary, type ToolGroup } from './toolGroups';
import type { BrainTimelineLabels } from './labels';

/** Native disclosures keep keyboard support and the reader's expansion while calls append. */
export const ToolGroupRow = memo(function ToolGroupRow({ group, labels }: { group: ToolGroup; labels: BrainTimelineLabels }) {
  const summary = toolGroupSummary(group.tools, labels);
  const failures = group.tools.filter((tool) => tool.isError).length;
  return (
    <li className="bf-tl__item bf-tl__item--tool-group">
      <span className="bf-tl__gutter">
        <span className="bf-tl__dot bf-tl__dot--muted" aria-hidden>
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor">
            <rect x="2" y="2" width="4" height="4" rx="1" />
            <rect x="10" y="2" width="4" height="4" rx="1" />
            <rect x="2" y="10" width="4" height="4" rx="1" />
            <rect x="10" y="10" width="4" height="4" rx="1" />
          </svg>
        </span>
      </span>
      <div className="bf-tl__body">
        <details className="bf-tl__tool-group">
          <summary className="bf-tl__tool-group-head">
            <span className="bf-tl__tool-group-label" title={summary}>{summary}</span>
            {failures > 0 && <span className="bf-tl__tool-group-failed">{labels.toolGroupFailed.replace('{count}', String(failures))}</span>}
            <span className="bf-tl__tool-group-caret" aria-hidden>▸</span>
          </summary>
          <ol className="bf-tl bf-tl__tool-group-list">
            {group.tools.map((node) => <ToolRow key={node.key} node={node} labels={labels} />)}
          </ol>
        </details>
      </div>
    </li>
  );
});
