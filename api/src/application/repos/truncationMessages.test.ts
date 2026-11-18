import { describe, expect, it } from 'vitest';
import { capContent } from './sources/RepoSource';
import { editRefusalForTruncated, scanFailureForTruncated } from './truncationMessages';

describe('truncation wording (edit_file, PR security scan)', () => {
  it('a file past the read cap: rewrite it / it exceeds the limit', () => {
    expect(editRefusalForTruncated('a.ts', 'size')).toBe("'a.ts' is too large to edit safely here — rewrite it with write_file instead");
    expect(scanFailureForTruncated('a.ts', 'size')).toBe('a.ts: file exceeds the read limit and was only partly read');
  });

  it('a read the provider cut short: retry, never "too large"', () => {
    expect(editRefusalForTruncated('a.ts', 'incomplete')).toMatch(/could not be read completely .*rate limited.*retry edit_file/);
    expect(editRefusalForTruncated('a.ts', 'incomplete')).not.toMatch(/too large/);
    expect(scanFailureForTruncated('a.ts', 'incomplete')).toBe('a.ts: the provider stopped answering mid-read (e.g. rate limited), so the file was only partly read');
  });
});

// AnalysisRunnerDO samples evidence through capContent with its own cap (FILE_CONTENT_CAP).
describe('capContent (the one read cap: readRepoFile, AnalysisRunnerDO evidence)', () => {
  it('cuts past the cap and says size', () => {
    expect(capContent({ content: 'abcdef', truncated: false }, 4)).toEqual({ content: 'abcd', truncated: true, truncatedReason: 'size' });
  });

  it('keeps a source-cut read truncated with its reason, even under the cap', () => {
    expect(capContent({ content: 'ab', truncated: true, truncatedReason: 'incomplete' }, 4)).toEqual({ content: 'ab', truncated: true, truncatedReason: 'incomplete' });
    expect(capContent({ content: 'ab', truncated: true }, 4)).toEqual({ content: 'ab', truncated: true, truncatedReason: 'incomplete' });
  });

  it('a whole read under the cap is whole', () => {
    expect(capContent({ content: 'ab', truncated: false }, 4)).toEqual({ content: 'ab', truncated: false });
  });
});
