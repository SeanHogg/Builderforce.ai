import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { CREATION_TEMPLATES, type CreationTemplate } from '@/lib/templates/creationTemplates';
import { applyTemplateEntry } from '@/lib/templates/apply';
import { useTemplateCatalog } from '@/lib/templates/useTemplateCatalog';
import { matchesTemplateQuery } from '@/lib/templates/contract';
import type { CreationTemplate as ServerCreationTemplate } from '@/lib/builderforceApi';
import type { CreationObjectKind } from '../types';
import type { FramePreset } from '../canvasBoardTypes';
import styles from '../CreationCanvas.module.css';

/** The category filter is over template SOURCES rather than the packs' own two-value
 *  `category` field, because the browser renders every source. */
type TemplateCategoryFilter = 'all' | 'pack' | 'workspace' | 'prompt';

/** Every object kind any shipped pack contains — a fact about the registry, so it is
 *  computed once per module rather than once per render of the open browser. */
const PACK_OBJECT_KINDS = [...new Set(CREATION_TEMPLATES.flatMap((template) => template.objects.map((object) => object.kind)))].sort();

/**
 * The browser's search and filters, and the catalogue it reads — held by the HOST so
 * closing and reopening the browser keeps what was typed, exactly as it did when these
 * were four `useState`s in `CanvasInner`.
 */
export function useCanvasTemplateBrowser(open: boolean) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<CreationObjectKind | 'all'>('all');
  const [category, setCategory] = useState<TemplateCategoryFilter>('all');
  // The one catalogue, shared with the prompt picker. Installable templates are
  // fetched only while the browser is open — a guest canvas never opens it.
  const entries = useTemplateCatalog({ includeWorkspace: open });
  return useMemo(() => ({ search, setSearch, kind, setKind, category, setCategory, entries }), [category, entries, kind, search]);
}

export interface CanvasTemplateMenuProps {
  open: boolean;
  onClose: () => void;
  browser: ReturnType<typeof useCanvasTemplateBrowser>;
  /** Seed the composer with a prompt entry. */
  onPrompt: (prompt: string) => void;
  onPack: (template: CreationTemplate) => void;
  serverTemplates: readonly ServerCreationTemplate[];
  onServerTemplate: (template: ServerCreationTemplate) => void;
  framePresets: readonly FramePreset[];
  onFramePreset: (preset: FramePreset) => void;
}

export function CanvasTemplateMenu({ open, onClose, browser, onPrompt, onPack, serverTemplates, onServerTemplate, framePresets, onFramePreset }: CanvasTemplateMenuProps) {
  const t = useTranslations('creationCanvas');
  const router = useRouter();
  if (!open) return null;
  const { search, setSearch, kind, setKind, category, setCategory, entries } = browser;
  return <div className={styles.templateMenu}>
            <header><div><strong>{t('canvasTemplates')}</strong><small>{t('marketplacePacks')}</small></div><button onClick={onClose} aria-label={t('closeTemplates')}>×</button></header>
            <div className={styles.templateFilters}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchTemplates')} aria-label={t('searchTemplates')} /><select value={category} onChange={(event) => setCategory(event.target.value as TemplateCategoryFilter)} aria-label={t('filterTemplateCategory')}><option value="all">{t('allCategories')}</option><option value="pack">{t('templateCategoryObjectPack')}</option><option value="workspace">{t('templateCategoryAutomation')}</option><option value="prompt">{t('templateCategoryPrompt')}</option></select><select value={kind} onChange={(event) => setKind(event.target.value as CreationObjectKind | 'all')} aria-label={t('filterTemplateKind')}><option value="all">{t('allMediaKinds')}</option>{PACK_OBJECT_KINDS.map((objectKind) => <option key={objectKind} value={objectKind}>{t(`object.${objectKind}`)}</option>)}</select></div>
            {/* ONE catalogue. This browser used to iterate `CREATION_TEMPLATES`
                with its own search and its own category names, while the prompt
                picker below iterated a different list entirely — so a person
                could not find an installable automation from here at all. Both
                now render `useTemplateCatalog` and dispatch through
                `applyTemplateEntry`. The object-kind filter still applies only
                to packs, because only a pack HAS object kinds. */}
            {entries
              .filter((entry) => category === 'all'
                || (category === 'pack' && entry.source === 'pack')
                || (category === 'workspace' && entry.source === 'workspace')
                || (category === 'prompt' && (entry.source === 'canvas' || entry.source === 'executive')))
              .filter((entry) => kind === 'all' || (entry.action.kind === 'pack' && entry.action.template.objects.some((object) => object.kind === kind)))
              .filter((entry) => matchesTemplateQuery(entry, search))
              .map((entry) => <button key={entry.id} onClick={() => { applyTemplateEntry(entry, { onPrompt: (nextPrompt) => { onPrompt(nextPrompt); onClose(); }, onPack: (template) => onPack(template), onInstall: (key) => router.push(`/templates?open=${encodeURIComponent(key)}`) }); }}><b>{entry.name}</b><small>{entry.action.kind === 'pack' ? t('templateMeta', { category: entry.categoryLabel, count: entry.action.template.objects.length }) : entry.categoryLabel}</small><span>{entry.summary}</span><i>{entry.keywords.slice(0, 6).join(' · ')}</i></button>)}
            {!!serverTemplates.length && <><h4>{t('savedAccount')}</h4>{serverTemplates.map((template) => <button key={template.id} onClick={() => onServerTemplate(template)}><b>{template.name}</b><small>{template.visibility === 'tenant' ? t('sharedWithTenant') : t('private')} · {template.category}</small><span>{template.description}</span></button>)}</>}
            {!!framePresets.length && <><h4>{t('reusableFrames')}</h4>{framePresets.map((preset) => <button key={preset.id} onClick={() => onFramePreset(preset)}><b>{preset.name}</b><small><span>{t('privateCustomFrame')}</span> · {t('thisDevice')}</small></button>)}</>}
          </div>;
}
