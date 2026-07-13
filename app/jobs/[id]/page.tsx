'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

interface Job {
  id: string;
  title: string;
  department: string;
  location: string;
  employmentType: string;
  salary?: string;
  description: string;
  requirements: string[];
  weOffer: string[];
  status: 'draft' | 'published' | 'closed';
  createdAt: string;
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('jobs');
  const [status, setStatus] = useState<'draft' | 'published' | 'closed'>('published');

  // Placeholder job data - would come from API in production
  const job: Job = {
    id: params.id as string,
    title: 'Senior Frontend Developer',
    department: t('jobs.department'),
    location: 'Remote',
    employmentType: t('jobs.employment_type'),
    salary: '$120,000 - $150,000',
    description: 'We are looking for a Senior Frontend Developer to join our team...',
    requirements: [
      '5+ years of React experience',
      'Next.js expertise',
      'TypeScript experience',
      'Strong CSS/JavaScript skills',
    ],
    weOffer: [
      'Competitive salary and benefits',
      'Remote-first work environment',
      'Professional development opportunities',
      'Modern stack and tooling',
    ],
    status,
    createdAt: new Date().toISOString(),
  };

  useEffect(() => {
    setStatus(job.status);
  }, [job.status]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.back()}
              className="flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              {t('nav.back')}
            </button>
            {job.status === 'published' && (
              <Link
                href={`/jobs/${job.id}/apply`}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
              >
                {t('nav.apply')}
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid gap-8 grid-cols-1 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
              <div className="mb-6">
                <span className={`badge ${job.status === 'published' ? 'badge-success' : job.status === 'draft' ? 'badge-warning' : 'badge-danger'}`}>
                  {t(`statuses.${job.status}`)}
                </span>
              </div>

              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                {job.title}
              </h1>
              <p className="text-gray-600 dark:text-gray-300 mb-4">
                {job.department}
              </p>
              <p className="text-gray-600 dark:text-gray-300">
                <strong>Location:</strong> {job.location}
              </p>
              <p className="text-gray-600 dark:text-gray-300">
                <strong>Employment Type:</strong> {job.employmentType}
              </p>
              {job.salary && (
                <p className="text-gray-600 dark:text-gray-300">
                  <strong>Salary:</strong> {job.salary}
                </p>
              )}
            </div>

            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">
                {t('jobs.description')}
              </h2>
              <p className="text-gray-600 dark:text-gray-300 mb-6">
                {job.description}
              </p>

              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                {t('jobs.requirements')}
              </h3>
              <ul className="space-y-2 mb-8">
                {job.requirements.map((req, index) => (
                  <li key={index} className="text-gray-600 dark:text-gray-300 flex items-start">
                    <svg className="w-5 h-5 mr-2 text-green-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {req}
                  </li>
                ))}
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                {t('jobs.we_offer')}
              </h3>
              <ul className="space-y-2">
                {job.weOffer.map((offer, index) => (
                  <li key={index} className="text-gray-600 dark:text-gray-300 flex items-start">
                    <svg className="w-5 h-5 mr-2 text-green-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {offer}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                About this job
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Posted {new Date(job.createdAt).toLocaleDateString()}
              </p>
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Department</span>
                  <span className="text-gray-900 dark:text-white font-medium">{job.department}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Location</span>
                  <span className="text-gray-900 dark:text-white font-medium">{job.location}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Type</span>
                  <span className="text-gray-900 dark:text-white font-medium">{job.employmentType}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}