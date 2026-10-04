import { useCallback, useMemo } from 'react';
import { BRAIN_AUTO_APPROVE_DIRECTIVE, buildComposerDirectives, type BrainEffort } from '@/lib/brain';
import type { Project } from '@/lib/types';
import { usePersonalityBlock, getSessionPsychometric } from '@/lib/usePersonalityBlock';
import { fetchLimbicBlock } from '@/lib/personalityApi';

/**
 * The ambient system channel every Brain turn carries (host context, capability,
 * personality, account preferences, project-in-context, auto-approve, composer
 * toggles) plus the per-turn limbic affect seam.
 */
export function useBrainSystemContext({
  extraSystem,
  capabilityPrompt,
  responseInstructions,
  ctxProjectId,
  projects,
  autoApprove,
  effort,
  thinking,
  webBrowsing,
}: {
  extraSystem: string | undefined;
  capabilityPrompt: string | undefined;
  responseInstructions: string;
  ctxProjectId: number | null;
  projects: Project[];
  autoApprove: boolean;
  effort: BrainEffort;
  thinking: boolean;
  webBrowsing: boolean;
}) {
  // The signed-in user's personality — fetched once per session and folded into
  // the ambient system channel so the web Brain chat's TONE reflects the user.
  // '' (a no-op) when they have no profile. This is the web half of Gap 2/3; the
  // VS Code surfaces inject the equivalent block via the gateway helper.
  const personalityBlock = usePersonalityBlock();

  const ambientSystem = useMemo(() => {
    const parts: string[] = [];
    if (extraSystem) parts.push(extraSystem);
    if (capabilityPrompt) parts.push(capabilityPrompt);
    if (personalityBlock) parts.push(personalityBlock);
    if (responseInstructions) parts.push(`ACCOUNT RESPONSE PREFERENCES:\n${responseInstructions}`);
    if (ctxProjectId != null) {
      const name = projects.find((p) => p.id === ctxProjectId)?.name;
      parts.push(`The current project is ${name ? `"${name}" ` : ''}(projectId ${ctxProjectId}). When the user asks to create, list, or operate on tasks, specs, or other project-scoped items without naming a project, use projectId ${ctxProjectId} by default. To take them to the result, call navigate_to — do not write out absolute URLs.`);
    }
    // Auto-approve flips the model from "ask before acting" to "act decisively"
    // — the toggle already skips the per-action confirm UI; this keeps the model
    // from asking for permission in prose anyway.
    if (autoApprove) parts.push(BRAIN_AUTO_APPROVE_DIRECTIVE);
    // Effort / Thinking / Browse-the-web composer toggles.
    // `thinking` is NOT passed: it is a structured `reasoning.level` on the request (see
    // `reasoningForRun` in the conversation wiring), never a prompt sentence.
    const composer = buildComposerDirectives({ effort, web: webBrowsing });
    if (composer) parts.push(composer);
    return parts.length > 0 ? parts.join('\n') : undefined;
  }, [ctxProjectId, projects, extraSystem, capabilityPrompt, autoApprove, effort, thinking, webBrowsing, personalityBlock, responseInstructions]);

  // Per-turn limbic affect (VS Code webview parity). The static personality tone
  // above (`ambientSystem` ← personalityBlock) sets the user's baseline voice;
  // this seam adds a FRESH per-message affect block the sync system prompt can't:
  // it appraises THIS turn's text (seeded from the user's psychometric) and folds
  // the dynamic `block` into that run's system prompt. Reuses the profile cached
  // by usePersonalityBlock's once-per-session `/me` fetch — only the appraisal
  // POST varies per turn. Best-effort: '' when there's no profile or on any error
  // (a no-op that never blocks the chat), so static + per-turn coexist.
  const augmentSystemPrompt = useCallback(async (userText: string): Promise<string> => {
    if (!userText.trim()) return '';
    const psychometric = await getSessionPsychometric();
    if (!psychometric) return '';
    return fetchLimbicBlock(psychometric, userText);
  }, []);

  return { ambientSystem, augmentSystemPrompt };
}
