import { Link } from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-24">
      <div className="text-center space-y-8">
        <h1 className="text-6xl font-bold text-gray-900 dark:text-white">
          Hired.Video
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-300">
          Video-based hiring platform
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href={'/login'}
            className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href={'/register'}
            className="px-6 py-3 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border border-gray-300 dark:border-gray-600"
          >
            Create account
          </Link>
        </div>
      </div>
    </main>
  );
}