import type { ReactNode } from 'react';
import type { BrainCapabilitySurface, BrainModality } from '@/lib/brain';

export interface BrainPanelProps {
  variant: 'page' | 'docked';
  /** Lock the Brain to one project (docked-in-IDE / project pages). */
  pinnedProjectId?: number | null;
  /**
   * The project the user is currently viewing (e.g. the Tasks board scoped to
   * `?project=14`). Injected into the system prompt as the default project for
   * project-scoped actions — WITHOUT pinning chats or switching persona.
   */
  viewingProjectId?: number | null;
  /** Active modality — drives the docked Brain's persona. */
  modality?: BrainModality;
  /** Extra system-prompt context (e.g. the IDE's open file). */
  extraSystem?: string;
  /** Deep-link: select this chat on mount. */
  initialChatId?: number | null;
  /**
   * One-shot prompt to auto-send on mount (e.g. a landing-page prompt replayed
   * after auth). Sent exactly once; `conv.send` creates+selects a chat on demand.
   */
  initialPrompt?: string;
  /**
   * One-shot work item to auto-link the opened chat to (`?ticket=<kind>:<ref>`), so
   * clicking an item opens a chat already tied to it — parity with the VS Code "open
   * task" flow. Handled once; ensures a chat exists, then reuses `brain.linkChatTicket`.
   */
  initialTicket?: { kind: string; ref: string };
  /**
   * Which capability set this surface offers ("what are we making?"). Brain
   * Storm authors artifacts (document / slides / data viz / spreadsheet); the
   * IDE builds and runs things (website / design / mobile / animation / 3D
   * game). See lib/brain/capabilities.ts.
   */
  capabilitySurface?: BrainCapabilitySurface;
  /** Docked only: close handler for the drawer chrome. */
  onClose?: () => void;
  /**
   * Docked only: what the agent currently sees, as the host words it (the IDE's open
   * file, the voice director's clone). Rendered as the header's subtitle.
   */
  headerContext?: ReactNode;
  /**
   * `compact` — a composer beside a workspace that already names the project and
   * its type, and whose header carries the plan: the context pickers ride in the
   * tool row instead of a row of their own, the plan/memory row is dropped (memory
   * is in the `/` menu), and "Acting as" / "Making" appear only when they are a
   * real choice (there are agents to act as; a capability is set and can be
   * cleared). Defaults to `comfortable`.
   */
  composerDensity?: 'comfortable' | 'compact';
}
