/**
 * The chat's open questions for the person, each answered in place.
 */
import { useState } from 'react';
import { V } from './tokens';
import { S } from './panelStyles';
import type { ChatQuestionVM, ChatTicketsLabels } from './types';

export function QuestionsSection({ questions, labels, onAnswer }: {
  questions: ChatQuestionVM[];
  labels: ChatTicketsLabels;
  onAnswer: (id: string, answer: string) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  return (
    <div style={S.drawer}>
      {questions.length === 0 ? <span style={S.muted}>{labels.noQuestions}</span> : questions.map((q, index) => {
        const value = answers[q.id] ?? '';
        return <div key={q.id} style={{ padding: '10px 0', borderBottom: index < questions.length - 1 ? `1px solid ${V.border}` : undefined }}>
          <div style={{ color: V.text, fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{q.description}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <textarea value={value} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              placeholder={labels.answerPlaceholder} rows={2} disabled={sending === q.id}
              style={{ ...S.select, flex: 1, resize: 'vertical', minHeight: 54, fontFamily: 'inherit' }} />
            <button type="button" disabled={!value.trim() || sending === q.id} style={S.pill(true)} onClick={() => {
              setSending(q.id);
              void onAnswer(q.id, value.trim()).finally(() => setSending(null));
            }}>{sending === q.id ? labels.answering : labels.submitAnswer}</button>
          </div>
        </div>;
      })}
    </div>
  );
}
