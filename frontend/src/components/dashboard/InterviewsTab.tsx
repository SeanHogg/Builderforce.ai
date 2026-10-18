import { discoveryApi, type CustomerInterview } from '@/lib/builderforceApi';
import { KnowledgeListTab, type KnowledgeListVariant } from './KnowledgeListTab';

const VARIANT: KnowledgeListVariant<CustomerInterview> = {
  i18nKey: 'interviews',
  api: {
    list: () => discoveryApi.interviews.list(),
    create: ({ title, meta, body }) => discoveryApi.interviews.create({ title, participantName: meta, notes: body }),
    remove: (id) => discoveryApi.interviews.remove(id),
  },
  metaPlaceholder: 'participantPlaceholder',
  bodyPlaceholder: 'notesPlaceholder',
  rowBody: (row) => row.notes,
  rowBadge: (row, _t, badge) => (row.participantName ? <span className={badge}>{row.participantName}</span> : null),
};

/**
 * Customer interviews — a conversation with a real person, captured against
 * the idea it is evidence for.
 */
export function InterviewsTab() {
  return <KnowledgeListTab variant={VARIANT} />;
}
