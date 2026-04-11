'use client';

import { useState, useCallback } from 'react';
import type { Tenant } from '@/lib/types';
import { createTenant, completeOnboarding } from '@/lib/auth';
import { createProject } from '@/lib/api';
import { InstallCoderClaw } from './InstallCoderClaw';
import { InviteTeamMembers } from './InviteTeamMembers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OnboardingStepperProps {
  webToken: string;
  tenantToken: string | null;
  tenant: Tenant | null;
  existingProjectsCount?: number;
  onWorkspaceCreated: (tenant: Tenant) => Promise<void>;
  onComplete: () => void;
  onDismiss: () => void;
}

const INTENT_OPTIONS = [
  { value: 'build', label: '🔨 Build a product or feature' },
  { value: 'custom-agent', label: '🤖 Create a custom AI agent' },
  { value: 'monetize', label: '💰 Make money with AI agents' },
  { value: 'automate', label: '⚡ Automate my dev workflow' },
  { value: 'learn', label: '📚 Learn and explore' },
];

type StepId = 'workspace' | 'project' | 'install' | 'invite';

interface Step {
  id: StepId;
  label: string;
  description: string;
}

const STEPS: Step[] = [
  { id: 'workspace', label: 'Create Workspace', description: 'Set up your organization' },
  { id: 'project',   label: 'Create a Project', description: 'Name your first project' },
  { id: 'install',   label: 'Install CoderClaw', description: 'Connect your AI agent' },
  { id: 'invite',    label: 'Invite Team',       description: 'Bring your teammates' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OnboardingStepper({
  webToken,
  tenantToken,
  tenant,
  existingProjectsCount = 0,
  onWorkspaceCreated,
  onComplete,
  onDismiss,
}: OnboardingStepperProps) {
  const workspaceAlreadyExists = !!tenant;
  const projectAlreadyExists = workspaceAlreadyExists && existingProjectsCount > 0;

  const initialCompleted = new Set<number>();
  if (workspaceAlreadyExists) initialCompleted.add(0);
  if (projectAlreadyExists) initialCompleted.add(1);

  const initialActiveStep = projectAlreadyExists ? 2 : workspaceAlreadyExists ? 1 : 0;

  const [activeStep, setActiveStep] = useState<number>(initialActiveStep);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(initialCompleted);

  // Step 1 – Workspace
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);

  // Step 2 – Project
  const [projectName, setProjectName] = useState('');
  const [projectDesc, setProjectDesc] = useState('');
  const [selectedIntent, setSelectedIntent] = useState<string[]>([]);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectCreated, setProjectCreated] = useState(false);

  // Current workspace (may be passed in or created during step 1)
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(tenant);

  const markComplete = (stepIndex: number) => {
    setCompletedSteps((prev) => new Set([...prev, stepIndex]));
  };

  const canClose = completedSteps.has(0) || workspaceAlreadyExists;

  // ── Step 1: Create Workspace ─────────────────────────────────────────────

  const handleCreateWorkspace = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!workspaceName.trim()) return;
      setWorkspaceError(null);
      setWorkspaceLoading(true);
      try {
        const newTenant = await createTenant(webToken, workspaceName.trim());
        await onWorkspaceCreated(newTenant);
        setCurrentTenant(newTenant);
        markComplete(0);
        setActiveStep(1);
      } catch (err) {
        setWorkspaceError(err instanceof Error ? err.message : 'Failed to create workspace');
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [webToken, workspaceName, onWorkspaceCreated]
  );

  // ── Step 2: Create Project ───────────────────────────────────────────────

  const handleCreateProject = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!projectName.trim()) return;
      setProjectError(null);
      setProjectLoading(true);
      try {
        await createProject({ name: projectName.trim(), description: projectDesc.trim() || undefined });
        setProjectCreated(true);
        markComplete(1);
      } catch (err) {
        setProjectError(err instanceof Error ? err.message : 'Failed to create project');
      } finally {
        setProjectLoading(false);
      }
    },
    [projectName, projectDesc]
  );

  const toggleIntent = (value: string) => {
    setSelectedIntent((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  // ── Step navigation ──────────────────────────────────────────────────────

  const handleNext = () => {
    markComplete(activeStep);
    if (activeStep < STEPS.length - 1) {
      setActiveStep((s) => s + 1);
    }
  };

  const handleFinish = async () => {
    markComplete(activeStep);
    try {
      await completeOnboarding(webToken, selectedIntent.length > 0 ? selectedIntent : undefined);
    } catch {
      // Non-fatal — user has completed onboarding visually regardless
    }
    onComplete();
  };

  const handleDismiss = async () => {
    try {
      await completeOnboarding(webToken, selectedIntent.length > 0 ? selectedIntent : undefined);
    } catch {
      // Non-fatal
    }
    onDismiss();
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const currentStepId = STEPS[activeStep]?.id;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          background: 'var(--bg-deep, #050914)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 680,
          maxHeight: '92vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px 0',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
              Welcome to Builderforce
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Let&apos;s get you set up in a few quick steps.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={!canClose}
            title={canClose ? 'Close setup' : 'Create a workspace first'}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              color: canClose ? 'var(--text-muted)' : 'var(--text-faint, #3a4060)',
              fontSize: 20,
              lineHeight: 1,
              padding: '4px 10px',
              cursor: canClose ? 'pointer' : 'not-allowed',
              opacity: canClose ? 1 : 0.4,
            }}
            aria-label="Close onboarding"
          >
            ×
          </button>
        </div>

        {/* Step indicator */}
        <div
          style={{
            display: 'flex',
            gap: 0,
            padding: '20px 24px 0',
            alignItems: 'center',
          }}
        >
          {STEPS.map((step, i) => {
            const done = completedSteps.has(i);
            const active = i === activeStep;
            return (
              <div key={step.id} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : undefined }}>
                <button
                  type="button"
                  onClick={() => done && setActiveStep(i)}
                  disabled={!done && !active}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    background: 'none',
                    border: 'none',
                    cursor: done ? 'pointer' : 'default',
                    padding: 0,
                    minWidth: 60,
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: done ? 16 : 13,
                      fontWeight: 700,
                      background: done
                        ? 'rgba(34,197,94,0.15)'
                        : active
                        ? 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))'
                        : 'var(--bg-elevated)',
                      color: done ? '#22c55e' : active ? '#fff' : 'var(--text-muted)',
                      border: done
                        ? '1px solid rgba(34,197,94,0.4)'
                        : active
                        ? 'none'
                        : '1px solid var(--border-subtle)',
                    }}
                  >
                    {done ? '✓' : i + 1}
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: active ? 600 : 400,
                      color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {step.label}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background: completedSteps.has(i) ? 'rgba(34,197,94,0.4)' : 'var(--border-subtle)',
                      margin: '0 4px',
                      marginBottom: 20,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div style={{ padding: '24px', flex: 1 }}>
          {/* ── Step 1: Workspace ── */}
          {currentStepId === 'workspace' && (
            <div>
              {workspaceAlreadyExists ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>🏢</div>
                  <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
                    {currentTenant?.name}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                    Workspace ready
                  </div>
                </div>
              ) : (
                <form onSubmit={handleCreateWorkspace}>
                  <label
                    style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}
                  >
                    Workspace name
                  </label>
                  <input
                    type="text"
                    placeholder="Acme Corp"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    disabled={workspaceLoading}
                    autoFocus
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 14px',
                      fontSize: 15,
                      background: 'var(--bg-base)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      color: 'var(--text-primary)',
                      outline: 'none',
                      marginBottom: 8,
                    }}
                  />
                  {workspaceError && (
                    <p style={{ color: 'var(--error-text, #e74c3c)', fontSize: 13, marginBottom: 8 }}>
                      {workspaceError}
                    </p>
                  )}
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 20 }}>
                    This is usually your company or team name. You can change it later.
                  </p>
                  <button
                    type="submit"
                    disabled={workspaceLoading || !workspaceName.trim()}
                    style={{
                      padding: '10px 24px',
                      fontSize: 14,
                      fontWeight: 600,
                      background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 10,
                      cursor: workspaceLoading || !workspaceName.trim() ? 'not-allowed' : 'pointer',
                      opacity: workspaceLoading || !workspaceName.trim() ? 0.6 : 1,
                    }}
                  >
                    {workspaceLoading ? 'Creating…' : 'Create Workspace'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ── Step 2: Project ── */}
          {currentStepId === 'project' && (
            <div>
              {projectAlreadyExists ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                  <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
                    {existingProjectsCount} project{existingProjectsCount === 1 ? '' : 's'} ready
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                    You already have projects in this workspace.
                  </div>
                </div>
              ) : projectCreated ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                  <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
                    &ldquo;{projectName}&rdquo; created
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                    Your project is ready.
                  </div>
                </div>
              ) : (
                <form onSubmit={handleCreateProject}>
                  <div style={{ marginBottom: 16 }}>
                    <label
                      style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}
                    >
                      Project name <span style={{ color: 'var(--coral-bright)' }}>*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="My Awesome App"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      disabled={projectLoading}
                      autoFocus
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '10px 14px',
                        fontSize: 15,
                        background: 'var(--bg-base)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        color: 'var(--text-primary)',
                        outline: 'none',
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <label
                      style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}
                    >
                      Description <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
                    </label>
                    <textarea
                      placeholder="What are you building?"
                      value={projectDesc}
                      onChange={(e) => setProjectDesc(e.target.value)}
                      disabled={projectLoading}
                      rows={2}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '10px 14px',
                        fontSize: 14,
                        background: 'var(--bg-base)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        color: 'var(--text-primary)',
                        outline: 'none',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <label
                      style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}
                    >
                      What are you looking to do?{' '}
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional, select all that apply)</span>
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {INTENT_OPTIONS.map((opt) => {
                        const selected = selectedIntent.includes(opt.value);
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => toggleIntent(opt.value)}
                            style={{
                              padding: '7px 14px',
                              fontSize: 13,
                              fontWeight: selected ? 600 : 400,
                              background: selected
                                ? 'rgba(244,114,110,0.15)'
                                : 'var(--bg-elevated)',
                              color: selected ? 'var(--coral-bright)' : 'var(--text-secondary)',
                              border: `1px solid ${selected ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                              borderRadius: 20,
                              cursor: 'pointer',
                              transition: 'all 0.15s',
                            }}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {projectError && (
                    <p style={{ color: 'var(--error-text, #e74c3c)', fontSize: 13, marginBottom: 8 }}>
                      {projectError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={projectLoading || !projectName.trim()}
                    style={{
                      padding: '10px 24px',
                      fontSize: 14,
                      fontWeight: 600,
                      background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 10,
                      cursor: projectLoading || !projectName.trim() ? 'not-allowed' : 'pointer',
                      opacity: projectLoading || !projectName.trim() ? 0.6 : 1,
                    }}
                  >
                    {projectLoading ? 'Creating…' : 'Create Project'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ── Step 3: Install ── */}
          {currentStepId === 'install' && (
            <InstallCoderClaw tenantToken={tenantToken} />
          )}

          {/* ── Step 4: Invite ── */}
          {currentStepId === 'invite' && currentTenant && tenantToken && (
            <InviteTeamMembers tenantId={currentTenant.id} tenantToken={tenantToken} />
          )}
        </div>

        {/* Footer navigation */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 24px',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveStep((s) => Math.max(0, s - 1))}
            disabled={activeStep === 0}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              color: 'var(--text-secondary)',
              cursor: activeStep === 0 ? 'not-allowed' : 'pointer',
              opacity: activeStep === 0 ? 0.4 : 1,
            }}
          >
            ← Back
          </button>

          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Step {activeStep + 1} of {STEPS.length}
          </span>

          {activeStep < STEPS.length - 1 ? (
            (() => {
              const nextDisabled =
                (currentStepId === 'workspace' && !completedSteps.has(0) && !workspaceAlreadyExists) ||
                (currentStepId === 'project' && !projectCreated && !completedSteps.has(1));
              return (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={nextDisabled}
                  title={nextDisabled ? 'Complete this step first' : undefined}
                  style={{
                    padding: '8px 20px',
                    fontSize: 14,
                    fontWeight: 600,
                    background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    cursor: nextDisabled ? 'not-allowed' : 'pointer',
                    opacity: nextDisabled ? 0.5 : 1,
                  }}
                >
                  Next →
                </button>
              );
            })()
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              style={{
                padding: '8px 20px',
                fontSize: 14,
                fontWeight: 600,
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Finish setup ✓
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
