import { segmentTrackerClient } from '@/lib/builderforceApi';

// ── Discovery (customer interviews / research notes; /api/discovery/*) ───────
// The two artifacts of Read/Prove, before there is a company to run.
export interface CustomerInterview {
  id: string; title: string; participantName: string | null; notes: string | null;
  projectId: number | null; createdBy: string | null; createdAt: string; updatedAt: string;
}
export interface ResearchNote {
  id: string; title: string; sourceUrl: string | null; body: string | null;
  projectId: number | null; createdBy: string | null; createdAt: string; updatedAt: string;
}

const customerInterviewTracker = segmentTrackerClient('/api/discovery/interviews');
const researchNoteTracker = segmentTrackerClient('/api/discovery/research-notes');

export const discoveryApi = {
  interviews: {
    list: (projectId?: number) => customerInterviewTracker.list(projectId) as unknown as Promise<CustomerInterview[]>,
    create: (body: Partial<Omit<CustomerInterview, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>>) =>
      customerInterviewTracker.create(body) as unknown as Promise<CustomerInterview>,
    update: (id: string, body: Partial<Omit<CustomerInterview, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>>) =>
      customerInterviewTracker.update(id, body) as unknown as Promise<CustomerInterview>,
    remove: (id: string) => customerInterviewTracker.remove(id),
  },
  researchNotes: {
    list: (projectId?: number) => researchNoteTracker.list(projectId) as unknown as Promise<ResearchNote[]>,
    create: (body: Partial<Omit<ResearchNote, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>>) =>
      researchNoteTracker.create(body) as unknown as Promise<ResearchNote>,
    update: (id: string, body: Partial<Omit<ResearchNote, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>>) =>
      researchNoteTracker.update(id, body) as unknown as Promise<ResearchNote>,
    remove: (id: string) => researchNoteTracker.remove(id),
  },
};
