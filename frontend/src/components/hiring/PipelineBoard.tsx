/**
 * The board: candidates by stage, for one posting's pipeline.
 *
 * ── THE COLUMNS COME FROM THE SERVER ─────────────────────────────────────────────
 * `board.columns` is the stage ladder as the API computed it, including any stage this
 * tenant invented. Nothing here hardcodes "screen" or "offer": a component with its own
 * copy of the ladder draws a column nobody uses beside a column that is missing, the first
 * time a workspace renames a stage.
 *
 * ── A MOVE IS A MOVE; A DECISION IS A DECISION ───────────────────────────────────
 * The column selector on a card moves somebody, and that is all it does. Rejecting,
 * offering and hiring are NOT on the card — they are in the drawer, behind a rationale,
 * because they are the moves somebody is accountable for. Putting them on a hover menu
 * beside "screen" would make the accountable act the same gesture as tidying a column.
 *
 * No `'use client'` of its own: this module is only ever imported by `HiringClient`,
 * which carries the boundary for the whole surface.
 */
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { Select } from '@/components/Select';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle } from '@/components/dataTableStyles';
import type { AtsBoard, AtsCard } from '@/lib/hiringApi';
import { cardStyle, chipStyle, mutedStyle, candidateLabel } from './hiringStyles';

export interface PipelineBoardProps {
  board: AtsBoard;
  view: 'board' | 'table';
  busyCandidateRef: string | null;
  onOpenCandidate: (card: AtsCard) => void;
  onMove: (card: AtsCard, toStage: string) => void;
}

/** Every stage on the board, for the per-card move control. */
function stageOptions(board: AtsBoard): string[] {
  return board.columns.map((column) => column.stage);
}

export function PipelineBoard({ board, view, busyCandidateRef, onOpenCandidate, onMove }: PipelineBoardProps) {
  const t = useTranslations('ats');
  const stages = stageOptions(board);

  if (board.totalOpen === 0) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center', padding: 32 }}>
        <p style={{ fontSize: 'var(--font-size-body)', fontWeight: 600, margin: 0 }}>{t('board.emptyTitle')}</p>
        <p style={{ ...mutedStyle, marginTop: 6 }}>{t('board.emptyBody')}</p>
      </div>
    );
  }

  if (view === 'table') return <BoardTable board={board} stages={stages} busyCandidateRef={busyCandidateRef} onOpenCandidate={onOpenCandidate} onMove={onMove} />;

  return (
    // Horizontal scroll on the BOARD, never on the page: a six-column pipeline does not
    // fit a 360px phone, and the fix is a scrolling rail rather than a page that shifts.
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
      {board.columns.map((column) => (
        <section
          key={column.stage}
          aria-label={column.stage}
          style={{
            flex: '0 0 min(280px, 78vw)',
            minWidth: 0,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <h3 style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, margin: 0, textTransform: 'capitalize' }}>{column.stage}</h3>
            <span style={chipStyle}>{column.cards.length}</span>
          </header>
          {column.cards.length === 0 ? (
            <p style={{ ...mutedStyle, margin: 0 }}>{t('board.columnEmpty')}</p>
          ) : (
            column.cards.map((card) => (
              <CandidateCard
                key={card.entryId}
                card={card}
                stages={stages}
                busy={busyCandidateRef === card.candidateRef}
                onOpen={() => onOpenCandidate(card)}
                onMove={(toStage) => onMove(card, toStage)}
              />
            ))
          )}
        </section>
      ))}
    </div>
  );
}

function CandidateCard({
  card, stages, busy, onOpen, onMove,
}: { card: AtsCard; stages: string[]; busy: boolean; onOpen: () => void; onMove: (toStage: string) => void }) {
  const t = useTranslations('ats');
  return (
    <article style={{ ...cardStyle, padding: 10, opacity: busy ? 0.6 : 1 }}>
      <button
        type="button"
        onClick={onOpen}
        style={{
          all: 'unset', cursor: 'pointer', display: 'block', width: '100%',
          fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word',
        }}
      >
        {candidateLabel(card.headline, card.candidateRef)}
      </button>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {/* Age in stage is the number a recruiter acts on — it is what a stalled
            candidate looks like before anybody has called them stalled. */}
        <span style={chipStyle}>{t('card.days', { days: card.daysInStage })}</span>
        {card.yearsExp === null ? null : <span style={chipStyle}>{t('card.years', { years: card.yearsExp })}</span>}
        {card.source ? <span style={chipStyle}>{card.source}</span> : null}
      </div>
      {card.skills.length > 0 && (
        <p style={{ ...mutedStyle, marginTop: 6, marginBottom: 0 }}>{card.skills.slice(0, 4).join(' · ')}</p>
      )}
      <RoleGate capability="hiring.manage" style={{ display: 'block', marginTop: 8, width: '100%' }}>
        <Select
          aria-label={t('card.moveTo')}
          value={card.stage}
          disabled={busy}
          onChange={(event) => onMove(event.target.value)}
          style={{
            width: '100%', fontSize: 'var(--font-size-small)', padding: '5px 8px',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
            background: 'var(--bg-base)', color: 'var(--text-primary)',
          }}
        >
          {stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
        </Select>
      </RoleGate>
    </article>
  );
}

/** The same rows as a list, for anybody scanning a long pipeline rather than working it. */
function BoardTable({
  board, stages, busyCandidateRef, onOpenCandidate, onMove,
}: { board: AtsBoard; stages: string[]; busyCandidateRef: string | null; onOpenCandidate: (card: AtsCard) => void; onMove: (card: AtsCard, toStage: string) => void }) {
  const t = useTranslations('ats');
  const rows = board.columns.flatMap((column) => column.cards);
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={thStyle}>{t('table.candidate')}</th>
            <th style={thStyle}>{t('table.stage')}</th>
            <th style={thStyle}>{t('table.days')}</th>
            <th style={thStyle}>{t('table.source')}</th>
            <th style={thStyle}>{t('table.move')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((card) => (
            <tr key={card.entryId} style={trStyle}>
              <td style={tdStyle}>
                <button
                  type="button"
                  onClick={() => onOpenCandidate(card)}
                  style={{ all: 'unset', cursor: 'pointer', fontWeight: 600, color: 'var(--text-primary)' }}
                >
                  {candidateLabel(card.headline, card.candidateRef)}
                </button>
              </td>
              <td style={tdStyle}><span style={chipStyle}>{card.stage}</span></td>
              <td style={tdStyle}>{t('card.days', { days: card.daysInStage })}</td>
              <td style={tdStyle}>{card.source ?? t('table.unattributed')}</td>
              <td style={tdStyle}>
                <RoleGate capability="hiring.manage">
                  <Select
                    aria-label={t('card.moveTo')}
                    value={card.stage}
                    disabled={busyCandidateRef === card.candidateRef}
                    onChange={(event) => onMove(card, event.target.value)}
                    style={{
                      fontSize: 'var(--font-size-small)', padding: '4px 8px',
                      border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-base)', color: 'var(--text-primary)',
                    }}
                  >
                    {stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                  </Select>
                </RoleGate>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
