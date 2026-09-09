import React, { useState } from 'react';
import { CopyButton, type CopyLabels } from './CopyButton';
import { formatDuration } from './timelineModel';
import { toolStepView, type CommandRun, type ToolPreview } from './toolStepView';

/**
 * ONE settled tool step in the transcript: what the agent ran, and what came back.
 *
 * Split out of `BrainTimeline.tsx` because it is its own thing with its own reason to
 * change — how a call is DISPLAYED — while the timeline's reason to change is how a
 * conversation is ORDERED. Every surface that mounts the transcript gets this
 * component, so a shell step reads the same in the web Brain panel, on the Canvas
 * dock and in the VS Code editor.
 *
 * The header is the row you skim: outcome, tool, and the concrete subject — the file,
 * the query, the command line — so a run's steps can be read without opening any of
 * them. A shell step then opens by default onto its terminal exchange, because "did
 * it actually run the tests, and what did they say" is the question a transcript
 * exists to answer, and a caret is a poor place to keep the answer.
 */
export interface ToolStepLabels extends CopyLabels {
  /** Heading for the raw argument panel. */
  input: string;
  /** Heading for the result panel — and for a shell step's terminal output. */
  output: string;
  /** Heading for the change preview shown on an edit_file / write_file step. */
  preview: string;
  /** Shown in place of terminal output when a command printed nothing. */
  noOutput: string;
  /** Non-zero exit chip — must contain the literal `{code}` token. */
  exitCode: string;
}

/** The shape this component needs from a timeline tool node. */
export interface ToolStepNode {
  label: string;
  args: unknown;
  result: unknown;
  isError: boolean;
  durationMs?: number;
}

function IoPanel({
  heading,
  text,
  labels,
  extra,
  className,
}: {
  heading: string;
  text: string;
  labels: CopyLabels;
  extra?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="bf-tl__io">
      <div className="bf-tl__io-label">
        <span>{heading}{extra}</span>
        <CopyButton text={text} labels={labels} />
      </div>
      <pre className={className ? `bf-tl__io-pre ${className}` : 'bf-tl__io-pre'}>
        <code>{text}</code>
      </pre>
    </div>
  );
}

function DiffLines({ text, sign }: { text: string; sign: '+' | '-' }) {
  const cls = sign === '+' ? 'bf-tl__diff-add' : 'bf-tl__diff-del';
  return (
    <>
      {text.split('\n').map((line, i) => (
        <div key={i} className={`bf-tl__diff-line ${cls}`}>
          <span className="bf-tl__diff-sign" aria-hidden>{sign}</span>
          <span className="bf-tl__diff-text">{line || ' '}</span>
        </div>
      ))}
    </>
  );
}

function ChangePreview({ preview, labels }: { preview: ToolPreview; labels: ToolStepLabels }) {
  const text = preview.kind === 'edit' ? preview.newText : preview.content;
  if (preview.kind === 'write') {
    return <IoPanel heading={`${labels.preview}${preview.path ? ` · ${preview.path}` : ''}`} text={text} labels={labels} />;
  }
  return (
    <div className="bf-tl__io">
      <div className="bf-tl__io-label">
        <span>{labels.preview}{preview.path ? ` · ${preview.path}` : ''}</span>
        <CopyButton text={text} labels={labels} />
      </div>
      <div className="bf-tl__diff">
        <DiffLines text={preview.oldText} sign="-" />
        <DiffLines text={preview.newText} sign="+" />
      </div>
    </div>
  );
}

/**
 * A shell step as a terminal exchange: the command on a prompt line, then what it
 * printed. The exit code is shown only when it is non-zero — a `0` on every
 * successful step is noise, a `1` is the whole story.
 */
function CommandCard({ run, labels }: { run: CommandRun; labels: ToolStepLabels }) {
  const failed = run.exitCode != null && run.exitCode !== 0;
  return (
    <>
      <div className="bf-tl__io">
        <div className="bf-tl__io-label">
          <span>{labels.input}</span>
          <CopyButton text={run.command} labels={labels} />
        </div>
        <pre className="bf-tl__io-pre bf-tl__cmd-in">
          <code>
            <span className="bf-tl__cmd-prompt" aria-hidden>$</span>
            {run.command}
          </code>
        </pre>
      </div>
      <div className="bf-tl__io">
        <div className="bf-tl__io-label">
          <span>
            {labels.output}
            {failed && (
              <em className="bf-tl__cmd-exit">{labels.exitCode.replace('{code}', String(run.exitCode))}</em>
            )}
          </span>
          {run.output && <CopyButton text={run.output} labels={labels} />}
        </div>
        {run.output
          ? (
            <pre className={`bf-tl__io-pre bf-tl__cmd-out${run.ok ? '' : ' bf-tl__cmd-out--error'}`}>
              <code>{run.output}</code>
            </pre>
          )
          : <p className="bf-tl__cmd-empty">{labels.noOutput}</p>}
      </div>
    </>
  );
}

export function ToolStep({ node, labels }: { node: ToolStepNode; labels: ToolStepLabels }) {
  const view = toolStepView(node);
  // `open` is held here rather than left to the DOM so the default can depend on the
  // step (a command opens, a lookup stays folded) while the reader still owns it after
  // the first click.
  const [open, setOpen] = useState(view.defaultOpen);
  return (
    <details
      className={`bf-tl__tool${node.isError ? ' bf-tl__tool--error' : ''}`}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="bf-tl__tool-head">
        <span className="bf-tl__tool-status" aria-hidden>
          {node.isError ? '✗' : '✓'}
        </span>
        <span className="bf-tl__tool-name">{node.label}</span>
        {view.subject && <span className="bf-tl__tool-subject">{view.subject}</span>}
        {node.durationMs != null && <span className="bf-tl__tool-dur">{formatDuration(node.durationMs)}</span>}
        <span className="bf-tl__tool-caret" aria-hidden>
          ▸
        </span>
      </summary>
      <div className="bf-tl__tool-body">
        {view.command && <CommandCard run={view.command} labels={labels} />}
        {view.preview && <ChangePreview preview={view.preview} labels={labels} />}
        {view.argsText && <IoPanel heading={labels.input} text={view.argsText} labels={labels} />}
        {view.resultText && <IoPanel heading={labels.output} text={view.resultText} labels={labels} />}
      </div>
    </details>
  );
}
