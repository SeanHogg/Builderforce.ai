/**
 * The page engines' downloadable catalog as a list — presentational over the
 * {@link useLocalModels} state a container hands it (the `/` menu's Model tab, Rovr's
 * side panel). Selecting a ready row reports its `local/<runtime>/<model>` ref; the
 * container routes it through the SAME selection path a cloud model takes.
 */
import type { LocalModelLabels } from './labels';
import { LocalModelRow } from './LocalModelRow';
import type { LocalModelsState } from './useLocalModels';

export interface LocalModelListProps {
  state: LocalModelsState;
  labels: LocalModelLabels;
  /** The pinned ref, when it is one of these rows. */
  activeRef?: string;
  locale?: string;
  /** Omit the heading (a host that titles the section itself). */
  hideHeading?: boolean;
  onSelect(ref: string): void;
}

export function LocalModelList({ state, labels, activeRef, locale, hideHeading, onSelect }: LocalModelListProps) {
  const { rows } = state;
  if (!rows || rows.length === 0) return null;
  return (
    <div className="bf-lmodels">
      {!hideHeading && <div className="bf-pmenu__group">{labels.localCatalogHeading}</div>}
      <ul className="bf-lmodels__list">
        {rows.map((row) => (
          <LocalModelRow
            key={row.ref}
            row={row}
            labels={labels}
            active={row.ref === activeRef}
            failed={state.failed.has(row.ref)}
            {...(locale ? { locale } : {})}
            onSelect={onSelect}
            onDownload={state.download}
            onCancel={state.cancel}
            onRemove={state.remove}
          />
        ))}
      </ul>
    </div>
  );
}
