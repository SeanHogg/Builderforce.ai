import type { Metadata } from 'next';
import SkillsBrowser, { type Skill } from './SkillsBrowser';

export const metadata: Metadata = {
  title: 'Agent Skills Directory — CoderClaw',
  description:
    'Browse the CoderClaw agent skills directory. Discover pre-built skills for code review, testing, documentation, security scanning, and more.',
  alternates: { canonical: '/coderclaw/skills' },
};

const BUILTIN_SKILLS: Skill[] = [
  { id: 'github', name: 'GitHub', author: 'coderClaw', description: 'Interact with GitHub repositories, issues, PRs, and workflows.', category: 'Development', likes: 89, downloads: 420, tags: ['github', 'git', 'development'] },
  { id: 'coding-agent', name: 'Coding Agent', author: 'coderClaw', description: 'An autonomous programming agent that writes, refactors, and tests code.', category: 'Development', likes: 112, downloads: 580, tags: ['coding', 'agent', 'automation'] },
  { id: 'coderclaw', name: 'coderClaw', author: 'coderClaw', description: 'Core skill for coderClaw self-management, configuration, and introspection.', category: 'Development', likes: 67, downloads: 340, tags: ['core', 'management'] },
  { id: 'skill-creator', name: 'Skill Creator', author: 'coderClaw', description: 'Create, test, and package new coderClaw skills from natural language.', category: 'Development', likes: 45, downloads: 210, tags: ['skills', 'creator', 'development'] },
  { id: 'slack', name: 'Slack', author: 'coderClaw', description: 'Manage Slack channels, messages, and team collaboration.', category: 'Communication', likes: 74, downloads: 360, tags: ['slack', 'chat', 'collaboration'] },
  { id: 'discord', name: 'Discord', author: 'coderClaw', description: 'Interact with Discord servers, channels, roles, and messages.', category: 'Communication', likes: 58, downloads: 290, tags: ['discord', 'chat', 'community'] },
  { id: 'notion', name: 'Notion', author: 'Notion', description: 'Manage Notion pages, databases, blocks, and workspace content.', category: 'Productivity', likes: 82, downloads: 400, tags: ['notion', 'notes', 'wiki'] },
  { id: 'obsidian', name: 'Obsidian', author: 'Obsidian', description: 'Manage Obsidian vault notes, links, and knowledge graph.', category: 'Productivity', likes: 63, downloads: 310, tags: ['obsidian', 'notes', 'knowledge'] },
  { id: 'trello', name: 'Trello', author: 'Atlassian', description: 'Manage Trello boards, lists, cards, and workflows.', category: 'Productivity', likes: 41, downloads: 195, tags: ['trello', 'project', 'kanban'] },
  { id: 'gemini', name: 'Gemini', author: 'Google', description: 'Integrate with Google Gemini for advanced AI generation tasks.', category: 'AI & ML', likes: 95, downloads: 470, tags: ['gemini', 'ai', 'google'] },
  { id: 'openai-image-gen', name: 'OpenAI Image Gen', author: 'OpenAI', description: 'Generate and manipulate images using OpenAI DALL-E models.', category: 'AI & ML', likes: 78, downloads: 380, tags: ['openai', 'images', 'dall-e'] },
  { id: 'openai-whisper', name: 'OpenAI Whisper', author: 'OpenAI', description: 'Local speech-to-text transcription via the Whisper model.', category: 'AI & ML', likes: 56, downloads: 270, tags: ['whisper', 'speech', 'transcription'] },
  { id: 'spotify-player', name: 'Spotify Player', author: 'Spotify', description: 'Control Spotify playback, playlists, and music discovery.', category: 'Media', likes: 71, downloads: 350, tags: ['spotify', 'music', 'player'] },
  { id: 'video-frames', name: 'Video Frames', author: 'FFmpeg', description: 'Extract, analyze, and manipulate video frames.', category: 'Media', likes: 33, downloads: 160, tags: ['video', 'frames', 'media'] },
  { id: 'weather', name: 'Weather', author: 'wttr.in', description: 'Get real-time weather data, forecasts, and historical climate info.', category: 'Utilities', likes: 48, downloads: 230, tags: ['weather', 'forecast', 'data'] },
  { id: 'tmux', name: 'Tmux', author: 'coderClaw', description: 'Manage tmux terminal sessions, windows, panes, and screen multiplexing.', category: 'Utilities', likes: 37, downloads: 175, tags: ['tmux', 'terminal', 'shell'] },
  { id: '1password', name: '1Password', author: '1Password', description: 'Securely access and manage 1Password vault items.', category: 'Security', likes: 52, downloads: 250, tags: ['1password', 'secrets', 'security'] },
  { id: 'bluebubbles', name: 'BlueBubbles', author: 'BlueBubbles', description: 'Send and manage iMessages through the BlueBubbles bridge.', category: 'Communication', likes: 29, downloads: 140, tags: ['imessage', 'sms', 'messaging'] },
  { id: 'summarize', name: 'Summarize', author: 'Summarize', description: 'Generate concise summaries of documents, articles, and conversations.', category: 'AI & ML', likes: 64, downloads: 315, tags: ['summary', 'ai', 'text'] },
  { id: 'canvas', name: 'Canvas', author: 'coderClaw', description: 'Visual thinking canvas for brainstorming and diagramming.', category: 'Productivity', likes: 42, downloads: 205, tags: ['canvas', 'visual', 'brainstorm'] },
  { id: 'oracle', name: 'Oracle', author: 'AskOracle', description: 'Multi-model AI oracle for comparing responses across providers.', category: 'AI & ML', likes: 55, downloads: 268, tags: ['oracle', 'ai', 'multi-model'] },
  { id: 'voice-call', name: 'Voice Call', author: 'coderClaw', description: 'Real-time voice call interface for agent conversations.', category: 'Communication', likes: 38, downloads: 185, tags: ['voice', 'call', 'realtime'] },
  { id: 'openhue', name: 'OpenHue', author: 'OpenHue', description: 'Control Philips Hue smart lights, scenes, and automation.', category: 'IoT & Hardware', likes: 25, downloads: 120, tags: ['hue', 'lights', 'smart-home'] },
  { id: 'gh-issues', name: 'GitHub Issues', author: 'coderClaw', description: 'Manage GitHub issues with advanced filtering, labeling, and workflows.', category: 'Development', likes: 68, downloads: 330, tags: ['github', 'issues', 'tracking'] },
];

const REGISTRY_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai';

async function fetchSkills(): Promise<Skill[]> {
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

export default async function SkillsPage() {
  const skills = await fetchSkills();
  return <SkillsBrowser skills={skills} />;
}
