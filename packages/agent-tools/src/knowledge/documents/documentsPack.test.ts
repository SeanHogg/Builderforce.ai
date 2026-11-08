import { describe, expect, it } from 'vitest';
import type { SourceDocument } from '@seanhogg/builderforce-memory/ingest';
import { documentsParser } from './documentsPack.js';
import { EXTRACTABLE_DOCUMENT_MEDIA_TYPES } from './documentText.js';

const doc = (mediaType: string): SourceDocument => ({ id: 'a', tenantId: 't', title: 'a', content: { kind: 'text', text: 'x', mediaType } });

describe('documentsParser', () => {
    it('claims every extractable type', () => {
        for (const type of EXTRACTABLE_DOCUMENT_MEDIA_TYPES) expect(documentsParser.accepts(doc(type))).toBe(true);
    });

    it('rejects legacy office types, which can never be extracted', () => {
        for (const type of ['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint']) {
            expect(documentsParser.accepts(doc(type))).toBe(false);
        }
    });
});
