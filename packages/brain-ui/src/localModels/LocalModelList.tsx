/**
 * The page engines' downloadable catalog as a list — presentational over the
 * {@link useLocalModels} state a container hands it (the `/` menu's Model tab, Rovr's
 * side panel). Selecting a ready row reports its `local/<runtime>/<model>` ref; the
 * container routes it through the SAME selection path a cloud model takes.
 *
 * The layout is `localPickerView`'s (local-inference): curated rows under a heading per
 * use, every other model behind "All models" — rows this device cannot run there too,
 * each saying why — a model the person holds always listed (even unfit: it says why and
 * can be removed), and when NOTHING runs here, one line saying why.
 */
import { useMemo, useState } from 'react';
import { localPickerView, type LocalModelRow as LocalModelRowData } from '@seanhogg/builderforce-brain-embedded';
import { fill } from '../spend/format';
import { LOCAL_PICKER_GROUP_LABEL, type LocalModelLabels } from './labels';
import { unsupportedReason } from './localModelView';
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

/** A row the person already has never hides behind "All models" — nor when unfit. */
const isHeld = (row: LocalModelRowData, activeRef?: string): boolean =>
  row.state === 'ready' || row.state === 'downloading' || row.downloaded === true || row.ref === activeRef;

export function LocalModelList({ state, labels, activeRef, locale, hideHeading, onSelect }: LocalModelListProps) {
  const { rows } = state;
  const [showAll, setShowAll] = useState(false);
  const view = useMemo(
    () =>
      localPickerView(rows ?? [], {
        fits: (row) => row.state !== 'unsupported',
        pinned: (row) => isHeld(row, activeRef),
      }),
    [rows, activeRef],
  );
  if (!rows || rows.length === 0) return null;

  const renderRows = (list: readonly LocalModelRowData[]) => (
    <ul className="bf-lmodels__list">
      {list.map((row) => (
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
  );

  const nothingRuns = view.groups.length === 0 && view.more.length === 0;
  const firstHidden = view.hidden[0];

  return (
    <div className="bf-lmodels">
      {!hideHeading && <div className="bf-pmenu__group">{labels.localCatalogHeading}</div>}
      {nothingRuns && firstHidden && <p className="bf-lmodels__notice">{unsupportedReason(firstHidden, labels)}</p>}
      <div className="bf-lmodels__scroll">
        {view.groups.map(({ group, rows: listed }) => (
          <section key={group} className="bf-lmodels__group" aria-label={labels[LOCAL_PICKER_GROUP_LABEL[group]]}>
            <div className="bf-lmodels__heading">{labels[LOCAL_PICKER_GROUP_LABEL[group]]}</div>
            {renderRows(listed)}
          </section>
        ))}
        {view.more.length + view.hidden.length > 0 && (
          <>
            <button
              type="button"
              className="bf-lmodels__toggle"
              aria-expanded={showAll}
              onClick={() => setShowAll((open) => !open)}
            >
              {showAll ? labels.localFewerModels : fill(labels.localAllModels, { count: view.more.length + view.hidden.length })}
            </button>
            {showAll && renderRows([...view.more, ...view.hidden])}
          </>
        )}
      </div>
    </div>
  );
}
