'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Job {
  id: string;
  title: string;
  department: string;
  location: string;
  employmentType: string;
  salary?: string;
  description: string;
  status: 'draft' | 'published' | 'closed';
}

export default function JobsPage() {
  const t = useTranslations('jobs');
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<Job[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'published' | 'closed'>('all');
  const [sortBy, setSortBy] = useState<'latest' | 'most_recent'>('latest');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load jobs from API (placeholder for now)
    fetchJobs();
  }, []);

  useEffect(() => {
    filterAndSortJobs();
  }, [jobs, filterStatus, sortBy]);

  const fetchJobs = async () => {
    try {
      const response = await fetch('/api/jobs');
      if (response.ok) {
        const data = await response.json();
        setJobs(data);
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterAndSortJobs = () => {
    let filtered = jobs;
    
    // Apply status filter
    if (filterStatus !== 'all') {
      filtered = jobs.filter(job => job.status === filterStatus);
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'latest') {
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      } else if (sortBy === 'most_recent') {
        return new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime();
      }
      return 0;
    });

    setFilteredJobs(sorted);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              {t('nav.jobs')}
            </h1>
            <div className="flex gap-4">
              <Link
                href="/jobs/create"
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
              >
                {t('nav.post_job')}
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <div className="flex flex-wrap gap-4 items-center">
            <div>
              <label htmlFor="status-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('filter_by_status')}
              </label>
              <select
                id="status-filter"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              >
                <option value="all">{t('statuses.all')}</option>
                <option value="draft">{t('statuses.draft')}</option>
                <option value="published">{t('statuses.published')}</option>
                <option value="closed">{t('statuses.closed')}</option>
              </select>
            </div>
            <div>
              <label htmlFor="sort-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('sort_by')}
              </label>
              <select
                id="sort-filter"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              >
                <option value="latest">{t('latest')}</option>
                <option value="most_recent">{t('most_recent')}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Jobs Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="spinner mx-auto mb-4"></div>
            <p className="text-gray-500 dark:text-gray-400">{t('loading')}</p>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-4">{t('noResults')}</p>
            {filterStatus !== 'all' && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No published jobs match the selected filter.
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {filteredJobs.map((job) => (
              <div key={job.id} className="bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-lg transition-shadow p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
                      {job.title}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {job.department}
                    </p>
                  </div>
                  <span className={`badge ${job.status === 'published' ? 'badge-success' : job.status === 'draft' ? 'badge-warning' : 'badge-danger'}`}>
                    {t(`statuses.${job.status}`)}
                  </span>
                </div>
                <div className="space-y-2 text-gray-600 dark:text-gray-300 text-sm mb-4">
                  <p>{job.location}</p>
                  {job.salary && <p className="font-medium">{job.salary}</p>}
                  <p className="line-clamp-3">{job.description}</p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/jobs/${job.id}`}
                    className="flex-1 text-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium text-sm"
                  >
                    {t('details')}
                  </Link>
                  {job.status === 'published' && (
                    <Link
                      href={`/jobs/${job.id}/apply`}
                      className="flex-1 text-center px-4 py-2 border border-primary-600 text-primary-600 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors font-medium text-sm"
                    >
                      {t('nav.apply')}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}