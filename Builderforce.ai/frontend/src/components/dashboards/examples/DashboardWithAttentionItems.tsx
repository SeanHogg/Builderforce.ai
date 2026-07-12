'use client';

import { useState } from 'react';
import { Top10AttentionItems } from '../Top10AttentionItems';
import { attentionItems as attentionTranslations } from '../fixtures/attentionItems.en';

/**
 * Dashboard layout example showing Top10AttentionItems integration.
 * This demonstrates how to use the component in a typical dashboard view.
 */
export function DashboardWithAttentionItems({ projectId }: { projectId: number }) {
  const [isAttentionPanelOpen, setIsAttentionPanelOpen] = useState(true);

  return (
    <div className="dashboard-layout">
      <header className="dashboard-header">
        <h1>My Dashboard</h1>
        <p>Welcome back! Here's what we've got for you today.</p>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-grid">
          {/* Left Column: Attention Panel */}
          <section 
            className="dashboard-column"
            style={{ flex: '0 0 320px' }}
          >
            <div className="dashboard-column-header">
              <h2>What needs your attention</h2>
            </div>
            
            <Top10AttentionItems projectId={projectId} />
            
            <div className="dashboard-stat-strip">
              <div className="dashboard-stat">
                <div className="stat-value">5</div>
                <div className="stat-label">Urgent items</div>
              </div>
              <div className="dashboard-stat">
                <div className="stat-value">3</div>
                <div className="stat-label">High priority</div>
              </div>
              <div className="dashboard-stat">
                <div className="stat-value">2</div>
                <div className="stat-label">This week</div>
              </div>
            </div>
          </section>

          {/* Right Column: Main Content */}
          <section className="dashboard-column" style={{ flex: '1' }}>
            <div className="dashboard-section">
              <h2>Overview</h2>
              <p>This is where your main dashboard content would go.</p>
              
              <div className="dashboard-placeholder">
                <h3>📊 Quick Stats</h3>
                <p>Insert your main dashboard widgets here.</p>
              </div>
            </div>
          </section>
        </div>
      </main>

      <style>{DASHBOARD_CSS}</style>
    </div>
  );
}

const DASHBOARD_CSS = `
.dashboard-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding: 20px;
  gap: 20px;
}

.dashboard-header {
  margin: 0;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-subtle);
}

.dashboard-header h1 {
  margin: 0 0 8px 0;
  font-family: var(--font-display, system-ui);
  font-weight: 700;
  font-size: 1.5rem;
}

.dashboard-header p {
  margin: 0;
  color: var(--text-muted);
}

.dashboard-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 20px;
  flex: 0 1 auto;
}

.dashboard-column {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dashboard-column-header h2 {
  margin: 0;
  font-family: var(--font-display, system-ui);
  font-weight: 700;
  font-size: 1.05rem;
}

.dashboard-section {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 20px;
}

.dashboard-section h2 {
  margin: 0 0 12px 0;
  font-family: var(--font-display, system-ui);
  font-weight: 700;
  font-size: 1.1rem;
}

.dashboard-section h3 {
  margin: 0 0 8px 0;
  font-size: 0.9rem;
  font-weight: 600;
}

.dashboard-section p {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.dashboard-placeholder {
  margin-top: 16px;
  padding: 20px;
  background: var(--bg-surface);
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
}

.dashboard-stat-strip {
  display: flex;
  gap: 12px;
}

.dashboard-stat {
  flex: 1;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 12px 16px;
  text-align: center;
}

.dashboard-stat .stat-value {
  display: block;
  font-family: var(--font-display, system-ui);
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.dashboard-stat .stat-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

@media (max-width: 768px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-column,
  .dashboard-section {
    transition: none;
  }
}
`;