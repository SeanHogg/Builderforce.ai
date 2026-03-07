'use client';

import { useState, useRef, useEffect } from 'react';
import type { AIMessage } from '@/lib/types';
import { sendAIMessage } from '@/lib/api';

interface AIChatProps {
  projectId: string;
}

export function AIChat({ projectId }: AIChatProps) {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    const userMessage: AIMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const assistantMessage: AIMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
    };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      await sendAIMessage(
        projectId,
        [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
        (chunk) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMessage.id
                ? { ...m, content: m.content + chunk }
                : m
            )
          );
        }
      );
    } catch {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMessage.id
            ? { ...m, content: 'Error: Failed to get response.' }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <div className="px-3 py-2 border-b border-gray-700">
        <h2 className="text-sm font-semibold text-gray-300">AI Assistant</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 text-sm mt-8">
            <div className="text-3xl mb-2">🤖</div>
            <p>Ask me anything about your code!</p>
          </div>
        )}
        {messages.map(message => (
          <div
            key={message.id}
            className={`rounded-lg p-3 text-sm ${
              message.role === 'user'
                ? 'bg-blue-900 text-blue-100 ml-4'
                : 'bg-gray-800 text-gray-200 mr-4'
            }`}
          >
            <div className="font-semibold mb-1 text-xs opacity-70">
              {message.role === 'user' ? 'You' : '🤖 AI'}
            </div>
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.content === '' && (
          <div className="bg-gray-800 rounded-lg p-3 text-sm text-gray-400 mr-4">
            <div className="font-semibold mb-1 text-xs opacity-70">🤖 AI</div>
            <span className="animate-pulse">Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-3 border-t border-gray-700">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Ask AI... (Enter to send)"
            className="flex-1 bg-gray-800 text-white text-sm rounded px-3 py-2 resize-none outline-none border border-gray-700 focus:border-blue-500"
            rows={2}
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 rounded text-sm"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
