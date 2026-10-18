import { discoveryApi, type ResearchNote } from '@/lib/builderforceApi';
import { KnowledgeListTab, type KnowledgeListVariant } from './KnowledgeListTab';

const VARIANT: KnowledgeListVariant<ResearchNote> = {
  i18nKey: 'research',
  api: {
    list: () => discoveryApi.researchNotes.list(),
    create: ({ title, meta, body }) => discoveryApi.researchNotes.create({ title, sourceUrl: meta, body }),
    remove: (id) => discoveryApi.researchNotes.remove(id),
  },
  metaPlaceholder: 'sourceUrlPlaceholder',
  bodyPlaceholder: 'bodyPlaceholder',
  rowBody: (row) => row.body,
  rowBadge: (row, t, badge) =>
    row.sourceUrl ? (
      <a className={badge} href={row.sourceUrl} target="_blank" rel="noreferrer noopener">
        {t('research.sourceLink')}
      </a>
    ) : null,
};

/**
 * Research notes — a competitor teardown, a market stat, a source worth
 * citing toward answering the idea's own question.
 */
export function ResearchTab() {
  return <KnowledgeListTab variant={VARIANT} />;
}
