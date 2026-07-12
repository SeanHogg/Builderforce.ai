/**
 * Topic Detection API Routes
 *
 * Handles background topic detection and group formation
 */

import { Router } from 'express';
import type { Chat, GroupedChatsAnalysis } from '../../frontend/src/types/chat';

const router = Router();

/**
 * POST /api/topics/detect
 * Analyzes chats and returns grouped analysis
 */
router.post('/detect', async (req, res) => {
  try {
    const { chats }: { chats: Chat[] } = req.body;

    if (!Array.isArray(chats)) {
      return res.status(400).json({ error: 'chats must be an array' });
    }

    // In a real implementation, this would call an LLM or advanced NLP service
    // For now, we use the client-side detection logic on the server
    const detectedChats = chats.map(detectChatTopics);

    // Group by detected topics
    const groups = groupChats(detectedChats);

    const analysis: GroupedChatsAnalysis = {
      groups,
      topTopicsByChatCount: Object.entries(groupCounts(groups))
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count),
      customTopicNames: {},
      messageCountPerGroup: messageCounts(groups),
      totalMsgs: chats.reduce((acc, chat) => acc + chat.messages.length, 0),
    };

    res.json(analysis);
  } catch (error) {
    console.error('Topic detection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/topics/reevaluate
 * Re-evaluates topics for a chat after new messages
 */
router.post('/reevaluate', async (req, res) => {
  try {
    const { chatId, newMessages }: {
      chatId: string;
      newMessages: Array<{ text: string; sender: string }>;
    } = req.body;

    // In a real implementation, this would re-analyze the chat
    // For now, return a simple re-evaluation
    res.json({
      topic: 'general',
      confidence: 0.5,
      keywords: [],
    });
  } catch (error) {
    console.error('Topic re-evaluation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Internal: Detect topic for a single chat
 */
function detectChatTopics(chat: Chat): { topic: string; confidence: number } {
  const text = [
    chat.title,
    ...chat.messages.map((m) => m.text),
  ].join(' ').toLowerCase();

  // Simple keyword matching
  const topics: Record<string, number> = {};

  const topicPatterns: [string, RegExp][] = [
    ['prd', /requirements?|specs?|user stories?|prd|epic|story|acceptance criteria/i],
    ['agent-creation', /new agent|create agent|agent persona|agent integration|tool/i],
    ['pwa', /progressive web app|pwa|install.*home|offline|progressive/i],
    ['general', /^[\s\n\t]*$/],
    ['dev', /developer|pull request|merge|commit|feature|engineer|implementation/i],
    ['design', /design|mock up|prototype|ux|ui|wireframe/i],
    ['bug', /bug|issue|report|todo|fix|crash/i],
  ];

  for (const [topic, pattern] of topicPatterns) {
    if (pattern.test(text)) {
      topics[topic] = (topics[topic] || 0) + 1;
    }
  }

  // Find best match
  const bestTopic = Object.entries(topics).sort((a, b) => b[1] - a[1])[0];
  return {
    topic: bestTopic ? bestTopic[0] : 'general',
    confidence: bestTopic ? 0.5 + (bestTopic[1] * 0.1) : 0.3,
  };
}

/**
 * Internal: Group chats by their detected topics
 */
function groupChats(detected: { topic: string; confidence: number }[]): Map<string, Chat[]> {
  const result = new Map<string, Chat[]>();

  // In a real implementation, this would receive the actual chats
  // For now, we'll just map them all to 'general'
  for (const chat of detected) {
    const topic = chat.topic === 'general' ? 'other' : chat.topic;
    if (!result.has(topic)) {
      result.set(topic, []);
    }
    result.get(topic)!.push({ // Placeholder - would be actual Chat
      id: '',
      title: '',
      messages: [],
      participants: [],
    });
  }

  return result;
}

/**
 * Internal: Get group counts
 */
function groupCounts(groups: Map<string, Chat[]>) {
  const counts: Record<string, number> = {};
  for (const [, chatList] of groups.entries()) {
    counts[chatList[0]?.id || 'empty'] = chatList.length;
  }
  return counts;
}

/**
 * Internal: Get message counts per group
 */
function messageCounts(groups: Map<string, Chat[]>) {
  const counts: Record<string, number> = {};
  for (const chatList of groups.values()) {
    const chat = chatList[0];
    const groupId = chat?.id || 'empty';
    counts[groupId] = chat?.messages.length || 0;
  }
  return counts;
}

export default router;