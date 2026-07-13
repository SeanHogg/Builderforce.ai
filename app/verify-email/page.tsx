'use client';

import { useTranslations } from 'next-intl';

export default function VerifyEmailPage() {
  const t = useTranslations('auth');

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-md text-center">
        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-blue-600 dark:text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
          {t('verify_email')}
        </h2>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          {t('verification_sent')}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          If you don't see the email within a few minutes, please{' '}
          <a href="/resend-verification" className="text-primary-600 dark:text-primary-400 hover:underline font-medium">
            resend the verification email
          </a>
        </p>
        <button
          onClick={() => window.location.href = '/login'}
          className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
        >
          Go to Login
        </button>
      </div>
    </div>
  );
}