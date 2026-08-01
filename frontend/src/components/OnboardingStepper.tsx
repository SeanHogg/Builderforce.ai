'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { Tenant } from '@/lib/types';
import { completeOnboarding, saveOnboardingProgress, type OnboardingProgress } from '@/lib/auth';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { InstallBuilderForceAgents } from './InstallBuilderForceAgents';
import { InviteTeamMembers } from './InviteTeamMembers';
import { KanbanRosterCard } from './kanban/KanbanRosterCard';
import { WizardTicketingStep } from './onboarding/WizardTicketingStep';
import { WizardReposStep } from './onboarding/WizardReposStep';
import { WizardAuditStep } from './onboarding/WizardAuditStep';
import {
  WizardTalentProfileStep,
  WizardResumeStep,
  WizardPublishStep,
  WizardFindWorkStep,
} from './onboarding/HiredWizardSteps';
import { useIsFreelancer } from '@/lib/rbac';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OnboardingStepperProps {
  webToken: string;
  tenantToken?: string | null;
  tenant?: Tenant | null;
  /** Persisted step progress (from `useOnboardingPrompt`) — resumes the wizard
   *  where the user left off. Ignored when it belongs to the other track. */
  initialProgress?: OnboardingProgress | null;
  onComplete: () => void;
  onDismiss: () => void;
}

type BuilderStepId = 'ticketing' | 'repos' | 'audit' | 'roster' | 'install' | 'invite';
type HiredStepId = 'talentProfile' | 'resume' | 'publish' | 'findWork';
type StepId = BuilderStepId | HiredStepId;

// Step order per ACCOUNT TYPE. A builder ('standard') connects tickets/repos, runs
// audits and hires an agent roster — its workspace and first project are already
// provisioned ("Default", renameable) so those two steps no longer exist. A hired
// ('freelancer') account has none of those; its first five minutes are about
// becoming hireable. Labels resolve through the `onboarding.steps.*` i18n namespace.
const BUILDER_STEP_IDS: StepId[] = ['ticketing', 'repos', 'audit', 'roster', 'install', 'invite'];
const HIRED_STEP_IDS: StepId[] = ['talentProfile', 'resume', 'publish', 'findWork'];

/** The ONE place the onboarding track is chosen, so no caller re-derives it. */
export function stepsForAccountType(isFreelancer: boolean): StepId[] {
  return isFreelancer ? HIRED_STEP_IDS : BUILDER_STEP_IDS;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OnboardingStepper({
  webToken,
  tenantToken = null,
  tenant = null,
  initialProgress = null,
  onComplete,
  onDismiss,
}: OnboardingStepperProps) {
  const t = useTranslations('onboarding');
  // Both stepper mounts sit under ProjectScopeProvider (hoisted to AppBrainShell);
  // the optional hook is defensive so the stepper stays usable outside that shell.
  const projectScope = useOptionalProjectScope();
  // The account type decides the whole track — a hired account never sees the
  // repo/roster steps, and a builder's workspace + first project are already
  // provisioned before this wizard ever shows.
  const isHired = useIsFreelancer();
  const stepIds = stepsForAccountType(isHired);

  // Completion is tracked by STEP ID, not index — ids are stable across the two
  // tracks and any reordering, which is also what gets persisted (migration 0343).
  const track: OnboardingProgress['track'] = isHired ? 'hired' : 'builder';
  const resumable = initialProgress?.track === track ? initialProgress : null;

  const initialCompleted = new Set<StepId>(
    (resumable?.completed ?? []).filter((id): id is StepId => (stepIds as string[]).includes(id)),
  );

  // Resume where the user left off; otherwise start at the first step.
  const resumedIndex = resumable?.activeStep ? stepIds.indexOf(resumable.activeStep as StepId) : -1;
  const initialActiveStep = resumedIndex >= 0 ? resumedIndex : 0;

  const [activeStep, setActiveStep] = useState<number>(initialActiveStep);
  const [completedSteps, setCompletedSteps] = useState<Set<StepId>>(initialCompleted);
  const currentStepId = stepIds[activeStep];

  // Record progress server-side on every step transition so closing the wizard
  // mid-way resumes here instead of restarting at step 1. Fire-and-forget: the
  // helper swallows failures, which only ever cost the resume position.
  const persistProgress = useCallback(
    (completed: Set<StepId>, active: StepId | undefined) => {
      void saveOnboardingProgress(webToken, {
        track,
        completed: [...completed],
        activeStep: active ?? null,
      });
    },
    [webToken, track],
  );

  const markComplete = (stepId: StepId | undefined, nextActive?: StepId) => {
    if (!stepId) return;
    // Compute the next set OUTSIDE the state updater — updaters must stay pure
    // (React can call them twice in StrictMode, which would double the PUT).
    const next = new Set([...completedSteps, stepId]);
    setCompletedSteps(next);
    persistProgress(next, nextActive ?? stepId);
  };

  // The workspace + first project are already provisioned before this wizard
  // shows, so nothing here is mandatory — it can be closed at any point.
  const canClose = true;

  // ── Step navigation ──────────────────────────────────────────────────────

  const handleNext = () => {
    markComplete(currentStepId, stepIds[activeStep + 1] ?? currentStepId);
    if (activeStep < stepIds.length - 1) {
      setActiveStep((s) => s + 1);
    }
  };

  const handleFinish = async () => {
    markComplete(currentStepId);
    try {
      await completeOnboarding(webToken);
    } catch {
      // Non-fatal — user has completed onboarding visually regardless
    }
    onComplete();
  };

  const handleDismiss = async () => {
    try {
      await completeOnboarding(webToken);
    } catch {
      // Non-fatal
    }
    onDismiss();
  };

  // ── Render ───────────────────────────────────────────────────────────────

  // The ticketing / repos / audit / roster steps all act on ONE project. Prefer
  // the globally-scoped project, then the first project in the workspace (the
  // auto-provisioned "Default" always qualifies) — so these steps reach their
  // adoption hooks instead of a "create a project first" placeholder.
  const activeProjectId =
    projectScope?.currentProjectId ?? projectScope?.projects[0]?.id ?? null;

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
          maxWidth: 880,
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
              {isHired ? t('welcomeHired') : t('welcome')}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              {isHired ? t('subtitleHired') : t('subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={!canClose}
            title={canClose ? t('closeSetup') : t('createWorkspaceFirst')}
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
            aria-label={t('closeOnboarding')}
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
            overflowX: 'auto',
          }}
        >
          {stepIds.map((stepId, i) => {
            const done = completedSteps.has(stepId);
            const active = i === activeStep;
            return (
              <div key={stepId} style={{ display: 'flex', alignItems: 'center', flex: i < stepIds.length - 1 ? 1 : undefined }}>
                <button
                  type="button"
                  onClick={() => { if (done) { setActiveStep(i); persistProgress(completedSteps, stepId); } }}
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
                    flexShrink: 0,
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
                    {t(`steps.${stepId}.label`)}
                  </span>
                </button>
                {i < stepIds.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background: completedSteps.has(stepId) ? 'rgba(34,197,94,0.4)' : 'var(--border-subtle)',
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
          {/* ── Step: Connect ticketing ── */}
          {currentStepId === 'ticketing' && (
            activeProjectId != null ? (
              <WizardTicketingStep projectId={activeProjectId} />
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>
                {t('needProject')}
              </div>
            )
          )}

          {/* ── Step: Connect repositories ── */}
          {currentStepId === 'repos' && (
            activeProjectId != null ? (
              <WizardReposStep projectId={activeProjectId} />
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>
                {t('needProject')}
              </div>
            )
          )}

          {/* ── Step: Run audits (the SOC 2 adoption hook) ── */}
          {currentStepId === 'audit' && (
            activeProjectId != null ? (
              <WizardAuditStep projectId={activeProjectId} />
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>
                {t('needProject')}
              </div>
            )
          )}

          {/* ── Step 3: Recommended Roster ── */}
          {currentStepId === 'roster' && (
            <div>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)' }}>
                {t('rosterIntro')}
              </p>
              {activeProjectId != null ? (
                <KanbanRosterCard projectId={activeProjectId} />
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>
                  {t('rosterNeedProject')}
                </div>
              )}
            </div>
          )}

          {/* ── Step 4: Install ── */}
          {currentStepId === 'install' && (
            <InstallBuilderForceAgents tenantToken={tenantToken} />
          )}

          {/* ── Step 4: Invite ── */}
          {currentStepId === 'invite' && tenant && tenantToken && (
            <InviteTeamMembers tenantId={tenant.id} tenantToken={tenantToken} />
          )}

          {/* ── Hired track: profile → résumé → publish → find work ── */}
          {currentStepId === 'talentProfile' && <WizardTalentProfileStep />}
          {currentStepId === 'resume' && <WizardResumeStep />}
          {currentStepId === 'publish' && <WizardPublishStep />}
          {currentStepId === 'findWork' && <WizardFindWorkStep />}
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
            {t('back')}
          </button>

          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('stepOf', { current: activeStep + 1, total: stepIds.length })}
          </span>

          {activeStep < stepIds.length - 1 ? (
            (() => {
              // Every step is optional now — the workspace and first project are
              // already provisioned, so nothing blocks advancing.
              const nextDisabled = false;
              return (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={nextDisabled}
                  title={nextDisabled ? t('completeFirst') : undefined}
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
                  {t('next')}
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
              {t('finishSetup')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
