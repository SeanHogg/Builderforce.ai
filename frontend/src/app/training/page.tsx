import React from 'react';

export const runtime = 'edge';

"use client";
// basic AI Model Training Panel UI
import { useEffect, useState } from 'react';

interface TrainingJob {
  id: string;
  project_id: string;
  base_model: string;
  status: string;
  created_at: string;
}

export default function TrainingPage() {
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [newJobModel, setNewJobModel] = useState('');

  useEffect(() => {
    fetchJobs();
  }, []);

  async function fetchJobs() {
    const res = await fetch('/api/training?projectId=demo');
    if (res.ok) setJobs(await res.json());
  }

  async function createJob() {
    if (!newJobModel) return;
    await fetch('/api/training', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'demo',
        baseModel: newJobModel,
      }),
    });
    setNewJobModel('');
    fetchJobs();
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">AI Model Training</h1>
      <div className="mb-6">
        <input
          className="border p-2 mr-2"
          value={newJobModel}
          onChange={(e) => setNewJobModel(e.target.value)}
          placeholder="Base model name"
        />
        <button
          className="bg-coral-bright text-white px-4 py-2 rounded"
          onClick={createJob}
        >
          Start Training
        </button>
      </div>
      <h2 className="text-xl font-semibold mb-2">Recent Jobs</h2>
      <ul className="list-disc pl-6">
        {jobs.map((j) => (
          <li key={j.id}>{j.base_model} – {j.status}</li>
        ))}
        {jobs.length === 0 && <li className="text-gray-500">No jobs yet</li>}
      </ul>
    </div>
  );
}
