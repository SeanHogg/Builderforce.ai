'use client';

import { useEffect, useState } from 'react';

export default function PrivateDashboard() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('[PrivateDashboard] mounted');

    // Simulate an async initialization (auth check + app init)
    setTimeout(() => {
      setLoading(false);
      console.log('[PrivateDashboard] ready');
    }, 1_000);
  }, []);

  return (
    <section>
      <style>{`
        /* (Currently internal tooling) */
      `}</style>
      {loading && (
        <div>
          <p>Loading tenant private dashboard...</p>
        </div>
      )}
    </section>
  );
}

// Export the welcome tooltip hook for the welcome modal
export const useWelcomeTooltip = () => {
  const [visible, setVisible] = useState(false);
  const mount = (onClose?: () => void) => {
    console.log('[useWelcomeTooltip] mount');
    setVisible(true);
  };
  const dispose = () => {
    console.log('[useWelcomeTooltip] dispose');
    setVisible(false);
  };
  return { visible, mount, dispose };
};