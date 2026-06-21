import type { Skill } from './SkillsBrowser';

/**
 * Shared skills data source for the public `/agents/skills` directory.
 *
 * Both the directory listing (`page.tsx`) and the per-skill detail page
 * (`[slug]/page.tsx`) read from here so a slug shown in the grid always
 * resolves to a real detail page — one source of truth, no drift.
 */

export const BUILTIN_SKILLS: Skill[] = [
  { id: 'github', name: 'GitHub', author: 'BuilderForce Agents', description: 'Interact with GitHub repositories, issues, PRs, and workflows.', category: 'Development', likes: 89, downloads: 420, tags: ['github', 'git', 'development'] },
  { id: 'coding-agent', name: 'Coding Agent', author: 'BuilderForce Agents', description: 'An autonomous programming agent that writes, refactors, and tests code.', category: 'Development', likes: 112, downloads: 580, tags: ['coding', 'agent', 'automation'] },
  { id: 'agents', name: 'BuilderForce Agents', author: 'BuilderForce Agents', description: 'Core skill for BuilderForce Agents self-management, configuration, and introspection.', category: 'Development', likes: 67, downloads: 340, tags: ['core', 'management'] },
  { id: 'skill-creator', name: 'Skill Creator', author: 'BuilderForce Agents', description: 'Create, test, and package new BuilderForce Agents skills from natural language.', category: 'Development', likes: 45, downloads: 210, tags: ['skills', 'creator', 'development'] },
  { id: 'slack', name: 'Slack', author: 'BuilderForce Agents', description: 'Manage Slack channels, messages, and team collaboration.', category: 'Communication', likes: 74, downloads: 360, tags: ['slack', 'chat', 'collaboration'] },
  { id: 'discord', name: 'Discord', author: 'BuilderForce Agents', description: 'Interact with Discord servers, channels, roles, and messages.', category: 'Communication', likes: 58, downloads: 290, tags: ['discord', 'chat', 'community'] },
  { id: 'notion', name: 'Notion', author: 'Notion', description: 'Manage Notion pages, databases, blocks, and workspace content.', category: 'Productivity', likes: 82, downloads: 400, tags: ['notion', 'notes', 'wiki'] },
  { id: 'obsidian', name: 'Obsidian', author: 'Obsidian', description: 'Manage Obsidian vault notes, links, and knowledge graph.', category: 'Productivity', likes: 63, downloads: 310, tags: ['obsidian', 'notes', 'knowledge'] },
  { id: 'trello', name: 'Trello', author: 'Atlassian', description: 'Manage Trello boards, lists, cards, and workflows.', category: 'Productivity', likes: 41, downloads: 195, tags: ['trello', 'project', 'kanban'] },
  { id: 'gemini', name: 'Gemini', author: 'Google', description: 'Integrate with Google Gemini for advanced AI generation tasks.', category: 'AI & ML', likes: 95, downloads: 470, tags: ['gemini', 'ai', 'google'] },
  { id: 'openai-image-gen', name: 'OpenAI Image Gen', author: 'OpenAI', description: 'Generate and manipulate images using OpenAI DALL-E models.', category: 'AI & ML', likes: 78, downloads: 380, tags: ['openai', 'images', 'dall-e'] },
  { id: 'openai-whisper', name: 'OpenAI Whisper', author: 'OpenAI', description: 'Local speech-to-text transcription via the Whisper model.', category: 'AI & ML', likes: 56, downloads: 270, tags: ['whisper', 'speech', 'transcription'] },
  { id: 'spotify-player', name: 'Spotify Player', author: 'Spotify', description: 'Control Spotify playback, playlists, and music discovery.', category: 'Media', likes: 71, downloads: 350, tags: ['spotify', 'music', 'player'] },
  { id: 'video-frames', name: 'Video Frames', author: 'FFmpeg', description: 'Extract, analyze, and manipulate video frames.', category: 'Media', likes: 33, downloads: 160, tags: ['video', 'frames', 'media'] },
  { id: 'weather', name: 'Weather', author: 'wttr.in', description: 'Get real-time weather data, forecasts, and historical climate info.', category: 'Utilities', likes: 48, downloads: 230, tags: ['weather', 'forecast', 'data'] },
  { id: 'tmux', name: 'Tmux', author: 'BuilderForce Agents', description: 'Manage tmux terminal sessions, windows, panes, and screen multiplexing.', category: 'Utilities', likes: 37, downloads: 175, tags: ['tmux', 'terminal', 'shell'] },
  { id: '1password', name: '1Password', author: '1Password', description: 'Securely access and manage 1Password vault items.', category: 'Security', likes: 52, downloads: 250, tags: ['1password', 'secrets', 'security'] },
  { id: 'bluebubbles', name: 'BlueBubbles', author: 'BlueBubbles', description: 'Send and manage iMessages through the BlueBubbles bridge.', category: 'Communication', likes: 29, downloads: 140, tags: ['imessage', 'sms', 'messaging'] },
  { id: 'summarize', name: 'Summarize', author: 'Summarize', description: 'Generate concise summaries of documents, articles, and conversations.', category: 'AI & ML', likes: 64, downloads: 315, tags: ['summary', 'ai', 'text'] },
  { id: 'canvas', name: 'Canvas', author: 'BuilderForce Agents', description: 'Visual thinking canvas for brainstorming and diagramming.', category: 'Productivity', likes: 42, downloads: 205, tags: ['canvas', 'visual', 'brainstorm'] },
  { id: 'oracle', name: 'Oracle', author: 'AskOracle', description: 'Multi-model AI oracle for comparing responses across providers.', category: 'AI & ML', likes: 55, downloads: 268, tags: ['oracle', 'ai', 'multi-model'] },
  { id: 'voice-call', name: 'Voice Call', author: 'BuilderForce Agents', description: 'Real-time voice call interface for agent conversations.', category: 'Communication', likes: 38, downloads: 185, tags: ['voice', 'call', 'realtime'] },
  { id: 'openhue', name: 'OpenHue', author: 'OpenHue', description: 'Control Philips Hue smart lights, scenes, and automation.', category: 'IoT & Hardware', likes: 25, downloads: 120, tags: ['hue', 'lights', 'smart-home'] },
  { id: 'gh-issues', name: 'GitHub Issues', author: 'BuilderForce Agents', description: 'Manage GitHub issues with advanced filtering, labeling, and workflows.', category: 'Development', likes: 68, downloads: 330, tags: ['github', 'issues', 'tracking'] },
];

const REGISTRY_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai';

/**
 * Fetch the skills catalog from the marketplace registry, falling back to the
 * built-in set when the registry is unavailable or empty. Shared by the list
 * and detail pages so both resolve the same slugs.
 */
export async function fetchSkills(): Promise<Skill[]> {
  try {
    const res = await fetch(`${REGISTRY_URL}/marketplace/skills?limit=100`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 300 },
    });
    if (!res.ok) return BUILTIN_SKILLS;
    const body = await res.json();
    const remote = body.skills as Skill[] | undefined;
    return remote && remote.length > 0 ? remote : BUILTIN_SKILLS;
  } catch {
    return BUILTIN_SKILLS;
  }
}

/** Resolve a single skill by its slug/id from the shared catalog. */
export async function getSkillBySlug(slug: string): Promise<Skill | undefined> {
  const skills = await fetchSkills();
  return skills.find((s) => s.id === slug);
}
