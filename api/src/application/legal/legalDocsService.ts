/**
 * Legal documents service — the SINGLE source of truth for reading, amending,
 * publishing and AI-enhancing the platform's Terms of Use / Privacy Policy.
 *
 * Legal docs are PLATFORM-GLOBAL (no tenant scope): there is exactly one active
 * `terms` and one active `privacy` row for the whole platform. This module used
 * to be copy-pasted into authRoutes (public read) AND adminRoutes (superadmin
 * CRUD); both now call these helpers, and the built-in MCP catalog reuses the
 * same amend/publish path so the Brain writes go through identical logic + guards.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { legalDocuments } from '../../infrastructure/database/schema';
import type { Env } from '../../env';
import { ideProxy, newTraceId } from '../llm/LlmProxyService';
import { logTrace } from '../llm/traceLogger';

export const LEGAL_DOC_TYPES = ['terms', 'privacy'] as const;
export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number];

export function isLegalDocType(value: unknown): value is LegalDocType {
  return value === 'terms' || value === 'privacy';
}

export const LEGAL_DOC_LABELS: Record<LegalDocType, string> = {
  terms: 'Terms of Use',
  privacy: 'Privacy Policy',
};

export type LegalDocResponse = {
  documentType: LegalDocType;
  version: string;
  title: string;
  content: string;
  publishedAt: string;
};

/** Typed error so route/MCP callers can map to an HTTP status (or a Brain-facing message). */
export class LegalDocError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'LegalDocError';
  }
}

const DEFAULT_LEGAL: Record<LegalDocType, Omit<LegalDocResponse, 'documentType'>> = {
  terms: {
    version: '1.0.0',
    title: 'Terms of Use',
    content:
      'By using Builderforce.ai, you agree to these Terms of Use. Continued use of the service indicates acceptance of current terms.',
    publishedAt: new Date(0).toISOString(),
  },
  privacy: {
    version: '1.0.0',
    title: 'Privacy Policy',
    content: 'Builderforce.ai processes account, usage, and operational metadata to provide and secure the service.',
    publishedAt: new Date(0).toISOString(),
  },
};

/**
 * Strip a wrapping Markdown code fence (```markdown … ``` or bare ``` … ```) that
 * an LLM or a paste sometimes wraps a whole document in — so the STORED value is
 * clean prose for every consumer (public render, exports, Copy), not just one path.
 * Idempotent: already-clean prose passes through unchanged.
 */
export function stripMarkdownFence(raw: string): string {
  const s = raw.trim();
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```$/i.exec(s);
  return (fence ? fence[1] ?? s : s).trim();
}

export async function getActiveLegalDoc(db: Db, documentType: LegalDocType): Promise<LegalDocResponse> {
  const [doc] = await db
    .select({
      version: legalDocuments.version,
      title: legalDocuments.title,
      content: legalDocuments.content,
      publishedAt: legalDocuments.publishedAt,
    })
    .from(legalDocuments)
    .where(and(eq(legalDocuments.documentType, documentType), eq(legalDocuments.isActive, true)))
    .orderBy(desc(legalDocuments.publishedAt))
    .limit(1);

  if (!doc) return { documentType, ...DEFAULT_LEGAL[documentType] };

  return {
    documentType,
    version: doc.version,
    title: doc.title,
    content: doc.content,
    publishedAt: doc.publishedAt ? doc.publishedAt.toISOString() : new Date().toISOString(),
  };
}

/** Read BOTH active docs (the shape the /legal/current endpoints and MCP `legal.get` return). */
export async function getLegalCurrent(db: Db): Promise<{ terms: LegalDocResponse; privacy: LegalDocResponse }> {
  const [terms, privacy] = await Promise.all([getActiveLegalDoc(db, 'terms'), getActiveLegalDoc(db, 'privacy')]);
  return { terms, privacy };
}

/**
 * Publish a NEW version and make it the active document (the old active row is
 * deactivated). The version must not already exist for this docType.
 */
export async function publishLegalDoc(
  db: Db,
  docType: LegalDocType,
  input: { version: string; title?: string; content: string },
  publishedBy: string | null,
): Promise<LegalDocResponse> {
  const label = LEGAL_DOC_LABELS[docType];
  const version = input.version?.trim();
  const content = stripMarkdownFence(input.content ?? '');
  const title = input.title?.trim() || label;

  if (!version) throw new LegalDocError('version is required', 400);
  if (!content) throw new LegalDocError('content is required', 400);

  const [existing] = await db
    .select({ id: legalDocuments.id })
    .from(legalDocuments)
    .where(and(eq(legalDocuments.documentType, docType), eq(legalDocuments.version, version)))
    .limit(1);
  if (existing) throw new LegalDocError(`${label} version ${version} already exists`, 409);

  await db
    .update(legalDocuments)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(and(eq(legalDocuments.documentType, docType), eq(legalDocuments.isActive, true)));

  await db.insert(legalDocuments).values({
    documentType: docType,
    version,
    title,
    content,
    isActive: true,
    publishedBy,
  });

  return getActiveLegalDoc(db, docType);
}

/**
 * Amend the currently-active document in place — edit title/content (and
 * optionally the version) WITHOUT minting a new version. A changed version must
 * not collide with another row.
 */
export async function amendActiveLegalDoc(
  db: Db,
  docType: LegalDocType,
  input: { version?: string; title?: string; content: string },
): Promise<LegalDocResponse> {
  const label = LEGAL_DOC_LABELS[docType];
  const version = input.version?.trim();
  const content = stripMarkdownFence(input.content ?? '');
  const title = input.title?.trim() || label;

  if (!content) throw new LegalDocError('content is required', 400);

  const [active] = await db
    .select({ id: legalDocuments.id, version: legalDocuments.version })
    .from(legalDocuments)
    .where(and(eq(legalDocuments.documentType, docType), eq(legalDocuments.isActive, true)))
    .orderBy(desc(legalDocuments.publishedAt))
    .limit(1);

  if (!active) {
    // No active doc yet (fresh platform): publishing IS the amend — mint the row.
    return publishLegalDoc(db, docType, { version: version || DEFAULT_LEGAL[docType].version, title, content }, null);
  }

  if (version && version !== active.version) {
    const [clash] = await db
      .select({ id: legalDocuments.id })
      .from(legalDocuments)
      .where(and(eq(legalDocuments.documentType, docType), eq(legalDocuments.version, version)))
      .limit(1);
    if (clash) throw new LegalDocError(`${label} version ${version} already exists`, 409);
  }

  await db
    .update(legalDocuments)
    .set({ title, content, version: version || active.version, updatedAt: sql`now()` })
    .where(eq(legalDocuments.id, active.id));

  return getActiveLegalDoc(db, docType);
}

/**
 * AI-enhance a legal document through the shared LLM gateway. Returns clean
 * GitHub-flavored Markdown (fence-stripped). When `content` is empty it drafts a
 * complete document from scratch for the docType; otherwise it revises the given
 * text, honouring an optional plain-language `instruction`.
 */
export async function enhanceLegalContent(
  env: Env,
  executionCtx: ExecutionContext | undefined,
  opts: {
    docType: LegalDocType;
    content: string;
    instruction?: string;
    title?: string;
    tenantId?: number | null;
    userId?: string | null;
    requestIp?: string | null;
    origin?: string | null;
    userAgent?: string | null;
  },
): Promise<string> {
  const label = LEGAL_DOC_LABELS[opts.docType];
  const existing = (opts.content ?? '').trim();

  const system =
    `You are a senior technology lawyer drafting the "${label}" for Builderforce.ai, a self-hosted AI coding ` +
    `agent and B2B AI gateway platform. Produce a clear, professional, plain-English ${label} as GitHub-flavored ` +
    `Markdown. Use a top-level "# ${label}" heading, an "**Effective Date:**" line, then well-structured numbered ` +
    `sections (Definitions, Acceptable Use, Accounts, ${opts.docType === 'privacy' ? 'Data We Collect, How We Use Data, Data Sharing, Retention, Your Rights (GDPR/CCPA), ' : 'Intellectual Property, User Content, Fees, Termination, Disclaimers, Limitation of Liability, '}Governing Law, Contact). ` +
    `Be specific and legally coherent, cover GDPR and CCPA where relevant, and NEVER leave bracketed placeholders like ` +
    `"[Your Company Name]" — use "Builderforce.ai" and generic-but-complete language. Output ONLY the Markdown ` +
    `document: no preamble, no commentary, no code fence.`;

  const instruction = opts.instruction?.trim();
  const userMsg = existing
    ? `Revise and improve the following ${label}${instruction ? ` according to this instruction: "${instruction}"` : ', tightening the language and filling any gaps'}.` +
      `${opts.title ? `\nTitle: ${opts.title}` : ''}\n\n--- Current document ---\n${existing}`
    : `Draft a complete ${label} from scratch${instruction ? ` following this instruction: "${instruction}"` : ''}.` +
      `${opts.title ? `\nTitle: ${opts.title}` : ''}`;

  const traceId = newTraceId();
  const requestBody = {
    messages: [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: userMsg },
    ],
    stream: false as const,
    temperature: 0.3,
  };

  let result;
  try {
    result = await ideProxy(env).complete(requestBody, undefined, traceId);
  } catch (err) {
    throw new LegalDocError(err instanceof Error ? err.message : 'AI generation failed', 502);
  }

  if (executionCtx) {
    logTrace(env, executionCtx, {
      traceId,
      surface: 'legal-ai',
      tenantId: opts.tenantId ?? null,
      userId: opts.userId ?? null,
      result,
      streamed: false,
      requestIp: opts.requestIp ?? null,
      origin: opts.origin ?? null,
      userAgent: opts.userAgent ?? null,
      requestBody: requestBody as unknown as Record<string, unknown>,
      responseBody: null,
      errorMessage: null,
    });
  }

  const json = (await result.response.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string } }> }
    | null;
  const raw = json?.choices?.[0]?.message?.content ?? '';
  const cleaned = stripMarkdownFence(raw);
  if (!cleaned) throw new LegalDocError('AI returned an empty document', 502);
  return cleaned;
}
