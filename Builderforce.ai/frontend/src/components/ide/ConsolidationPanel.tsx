/**
 * Chat Consolidation Panel - UI for PRD #395
 *
 * Provides a UI for users to:
 * 1. View all chats in the system
 * 2. Group them by category
 * 3. Select a target chat and sources to consolidate
 * 4. Execute consolidation
 * 5. Review merge results
 */

import React, { useState, useMemo } from 'react';
import { Bell } from 'lucide-react';
import * as consolidation from '../../lib/consolidation';
import type { BrainSession } from '../../lib/__mock__/platform/chat';

interface ConsolidationPanelProps {
  projectId: number;
  chats: BrainSession[];
  onConsoleLog?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void;
}

/**
 * Category badge component
 */
function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    product: 'bg-blue-100 text-blue-800',
    user: 'bg-green-100 text-green-800',
    feature: 'bg-purple-100 text-purple-800',
    epic: 'bg-orange-100 text-orange-800',
    other: 'bg-gray-100 text-gray-800',
  };

  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[category] || colors.other}`}
    >
      {category}
    </span>
  );
}

/**
 * Message count component
 */
function MessageCount({ count }: { count: number | undefined }) {
  return (
    <div className="text-sm text-gray-500 flex items-center gap-1">
      <Bell className="w-4 h-4" />
      {count ?? 0} messages
    </div>
  );
}

/**
 * Individual chat item card
 */
function ChatCard({
  chat,
  onSelect,
  isSelected,
  isTarget,
  onSetTarget,
}: {
  chat: BrainSession;
  onSelect: (id: number) => void;
  isSelected: boolean;
  isTarget?: boolean;
  onSetTarget?: (id: number) => void;
}) {
  const selectedClass = isSelected ? 'border-blue-500 ring-2 ring-blue-500' : 'border-gray-200';
  const targetClass = isTarget ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-500' : selectedClass;

  return (
    <div
      className={`border p-3 rounded-lg cursor-pointer hover:border-blue-300 transition-all ${targetClass}`}
      onClick={() => onSelect(parseInt(chat.sessionId.split('-').pop() ?? '0'))}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1">
          <div className="font-semibold text-sm mb-1">{chat.title || 'Untitled Chat'}</div>
          <div className="text-xs text-gray-500 mb-2">
            {new Date(chat.updatedAt).toLocaleDateString()} • Updated {new Date(chat.updatedAt).toLocaleTimeString()}
          </div>
          <div className="flex flex-wrap gap-1">
            <CategoryBadge category={consolidation.getChatCategory(chat)} />
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              chat.type === 'pm_chat' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-600'
            }`}>
              {chat.type ?? 'chat'}
            </span>
          </div>
        </div>
        {isTarget && (
          <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">
            Target
          </span>
        )}
      </div>
      {onSetTarget && !isTarget && (
        <button
          onClick={(e) => { e.stopPropagation(); onSetTarget(parseInt(chat.sessionId.split('-').pop() ?? '0')); }}
          className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          Set as Target Chat
        </button>
      )}
      <MessageCount count={chat.messageCount} />
    </div>
  );
}

/**
 * Consolidation preview step
 */
function PreviewStep({ chats, onExecute, onCancel }: { chats: BrainSession[], onExecute: () => void, onCancel: () => void }) {
  const { possibleGroups } = useMemo(() => consolidation.previewConsolidation(chats), [chats]);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Review Consolidation Plan</h3>
      <p className="text-sm text-gray-600">
        The following groups of chats will be consolidated. Source chats will be merged into their respective target chats while preserving message order and structure.
      </p>

      {possibleGroups.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Bell className="w-12 h-12 mx-auto mb-2 text-gray-400" />
          <p>No consolidation opportunities found. Chat groups have already been consolidated.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {possibleGroups.map((group, idx) => (
            <div key={idx} className="border rounded-lg p-3 bg-gray-50">
              <div className="flex justify-between items-center mb-2">
                <span className="font-semibold flex items-center gap-2">
                  <CategoryBadge category={group.category} />
                  {group.category}
                </span>
                <span className="text-sm text-gray-600">{group.sourceCount} sources to merge</span>
              </div>
              <p className="text-sm text-gray-600 mb-2">{group.reason}</p>
              {group.target && (
                <div className="text-xs text-blue-600 mt-1">
                  Target: {group.target.title}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 border rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={onExecute}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Execute Consolidation
        </button>
      </div>
    </div>
  );
}

/**
 * Consolidation results step
 */
function ResultsStep({ result, onBack, onRetryError: _onRetryError }: { result: consolidation.ConsolidationResult, onBack: () => void }) {
  const overall = result.overall;
  const groups = result.groups;

  return (
    <div className="space-y-6">
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-green-800 mb-2">Consolidation Complete</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="font-medium text-green-700">{groups.length}</div>
            <div className="text-green-600">Groups Consolidated</div>
          </div>
          <div>
            <div className="font-medium text-green-700">{overall.totalMessagesMerged}</div>
            <div className="text-green-600">Total Messages Merged</div>
          </div>
        </div>
      </div>

      <h4 className="font-semibold">Consolidation Summary</h4>
      {groups.length === 0 ? (
        <div className="text-gray-500 text-center py-4">
          No consolidation was performed.
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group, idx) => (
            <div key={idx} className="border rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium capitalize flex items-center gap-2">
                  <CategoryBadge category={group.category} /> {group.category}
                </span>
                <span className="text-sm text-gray-600">{group.mergeStats.totalSources} sources</span>
              </div>
              <div className="text-sm">
                <div className="font-medium mb-1">Target: {group.target.title}</div>
                <div className="text-gray-600 text-xs">
                  {group.mergeStats.totalMessagesMerged} messages merged at {new Date(group.mergeStats.timestamp).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onBack}
        className="w-full px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200"
      >
        Back to Chat List
      </button>
    </div>
  );
}

/**
 * Main consolidation panel component
 */
export function ConsolidationPanel({ projectId, chats, onConsoleLog }: ConsolidationPanelProps) {
  const [step, setStep] = useState<'select' | 'preview' | 'results'>('select');
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [sourceChatIds, setSourceChatIds] = useState<number[]>([]);
  const [processing, setProcessing] = useState(false);
  const [consolidationResult, setConsolidationResult] = useState<consolidation.ConsolidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedChat = useMemo(
    () => chats.find((c) => parseInt(c.sessionId.split('-').pop() ?? '0') === selectedChatId),
    [chats, selectedChatId]
  );

  const handleSelectTarget = (chatId: number) => {
    setSelectedChatId(chatId);
    setSourceChatIds(chats.filter((c) => {
      const id = parseInt(c.sessionId.split('-').pop() ?? '0');
      return id !== chatId && c.type !== 'pm_chat';
    }).map((c) => parseInt(c.sessionId.split('-').pop() ?? '0')));
  };

  const handleExecuteConsolidation = async () => {
    if (!selectedChatId || sourceChatIds.length === 0) {
      setError('Please select a target chat and at least one source chat');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const result = await consolidation.consolidateChats({
        projectId,
        chats,
        preferredTargetChatId: selectedChatId,
      });

      onConsoleLog?.(`Consolidation complete: ${result.overall.totalGroups} groups`, 'success');
      setConsolidationResult(result);
      setStep('results');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      onConsoleLog?.(`Consolidation failed: ${msg}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleStartOver = () => {
    setSelectedChatId(null);
    setSourceChatIds([]);
    setConsolidationResult(null);
    setError(null);
    setStep('select');
  };

  return (
    <div className="h-full flex flex-col">
      <div className="border-b px-6 py-4">
        <h2 className="text-xl font-bold">Chat Consolidation</h2>
        <p className="text-sm text-gray-600">
          Consolidate multiple chats into a single target chat while preserving message order and structure.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {step === 'select' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-2">Step 1: Select Target Chat</h3>
              {chats.length === 0 ? (
                <p className="text-gray-500">No chats available for consolidation.</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 max-h-96 overflow-auto">
                  {chats.map((chat) => (
                    <ChatCard
                      key={chat.id}
                      chat={chat}
                      isSelected={
                        selectedChatId === parseInt(chat.sessionId.split('-').pop() ?? '0')
                      }
                      isTarget={chat.type === 'pm_chat'}
                      onSelect={handleSelectTarget}
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-2">Step 2: Select Source Chats</h3>
              {selectedChat ? (
                <>
                  <p className="text-sm text-gray-600 mb-2">
                    Target will be: <span className="font-medium">{selectedChat.title}</span>
                  </p>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 max-h-96 overflow-auto">
                    {chats
                      .filter((c) => {
                        const id = parseInt(c.sessionId.split('-').pop() ?? '0');
                        return id !== selectedChatId && c.type !== 'pm_chat';
                      })
                      .map((chat) => {
                        const id = parseInt(chat.sessionId.split('-').pop() ?? '0');
                        return (
                          <ChatCard
                            key={chat.id}
                            chat={chat}
                            isSelected={sourceChatIds.includes(id)}
                            onSetTarget={handleStartOver}
                          />
                        );
                      })}
                  </div>
                </>
              ) : (
                <p className="text-gray-500">
                  Click a chat above to select it as the target. Only non-product chats will be shown as sources.
                </p>
              )}
            </div>

            {sourceChatIds.length > 0 && selectedChat && (
              <button
                onClick={handleExecuteConsolidation}
                disabled={processing}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 font-medium"
              >
                {processing ? 'Consolidating...' : `Consolidate ${sourceChatIds.length} chats into ${selectedChat.title}`}
              </button>
            )}
          </div>
        )}

        {step === 'preview' && (
          <PreviewStep
            chats={chats}
            onExecute={handleExecuteConsolidation}
            onCancel={() => setStep('select')}
          />
        )}

        {step === 'results' && consolidationResult && (
          <ResultsStep result={consolidationResult} onBack={handleStartOver} />
        )}
      </div>

      {error && (
        <div className="border-t px-6 py-3 bg-red-50 text-red-700 text-sm">
          <div className="font-semibold mb-1">Error:</div>
          {error}
          <button
            onClick={handleStartOver}
            className="ml-2 text-red-600 underline"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

export default ConsolidationPanel;