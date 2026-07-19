import { describe, it, expect } from 'vitest';
import { extractCsv, replyHasArtifact } from './messageExport';

/** The exact reply that prompted this fix: a title line, no chart, 77 chars. */
const STUB = 'Project tasks status distribution (fetched for BuilderForce.AI / project 11):';

const CHART = `Most tasks are still open.

\`\`\`mermaid
pie title Task status
  "Open" : 12
  "Done" : 4
\`\`\`

| Status | Count |
| --- | --- |
| Open | 12 |
| Done | 4 |
`;

describe('replyHasArtifact', () => {
  it('rejects the title-only stub for a chart capability', () => {
    expect(replyHasArtifact('dataviz', STUB)).toBe(false);
  });

  it('accepts a reply that actually contains the chart', () => {
    expect(replyHasArtifact('dataviz', CHART)).toBe(true);
  });

  it('accepts figures without a diagram — a table is the data behind the chart', () => {
    expect(replyHasArtifact('dataviz', '| A | B |\n| --- | --- |\n| 1 | 2 |')).toBe(true);
  });

  it('requires slide headings for a deck, not just prose', () => {
    expect(replyHasArtifact('slides', 'Here is your deck about the launch.')).toBe(false);
    expect(replyHasArtifact('slides', '## Why now\n- point')).toBe(true);
  });

  it('requires a table or csv for a spreadsheet', () => {
    expect(replyHasArtifact('spreadsheet', 'I would put revenue in column A.')).toBe(false);
    expect(replyHasArtifact('spreadsheet', '```csv\na,b\n1,2\n```')).toBe(true);
  });

  it('requires a fenced file for the IDE capabilities', () => {
    expect(replyHasArtifact('website', 'You should build a landing page.')).toBe(false);
    expect(replyHasArtifact('website', '```src/App.tsx\nexport default () => null;\n```')).toBe(true);
  });

  it('treats a bare heading as an undelivered document', () => {
    expect(replyHasArtifact('document', '# Q3 Plan')).toBe(false);
    expect(replyHasArtifact('document', `# Q3 Plan\n\n${'Real content. '.repeat(20)}`)).toBe(true);
  });

  it('never blocks a chat with no capability, or an unknown one', () => {
    expect(replyHasArtifact(null, STUB)).toBe(true);
    expect(replyHasArtifact('not-a-capability', STUB)).toBe(true);
  });

  it('has no verdict to give on empty content', () => {
    expect(replyHasArtifact('dataviz', '   ')).toBe(false);
  });
});

describe('extractCsv', () => {
  it('prefers the csv fence', () => {
    expect(extractCsv('text\n```csv\na,b\n1,2\n```')).toBe('a,b\n1,2');
  });

  it('falls back to the first markdown table, escaping quotes', () => {
    const csv = extractCsv('| Name | Note |\n| --- | --- |\n| A | say "hi" |');
    expect(csv).toBe('"Name","Note"\r\n"A","say ""hi"""');
  });

  it('returns null when there is no tabular data', () => {
    expect(extractCsv('just prose')).toBeNull();
  });
});
