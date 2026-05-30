/**
 * Project artifact generation (PRD + Tasks) extracted from ChatProjectActions
 * so the same logic backs BOTH the message-action buttons and the Brain's
 * `generate_prd` / `generate_tasks` tools. One implementation, two call sites.
 */

import { llmChat, specsApi, tasksApi } from '../builderforceApi';

export interface GeneratedTasks {
  titles: string[];
  descriptions: string[];
}

/** Generate a PRD (markdown) from a conversation or a single assistant message. */
export async function generatePrd(input: {
  assistantContent: string;
  conversationMessages?: Array<{ role: string; content: string }>;
}): Promise<string> {
  const { assistantContent, conversationMessages } = input;
  const conversationText =
    conversationMessages && conversationMessages.length > 0
      ? conversationMessages
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n\n')
      : assistantContent;
  const { content } = await llmChat([
    {
      role: 'user',
      content: `Generate a Product Requirements Document (PRD) based on the following conversation. Output only the PRD in markdown: clear sections (Overview, Goals, Requirements, etc.). No preamble or "here is the PRD".\n\n---\n\n${conversationText.slice(0, 12000)}`,
    },
  ]);
  return content.trim();
}

/** Persist a generated PRD as a project spec. */
export async function savePrd(projectId: number, prd: string): Promise<void> {
  await specsApi.create({ projectId, goal: 'From chat', prd, status: 'draft' });
}

/** Extract a list of actionable tasks from an assistant message. */
export async function generateTasks(assistantContent: string): Promise<GeneratedTasks> {
  const { content } = await llmChat([
    {
      role: 'user',
      content: `Based on this response, extract or generate a list of actionable tasks. Output one task per line. Each line: "title" or "title | description". No numbering, no bullets, no preamble. Plain lines only.\n\n---\n\n${assistantContent.slice(0, 8000)}`,
    },
  ]);
  const lines = content
    .split(/\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const titles: string[] = [];
  const descriptions: string[] = [];
  for (const line of lines) {
    const pipe = line.indexOf('|');
    if (pipe >= 0) {
      titles.push(line.slice(0, pipe).trim());
      descriptions.push(line.slice(pipe + 1).trim());
    } else {
      titles.push(line);
      descriptions.push('');
    }
  }
  return { titles, descriptions };
}

/** Persist generated tasks to the project. */
export async function saveTasks(projectId: number, tasks: GeneratedTasks): Promise<void> {
  for (let i = 0; i < tasks.titles.length; i++) {
    await tasksApi.create({
      projectId,
      title: tasks.titles[i],
      description: tasks.descriptions[i] || null,
    });
  }
}
