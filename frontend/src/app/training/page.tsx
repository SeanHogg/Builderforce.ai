'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /training is a convenience redirect — training happens inside the IDE
 * embedded in a project workspace. Send the user to their projects list
 * so they can open a project and use the 🧠 Train panel in the IDE sidebar.
 */
export default function TrainingRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/projects');
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4 animate-pulse">🧠</div>
        <p className="text-gray-400">Redirecting to your projects…</p>
        <p className="text-gray-600 text-sm mt-2">
          AI Model Training is available inside each project workspace.
        </p>
      </div>
    </div>
  );
}
