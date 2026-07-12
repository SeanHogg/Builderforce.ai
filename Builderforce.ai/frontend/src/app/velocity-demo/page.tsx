'use client';

import { VelocityModule } from '@/components/velocity';

/**
 * Example page demonstrating Velocity Gap feature integration
 *
 * This page shows how to use the VelocityModule in a real application.
 * Replace the projectId with values from your project management system.
 */

export default function VelocityDemoPage() {
  // Replace with actual project ID from your application
  // This is an example using a placeholder ID
  const DEMO_PROJECT_ID = 12345;

  return (
    <div className="velocity-demo-page">
      <header className="demo-header">
        <h1>Velocity Gap Feature Demo</h1>
        <p>
          This page demonstrates the Velocity Gap feature integration. In a
          production application, project IDs and velocity data would be
          dynamically loaded based on the user's context.
        </p>
      </header>

      <main className="demo-main">
        <VelocityModule projectId={DEMO_PROJECT_ID} />
      </main>
    </div>
  );
}

// Example usage in a real application:
/*
// in a project detail page:
import { VelocityModule } from '@/components/velocity';

export default function ProjectVelocityPage({ params }: { params: { id: string } }) {
  const projectId = parseInt(params.id);

  return (
    <div className="project-velocity-section">
      <h2>Project Velocity Analysis</h2>
      <VelocityModule projectId={projectId} />
    </div>
  );
}
*/

// Example with initial data:
/*
export default function VelocityWithInitialStatePage() {
  const [initialData, setInitialData] = useState({
    gapResult: { gap: -5, percentage: 25, isAhead: false, severity: 'high' },
    recommendations: [],
    actions: [],
  });

  useEffect(() => {
    // Load velocity data from API
    fetchVelocityData().then(data => {
      setInitialData(data);
    });
  }, []);

  return <VelocityModule projectId={123} initialContext={initialData} />;
}
*/