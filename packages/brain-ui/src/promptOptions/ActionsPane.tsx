/**
 * The `/` menu's ACTIONS tab — the composer commands (`/starter-kit`, `/manifest init`,
 * `/help` …) rendered from brain-embedded's `/help` model, never from hand-written copy.
 * Presentational: the host owns the registry and decides what choosing an entry does
 * (run `/<id>` when `runnable`, otherwise put `insertText` in the composer).
 *
 * An entry the host or plan cannot run is shown disabled with its reason — never hidden.
 * The same pane renders a typed `/help` answer, including "no such command".
 */
import type { ComposerHelpModel } from '@seanhogg/builderforce-brain-embedded';
import type { PromptOptionsLabels } from './types';

/** The host's composer commands for the Actions tab. Absent ⇒ no tab. */
export interface PromptOptionsCommands {
  help: ComposerHelpModel;
  /** An available entry was chosen. */
  onChoose: (id: string) => void;
}

export interface ActionsPaneProps {
  commands: PromptOptionsCommands;
  labels: Pick<PromptOptionsLabels, 'actionsEmpty' | 'commandUnavailable' | 'noSuchCommand'>;
  /** Close the menu after a choice. */
  close?: () => void;
}

export function ActionsPane({ commands, labels, close }: ActionsPaneProps) {
  const { entries, unknown } = commands.help;
  return (
    <>
      {unknown !== undefined && (
        <div className="bf-pmenu__info" role="status">{labels.noSuchCommand.replace('{name}', unknown)}</div>
      )}
      {entries.length === 0 && <div className="bf-pmenu__empty">{labels.actionsEmpty}</div>}
      {entries.map((entry) => {
        const unavailable = entry.availability.ok ? undefined : entry.availability.reason;
        return (
          <button
            key={entry.id}
            type="button"
            className="bf-pmenu__item"
            disabled={unavailable !== undefined}
            aria-disabled={unavailable !== undefined}
            title={unavailable ?? entry.example}
            onClick={() => {
              if (unavailable !== undefined) return;
              commands.onChoose(entry.id);
              close?.();
            }}
          >
            <span className="bf-pmenu__ico" aria-hidden="true">/</span>
            <span className="bf-pmenu__lbl">
              <code>{entry.syntax}</code>
              <span className="bf-pmenu__desc">{entry.description}</span>
              <span className="bf-pmenu__desc">{unavailable ?? <code>{entry.example}</code>}</span>
            </span>
            {unavailable !== undefined && <span className="bf-pmenu__hint">{labels.commandUnavailable}</span>}
          </button>
        );
      })}
    </>
  );
}
