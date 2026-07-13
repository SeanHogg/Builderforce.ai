'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

export default function ApplicationSentPage() {
  const params = useParams();
  const t = useTranslations('applications');

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-md text-center">
        <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-green-600 dark:text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
          {t('application_recorded')}
        </h2>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          Your application for job <strong>{params.id}</strong> has been submitted successfully.
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          You will receive email updates about your application status.
        </p>
        <button
          onClick={() => window.location.href = '/jobs'}
          className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
        >
          View Jobs
        </button>
      </div>
    </div>
  );
}