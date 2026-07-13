import { Job, CreateJobInput, UpdateJobInput } from '@/types/jobs';

let jobs: Job[] = [
  {
    id: 'job-1',
    title: 'Senior Frontend Developer',
    department: 'Engineering',
    location: 'Remote',
    employmentType: 'Full-time',
    salary: '$120,000 - $150,000',
    description: 'We are looking for a Senior Frontend Developer to join our team...',
    requirements: ['5+ years of React experience', 'Next.js expertise', 'TypeScript experience'],
    weOffer: ['Competitive salary', 'Remote-first', 'Professional development'],
    status: 'published',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export async function getJobs(): Promise<Job[]> {
  return jobs;
}

export async function getJob(id: string): Promise<Job | null> {
  return jobs.find(job => job.id === id) || null;
}

export async function createJob(input: CreateJobInput): Promise<Job> {
  const job: Job = {
    id: `job-${Date.now()}`,
    ...input,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  jobs.push(job);
  return job;
}

export async function updateJob(id: string, input: UpdateJobInput): Promise<Job | null> {
  const index = jobs.findIndex(job => job.id === id);
  if (index === -1) return null;

  jobs[index] = {
    ...jobs[index],
    ...input,
    updatedAt: new Date().toISOString(),
  };
  return jobs[index];
}

export async function deleteJob(id: string): Promise<boolean> {
  const index = jobs.findIndex(job => job.id === id);
  if (index === -1) return false;

  jobs.splice(index, 1);
  return true;
}