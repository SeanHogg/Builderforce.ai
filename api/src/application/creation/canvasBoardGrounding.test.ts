import { describe, expect, it } from 'vitest';
import { canvasBoardDigest, creationSessionIdFromMetadata, CANVAS_DIGEST_MAX_CHARS } from './canvasBoardGrounding';

const BOARD = 'bf886fc1-50e4-49db-8832-1d77343776a5';

describe('creationSessionIdFromMetadata', () => {
  it('reads the board the canvas tagged its message with', () => {
    expect(creationSessionIdFromMetadata(JSON.stringify({ creationSessionId: BOARD, addressedTo: { kind: 'agent' } }))).toBe(BOARD);
  });

  it('ignores a message with no board, a non-uuid, and malformed metadata', () => {
    expect(creationSessionIdFromMetadata(null)).toBeNull();
    expect(creationSessionIdFromMetadata(JSON.stringify({ addressedTo: { kind: 'agent' } }))).toBeNull();
    expect(creationSessionIdFromMetadata(JSON.stringify({ creationSessionId: "1' OR 1=1" }))).toBeNull();
    expect(creationSessionIdFromMetadata('{not json')).toBeNull();
  });
});

describe('canvasBoardDigest', () => {
  // The shape session bf886fc1 held when the CMO said there was no competitor research.
  const competitor = {
    id: 'c1', kind: 'competitor',
    content: {
      kind: 'competitor', title: 'Fooducate', status: 'Researching',
      summary: 'Closest to NutriPlan on recipe nutrition, but no grocery list or budget tracking.',
      strengths: ['Letter grading is sticky'], weaknesses: ['No grocery list generation'],
      pricingModel: 'Freemium with in-app purchases',
      sources: [{ url: 'https://example.com/fooducate', title: 'Fooducate pricing' }],
      website: 'fooducate.com',
    },
  };

  it('names every competitor card with its findings, so the agent answers from the board', () => {
    const digest = canvasBoardDigest('Food App', [competitor])!;
    expect(digest).toContain('"Food App"');
    expect(digest).toContain('[competitor] Fooducate — Researching');
    expect(digest).toContain('no grocery list or budget tracking');
    expect(digest).toContain('weaknesses: No grocery list generation');
    expect(digest).toContain('sources: Fooducate pricing: https://example.com/fooducate');
    expect(digest).toContain('never say something does not exist');
  });

  it('leaves out the conversation itself and rendering plumbing', () => {
    const digest = canvasBoardDigest('Food App', [
      competitor,
      { id: 'b', kind: 'chat', content: { kind: 'chat', title: 'Brain' } },
      { id: 'w', kind: 'browser', content: { kind: 'browser', title: 'Site', frameable: true, httpStatus: 0, agentRef: 'cmo-t14' } },
    ])!;
    expect(digest).not.toContain('[chat]');
    expect(digest).toContain('[browser] Site');
    expect(digest).not.toContain('frameable');
    expect(digest).not.toContain('cmo-t14');
  });

  it('says nothing for a board with no work on it', () => {
    expect(canvasBoardDigest('Empty', [])).toBeNull();
    expect(canvasBoardDigest('Only chat', [{ id: 'b', kind: 'chat', content: { title: 'Brain' } }])).toBeNull();
  });

  it('stays inside its budget on a huge board and says how much it showed', () => {
    const many = Array.from({ length: 400 }, (_, index) => ({
      id: `o${index}`, kind: 'note',
      content: { title: `Note ${index}`, summary: 'x'.repeat(380) },
    }));
    const digest = canvasBoardDigest('Big', many)!;
    expect(digest.length).toBeLessThan(CANVAS_DIGEST_MAX_CHARS + 1_000);
    expect(digest).toMatch(/Board objects \(400, the first \d+ shown\)/);
  });
});
