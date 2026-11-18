import React from 'react';
import { useTranslations } from 'next-intl';
import type { CollectionDescriptor } from '../collection/descriptor';
import { useLocalSource } from '../collection/sources';
import { useCollectionPaging } from '../collection/useCollectionPaging';
import { useCollectionSort } from '../collection/useCollectionSort';
import { useCollectionPreferences } from '../collection/collectionPreferences';
import { Collection } from '../collection/Collection';
import type { WorkflowDefinitionSummary } from '@/lib/builderforceApi';

export interface WorkflowsContentProps {
  workflows: WorkflowDefinitionSummary[];
}

/** The ONE Card|List collection for workflow definitions (PRD 47 §5 W2). */
export const workflowsDescriptor: CollectionDescriptor<WorkflowDefinitionSummary> = {
  entity: 'workflow',
  surfaceKey: 'workflows.list',
  rowId: (w) => w.id,
  columns: [
    { key: 'name', header: 'Name', cell: (w) => w.name },
    { key: 'description', header: 'Description', cell: (w) => w.description ?? '' },
    { key: 'updatedAt', header: 'Updated', cell: (w) => w.updatedAt, sortKey: 'updatedAt',
      compare: (a, b) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '') },
  ],
  card: (w) => (
    <div>
      <strong>{w.name}</strong>
      <div>{w.description}</div>
    </div>
  ),
  label: (w) => w.name,
  defaultSort: { key: 'updatedAt', dir: 'desc' },
  emptyKey: 'empty',
};

export function WorkflowsContent({ workflows }: WorkflowsContentProps) {
  const prefs = useCollectionPreferences(workflowsDescriptor.surfaceKey, 'table');
  const paging = useCollectionPaging(prefs.pageSize);
  const sort = useCollectionSort(workflowsDescriptor, paging.reset);
  const source = useLocalSource(workflows, workflowsDescriptor, sort, paging);

  return (
    <Collection
      descriptor={workflowsDescriptor}
      source={source}
    />
  );
}
