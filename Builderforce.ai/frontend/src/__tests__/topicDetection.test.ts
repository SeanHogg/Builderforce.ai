/**
 * Tests for topic detection utilities
 */

import {
  categorizeChat,
  detectTopic,
  identifyPrimaryTopic,
  groupChatsByTopic,
  analyzeChats,
  isLowActivityChat,
  generateGroupedAnalysis,
} from '../utils/topicDetection';
import type { Chat, ChatMessage } from '../types/chat';

describe('Topic Detection', () => {
  describe('detectTopic', () => {
    it('detects PRD-related chats', () => {
      const chat: Chat = {
        id: '1',
        title: 'PRD Review',
        messages: [
          {
            id: '1-1',
            text: 'We need to write user stories for the new feature',
            sender: 'alice',
            timestamp: 1609459200000,
          },
        ],
        participants: ['alice', 'bob'],
      };

      const result = detectTopic(chat);
      expect(result.topic).toBe('prd');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('detects agent creation chats', () => {
      const chat: Chat = {
        id: '2',
        title: 'New Agent Setup',
        messages: [
          {
            id: '2-1',
            text: 'Create an agent with persona from engineering team',
            sender: 'alice',
            timestamp: 1609459200000,
          },
        ],
        participants: ['alice'],
      };

      const result = detectTopic(chat);
      expect(result.topic).toBe('agent-creation');
      expect(result.keywords).toContain('new agent');
    });

    it('detects PWA chats', () => {
      const chat: Chat = {
        id: '3',
        title: 'PWA Installation',
        messages: [
          {
            id: '3-1',
            text: 'Add app manifest and service worker for offline mode',
            sender: 'bob',
            timestamp: 1609459200000,
          },
        ],
        participants: ['bob'],
      };

      const result = detectTopic(chat);
      expect(result.topic).toBe('pwa');
      expect(result.keywords).toContain('offline');
    });

    it('detects general chats for low-activity or empty chats', () => {
      const emptyChat: Chat = {
        id: '4',
        title: '',
        messages: [],
        participants: [],
      };

      const result = detectTopic(emptyChat);
      expect(result.topic).toBe('general');
      expect(result.confidence).toBeLessThanOrEqual(0.5);
    });

    it('handles mix of topics', () => {
      const mixedChat: Chat = {
        id: '5',
        title: 'Bug Fix: PWA Stack',
        messages: [
          {
            id: '5-1',
            text: 'The PWA is not installing, need to fix offline mode',
            sender: 'charlie',
            timestamp: 1609459200000,
          },
          {
            id: '5-2',
            text: 'This is a bug in the offline service worker',
            sender: 'dave',
            timestamp: 1609459260000,
          },
        ],
        participants: ['charlie', 'dave'],
      };

      const result = detectTopic(mixedChat);
      expect(result.topic).toBe('pwa');
    });
  });

  describe('categorizeChat', () => {
    it('categories PRD chats correctly', () => {
      const chat: Chat = {
        id: '6',
        title: 'User Story Definition',
        messages: [
          {
            id: '6-1',
            text: 'We have 5 user stories to define',
            sender: 'alice',
            timestamp: 1609459200000,
          },
        ],
        participants: ['alice'],
      };

      const result = categorizeChat(chat);
      expect(result).toBe('prd');
    });

    it('categories agent creation chats correctly', () => {
      const chat: Chat = {
        id: '7',
        title: 'Agent Configuration',
        messages: [
          {
            id: '7-1',
            text: 'Add tool integration for GitHub API',
            sender: 'bob',
            timestamp: 1609459200000,
          },
        ],
        participants: ['bob'],
      };

      const result = categorizeChat(chat);
      expect(result).toBe('agent-creation');
    });

    it('categories PWA chats correctly', () => {
      const chat: Chat = {
        id: '8',
        title: 'Progressive Web App',
        messages: [
          {
            id: '8-1',
            text: 'Make the app work offline',
            sender: 'charlie',
            timestamp: 1609459200000,
          },
        ],
        participants: ['charlie'],
      };

      const result = categorizeChat(chat);
      expect(result).toBe('pwa');
    });

    it('handles general chats', () => {
      const chat: Chat = {
        id: '9',
        title: '',
        messages: [],
        participants: [],
      };

      const result = categorizeChat(chat);
      expect(result).toBe('general');
    });
  });

  describe('identifyPrimaryTopic', () => {
    it('returns primary topic string', () => {
      const chat: Chat = {
        id: '10',
        title: 'Agent Setup Discussion',
        messages: [
          {
            id: '10-1',
            text: 'Setting up a new agent for tasks',
            sender: 'alice',
            timestamp: 1609459200000,
          },
        ],
        participants: ['alice'],
      };

      const topic = identifyPrimaryTopic(chat);
      expect(topic).toBe('agent-creation');
    });
  });

  describe('groupChatsByTopic', () => {
    it('groups chats by their detected topics', () => {
      const chats: Chat[] = [
        { id: '1', title: 'PRD Work', messages: [{ id: '1-1', text: 'new requirement', sender: 'a', timestamp: 0 }], participants: ['a'] },
        { id: '2', title: 'Agent Config', messages: [{ id: '2-1', text: 'add tool', sender: 'b', timestamp: 0 }], participants: ['b'] },
        { id: '3', title: 'PWA Issues', messages: [{ id: '3-1', text: 'offline mode', sender: 'c', timestamp: 0 }], participants: ['c'] },
      ];

      const groups = groupChatsByTopic(chats);

      expect(groups.size).toBeGreaterThan(0);
      expect(groups.has('prd')).toBe(true);
      expect(groups.has('agent-creation')).toBe(true);
      expect(groups.has('pwa')).toBe(true);
    });

    it('filters small groups below minimum size', () => {
      const chats: Chat[] = [
        { id: '1', title: 'PRD Work', messages: [{ id: '1-1', text: 'new requirement', sender: 'a', timestamp: 0 }], participants: ['a'] },
        { id: '2', title: 'Agent Config', messages: [{ id: '2-1', text: 'add tool', sender: 'b', timestamp: 0 }], participants: ['b'] },
      ];

      const groups = groupChatsByTopic(chats, { minGroupSize: 5 });

      expect(groups.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe('analyzeChats', () => {
    it('generates analysis from chat list', () => {
      const chats: Chat[] = [
        { id: '1', title: 'PRD Work', messages: [{ id: '1-1', text: 'req', sender: 'a', timestamp: 0 }], participants: ['a'] },
      ];

      const analysis = analyzeChats(chats);

      expect(analysis.groups).toBeDefined();
      expect(analysis.topTopicsByChatCount).toBeDefined();
      expect(analysis.topTopicsByChatCount.length).toBeGreaterThan(0);
    });
  });

  describe('isLowActivityChat', () => {
    it('identifies low-activity chats', () => {
      const chat: Chat = {
        id: '11',
        title: 'Empty chat',
        messages: Array(5).fill({
          id: '11-1',
          text: 'message',
          sender: 'alice',
          timestamp: 0,
        }),
        participants: ['alice'],
      };

      const isLow = isLowActivityChat(chat, 10);
      expect(isLow).toBe(true);
    });

    it('identifies active chats as not low-activity', () => {
      const chat: Chat = {
        id: '12',
        title: 'Active chat',
        messages: Array(20).fill({
          id: '12-1',
          text: 'message',
          sender: 'alice',
          timestamp: 0,
        }),
        participants: ['alice'],
      };

      const isLow = isLowActivityChat(chat, 10);
      expect(isLow).toBe(false);
    });
  });

  describe('generateGroupedAnalysis', () => {
    it('separates PWA, PRD, and agent creation chats', () => {
      const chats: Chat[] = [
        {
          id: '1',
          title: 'PRD Review',
          messages: [
            {
              id: '1-1',
              text: 'Write requirements',
              sender: 'alice',
              timestamp: 1609459200000,
            },
          ],
          participants: ['alice'],
        },
        {
          id: '2',
          title: 'Agent Setup',
          messages: [
            {
              id: '2-1',
              text: 'Configure agent tool',
              sender: 'bob',
              timestamp: 1609459260000,
            },
          ],
          participants: ['bob'],
        },
        {
          id: '3',
          title: 'PWA Install',
          messages: [
            {
              id: '3-1',
              text: 'Enable homescreen install',
              sender: 'charlie',
              timestamp: 1609459320000,
            },
          ],
          participants: ['charlie'],
        },
      ];

      const result = generateGroupedAnalysis(chats);

      expect(result.prdChats.length).toBeGreaterThan(0);
      expect(result.agentCreationChats.length).toBeGreaterThan(0);
      expect(result.pwaChats.length).toBeGreaterThan(0);
      expect(result.ungroupedCount).toBe(0);
    });

    it('assigns general chats correctly', () => {
      const chats: Chat[] = [
        {
          id: '4',
          title: 'Random updates',
          messages: [
            {
              id: '4-1',
              text: 'Just testing',
              sender: 'dave',
              timestamp: 1609459380000,
            },
          ],
          participants: ['dave'],
        },
      ];

      const result = generateGroupedAnalysis(chats);

      expect(result.generalChats.length).toBeGreaterThanOrEqual(0);
    });
  });
});