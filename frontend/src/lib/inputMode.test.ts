import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateField,
  validateGroup,
  validateAll,
  parseDelimitedPaste,
  parseCsvUpload,
  parseJsonUpload,
  buildInitialValues,
  coercePayload,
  parseQueryPrefill,
  getStoredInputMode,
  setStoredInputMode,
  listSavedTemplates,
  saveTemplate,
  deleteTemplate,
  loadTemplate,
  type FieldGroup,
  type FormSchema,
  type FieldDefinition,
} from './inputMode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleFieldEmail: FieldDefinition = {
  key: 'email',
  label: 'Email',
  type: 'email',
  required: true,
};

const sampleFieldName: FieldDefinition = {
  key: 'name',
  label: 'Name',
  type: 'text',
  required: true,
  min: 2,
  max: 100,
};

const sampleGroup: FieldGroup = {
  key: 'personal',
  title: 'Personal Info',
  fields: [sampleFieldName, sampleFieldEmail],
};

const sampleSchema: FormSchema = {
  endpoint: '/api/submit',
  groups: [
    sampleGroup,
    {
      key: 'details',
      title: 'Details',
      fields: [
        { key: 'age', label: 'Age', type: 'number', required: false, min: 0, max: 150 },
        { key: 'url', label: 'Website', type: 'url', required: false },
        { key: 'notes', label: 'Notes', type: 'textarea', required: false },
        { key: 'agree', label: 'Agree to terms', type: 'checkbox', required: true },
      ],
    },
  ],
};

function storageProxy(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    length: store.size,
    key: () => null,
  } as unknown as Storage;
}

// ---------------------------------------------------------------------------
// validateField
// ---------------------------------------------------------------------------

describe('validateField', () => {
  it('returns required error when empty and required', () => {
    expect(validateField(sampleFieldName, '')).toMatchObject({ field: 'name' });
  });

  it('returns null when empty but not required', () => {
    const f = { ...sampleFieldName, required: false };
    expect(validateField(f, '')).toBeNull();
  });

  it('returns null for valid text', () => {
    expect(validateField(sampleFieldName, 'Alice')).toBeNull();
  });

  it('returns min length error', () => {
    expect(validateField(sampleFieldName, 'A')).toMatchObject({ field: 'name' });
  });

  it('returns max length error', () => {
    const long = 'A'.repeat(200);
    expect(validateField(sampleFieldName, long)).toMatchObject({ field: 'name' });
  });

  it('validates email shape', () => {
    expect(validateField(sampleFieldEmail, 'not-email')).toMatchObject({ field: 'email' });
    expect(validateField(sampleFieldEmail, 'a@b.c')).toBeNull();
  });

  it('validates URL shape', () => {
    const urlField: FieldDefinition = { key: 'url', label: 'Site', type: 'url' };
    expect(validateField(urlField, 'not-url')).toMatchObject({ field: 'url' });
    expect(validateField(urlField, 'https://example.com')).toBeNull();
  });

  it('validates number type and bounds', () => {
    const nf: FieldDefinition = { key: 'n', label: 'N', type: 'number', required: true, min: 0, max: 100 };
    expect(validateField(nf, 'abc')).toMatchObject({ field: 'n' });
    expect(validateField(nf, '-1')).toMatchObject({ field: 'n' });
    expect(validateField(nf, '200')).toMatchObject({ field: 'n' });
    expect(validateField(nf, '50')).toBeNull();
  });

  it('validates date type', () => {
    const df: FieldDefinition = { key: 'd', label: 'Date', type: 'date', required: true };
    expect(validateField(df, 'not-a-date')).toMatchObject({ field: 'd' });
    expect(validateField(df, '2024-01-01')).toBeNull();
  });

  it('validates regex pattern', () => {
    const pf: FieldDefinition = {
      key: 'code',
      label: 'Code',
      type: 'text',
      required: true,
      pattern: '^[A-Z]{3}$',
    };
    expect(validateField(pf, 'ab')).toMatchObject({ field: 'code' });
    expect(validateField(pf, 'ABC')).toBeNull();
  });

  it('skips invalid regex without throwing', () => {
    const pf: FieldDefinition = {
      key: 'code',
      label: 'Code',
      type: 'text',
      required: true,
      pattern: '[invalid',
    };
    expect(() => validateField(pf, 'anything')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateGroup / validateAll
// ---------------------------------------------------------------------------

describe('validateGroup', () => {
  it('returns errors for invalid fields in a group', () => {
    const errors = validateGroup(sampleGroup, { name: '', email: 'bad' });
    expect(errors.length).toBe(2);
  });

  it('returns no errors for valid values', () => {
    const errors = validateGroup(sampleGroup, { name: 'Alice', email: 'a@b.c' });
    expect(errors.length).toBe(0);
  });
});

describe('validateAll', () => {
  it('aggregates errors across all groups', () => {
    const errors = validateAll(sampleSchema, {
      name: '',
      email: '',
      agree: false,
    });
    // Required fields: name, email, agree (checkbox false becomes '' in string coercion but boolean)
    // checkbox validation currently requires non-empty; false will still be '', so error
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.some((e) => e.field === 'name')).toBe(true);
    expect(errors.some((e) => e.field === 'email')).toBe(true);
  });

  it('passes with all valid values', () => {
    const errors = validateAll(sampleSchema, {
      name: 'Alice',
      email: 'a@b.c',
      age: '30',
      url: 'https://example.com',
      notes: 'hi',
      agree: true,
    });
    expect(errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseDelimitedPaste
// ---------------------------------------------------------------------------

describe('parseDelimitedPaste', () => {
  const keys = new Set(['name', 'email', 'age']);

  it('parses key:value lines', () => {
    const text = 'name: Alice\nemail: alice@example.com';
    const r = parseDelimitedPaste(text, keys);
    expect(r.values['name']).toBe('Alice');
    expect(r.values['email']).toBe('alice@example.com');
  });

  it('parses key=value lines', () => {
    const text = 'name=Alice\nage=30';
    const r = parseDelimitedPaste(text, keys);
    expect(r.values['name']).toBe('Alice');
    expect(r.values['age']).toBe('30');
  });

  it("parses CSV header+row (FR-3.2)", () => {
    const text = '\"name\",\"email\",\"age\"\n\"Alice\",\"alice@example.com\",\"30\"';
    const r = parseDelimitedPaste(text, keys);
    expect(r.values['name']).toBe('Alice');
    expect(r.values['email']).toBe('alice@example.com');
    expect(r.values['age']).toBe('30');
  });

  it('flags unmatched keys', () => {
    const text = 'unknownField: hello\nname: Alice';
    const r = parseDelimitedPaste(text, keys);
    expect(r.unmatched).toContain('unknownField');
    expect(r.values['name']).toBe('Alice');
  });

  it('returns warning when no data', () => {
    const r = parseDelimitedPaste('', keys);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('handles unmatched flag with no matched fields', () => {
    const text = 'zzz: yyy';
    const r = parseDelimitedPaste(text, keys);
    expect(r.unmatched.length).toBeGreaterThan(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// CSV / JSON upload
// ---------------------------------------------------------------------------

describe('parseCsvUpload', () => {
  const keys = new Set(['name', 'email']);

  it('parses CSV with header row', () => {
    const csv = '\"name\",\"email\"\n\"Bob\",\"bob@example.com\"';
    const r = parseCsvUpload(csv, keys);
    expect(r.values['name']).toBe('Bob');
    expect(r.values['email']).toBe('bob@example.com');
    expect(r.unmappedColumns.length).toBe(0);
  });

  it('flags unmapped columns', () => {
    const csv = '\"name\",\"unknown\"\n\"Bob\",\"x\"';
    const r = parseCsvUpload(csv, keys);
    expect(r.unmappedColumns).toContain('unknown');
  });
});

describe('parseJsonUpload', () => {
  const keys = new Set(['name', 'email']);

  it('parses flat JSON object', () => {
    const json = JSON.stringify({ name: 'Carol', email: 'carol@example.com' });
    const r = parseJsonUpload(json, keys);
    expect(r.values['name']).toBe('Carol');
    expect(r.values['email']).toBe('carol@example.com');
  });

  it('flags unmapped JSON keys', () => {
    const json = JSON.stringify({ name: 'Carol', other: 'x' });
    const r = parseJsonUpload(json, keys);
    expect(r.unmappedColumns).toContain('other');
  });

  it('warns on invalid JSON', () => {
    const r = parseJsonUpload('not json', keys);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('warns when JSON is array', () => {
    const r = parseJsonUpload('[1,2,3]', keys);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildInitialValues
// ---------------------------------------------------------------------------

describe('buildInitialValues', () => {
  it('builds defaults from schema', () => {
    const v = buildInitialValues(sampleSchema);
    expect(v['name']).toBe('');
    expect(v['age']).toBe('');
    // checkbox default false
    expect(v['agree']).toBe(false);
  });

  it('uses explicit defaultValue', () => {
    const schema: FormSchema = {
      endpoint: '/api/x',
      groups: [
        {
          key: 'g',
          title: 'G',
          fields: [{ key: 'foo', label: 'Foo', type: 'text', defaultValue: 'bar' }],
        },
      ],
    };
    const v = buildInitialValues(schema);
    expect(v['foo']).toBe('bar');
  });
});

// ---------------------------------------------------------------------------
// coercePayload / parseQueryPrefill
// ---------------------------------------------------------------------------

describe('coercePayload', () => {
  it('coerces number', () => {
    expect(coercePayload('42', 'number')).toBe(42);
    expect(coercePayload('abc', 'number')).toBe('abc');
  });

  it('coerces checkbox truthy', () => {
    expect(coercePayload('true', 'checkbox')).toBe(true);
    expect(coercePayload('1', 'checkbox')).toBe(true);
    expect(coercePayload('false', 'checkbox')).toBe(false);
  });

  it('returns raw string for text', () => {
    expect(coercePayload('hi', 'text')).toBe('hi');
  });

  it('returns empty string for blank input', () => {
    expect(coercePayload('', 'text')).toBe('');
  });
});

describe('parseQueryPrefill', () => {
  it('prefills values from URLSearchParams', () => {
    const sp = new URLSearchParams({ name: 'Alice', email: 'alice@example.com', junk: 'no' });
    const vals = parseQueryPrefill(sp, sampleSchema);
    expect(vals['name']).toBe('Alice');
    expect(vals['email']).toBe('alice@example.com');
    expect(vals['junk']).toBeUndefined();
  });

  it('ignores empty query values', () => {
    const sp = new URLSearchParams({ name: '' });
    const vals = parseQueryPrefill(sp, sampleSchema);
    expect(vals['name']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Mode persistence
// ---------------------------------------------------------------------------

describe('getStoredInputMode / setStoredInputMode', () => {
  let prevLocalStorage: Storage | undefined;

  beforeEach(() => {
    // Save real localStorage if exists
    prevLocalStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    const store = storageProxy();
    Object.defineProperty(globalThis, 'localStorage', {
      value: store,
      writable: true,
      configurable: true,
    });
    // Polyfill window.localStorage
    (globalThis as unknown as Record<string, unknown>).window = {
      localStorage: store,
    };
  });

  afterEach(() => {
    if (prevLocalStorage !== undefined) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: prevLocalStorage,
        writable: true,
        configurable: true,
      });
    } else {
      try {
        delete (globalThis as unknown as Record<string, unknown>).localStorage;
      } catch {
        // ignore
      }
    }
    try {
      delete (globalThis as unknown as Record<string, unknown>).window;
    } catch {
      // ignore
    }
  });

  it('setStoredInputMode stores guided / express', () => {
    setStoredInputMode('guided');
    expect(getStoredInputMode()).toBe('guided');
    setStoredInputMode('express');
    expect(getStoredInputMode()).toBe('express');
  });
});

// ---------------------------------------------------------------------------
// Saved templates
// ---------------------------------------------------------------------------

describe('saved templates', () => {
  let prevLocalStorage: Storage | undefined;

  beforeEach(() => {
    prevLocalStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    const store = storageProxy();
    Object.defineProperty(globalThis, 'localStorage', {
      value: store,
      writable: true,
      configurable: true,
    });
    (globalThis as unknown as Record<string, unknown>).window = {
      localStorage: store,
    };
  });

  afterEach(() => {
    if (prevLocalStorage !== undefined) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: prevLocalStorage,
        writable: true,
        configurable: true,
      });
    } else {
      try {
        delete (globalThis as unknown as Record<string, unknown>).localStorage;
      } catch {
        // ignore
      }
    }
    try {
      delete (globalThis as unknown as Record<string, unknown>).window;
    } catch {
      // ignore
    }
  });

  it('saves and lists templates', () => {
    saveTemplate('t1', { name: 'Alice' });
    const all = listSavedTemplates();
    expect(all.some((t) => t.name === 't1')).toBe(true);
    const loaded = loadTemplate('t1');
    expect(loaded).toMatchObject({ name: 'Alice' });
  });

  it('overwrites template with same name', () => {
    saveTemplate('dup', { name: 'Alice' });
    saveTemplate('dup', { name: 'Bob' });
    const all = listSavedTemplates();
    const matching = all.filter((t) => t.name === 'dup');
    expect(matching.length).toBe(1);
    expect(matching[0].values).toMatchObject({ name: 'Bob' });
  });

  it('deletes a template', () => {
    saveTemplate('todel', { name: 'del' });
    deleteTemplate('todel');
    expect(listSavedTemplates().some((t) => t.name === 'todel')).toBe(false);
  });

  it('loadTemplate returns null for missing template', () => {
    expect(loadTemplate('missing')).toBeNull();
  });
});
