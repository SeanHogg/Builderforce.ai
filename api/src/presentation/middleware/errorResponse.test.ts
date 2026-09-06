import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import {
  ConflictError,
  DomainError,
  NotFoundError,
  RequestValidationError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
  isClientError,
  statusOf,
} from '../../domain/shared/errors';
import {
  configureCaughtErrorReporter,
  resetCaughtErrorReporterForTests,
} from '../../application/observability/caughtErrorReporter';
import { errorHandler } from './errorHandler';
import { GENERIC_SERVER_ERROR, errorResponseBody, failResponse, refusalResponse } from './errorResponse';
import type { HonoEnv } from '../../env';

class PublisherLikeError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409, readonly details?: unknown, readonly code?: string) {
    super(message);
  }
}

describe('statusOf', () => {
  it('maps every DomainError subclass, most specific first', () => {
    expect(statusOf(new ValidationError('v'))).toBe(400);
    expect(statusOf(new RequestValidationError([]))).toBe(400);
    expect(statusOf(new UnauthorizedError())).toBe(401);
    expect(statusOf(new NotFoundError('x', 1))).toBe(404);
    expect(statusOf(new ConflictError('c'))).toBe(409);
    expect(statusOf(new ServiceUnavailableError())).toBe(503);
    expect(statusOf(new DomainError('base'))).toBe(500);
  });

  it('honours an integer status 400-599 carried on any error, and nothing else', () => {
    expect(statusOf(new PublisherLikeError('x', 409))).toBe(409);
    expect(statusOf({ status: 422 })).toBe(422);
    expect(statusOf({ status: 200 })).toBe(500);
    expect(statusOf({ status: '404' })).toBe(500);
    expect(statusOf({ status: 404.5 })).toBe(500);
    expect(statusOf(new Error('plain'))).toBe(500);
    expect(statusOf(null)).toBe(500);
    expect(statusOf('string')).toBe(500);
  });

  it('isClientError is the 4xx band', () => {
    expect(isClientError(400)).toBe(true);
    expect(isClientError(499)).toBe(true);
    expect(isClientError(500)).toBe(false);
    expect(isClientError(302)).toBe(false);
  });
});

describe('errorResponseBody', () => {
  it('renders a 4xx with its message, issues, details and code', () => {
    const validation = errorResponseBody(new RequestValidationError([{ path: 'id', message: 'bad' }], 'Invalid'));
    expect(validation).toEqual({ status: 400, body: { error: 'Invalid', issues: [{ path: 'id', message: 'bad' }] } });
    const carried = errorResponseBody(new PublisherLikeError('nope', 409, { field: 'slug' }, 'slug_taken'));
    expect(carried).toEqual({ status: 409, body: { error: 'nope', details: { field: 'slug' }, code: 'slug_taken' } });
  });

  it('never leaks a 5xx message', () => {
    expect(errorResponseBody(new Error('relation "x" does not exist'))).toEqual({ status: 500, body: { error: GENERIC_SERVER_ERROR } });
    expect(errorResponseBody({ status: 502, message: 'upstream said so' })).toEqual({ status: 502, body: { error: GENERIC_SERVER_ERROR } });
  });
});

describe('errorHandler + failResponse', () => {
  const sink = vi.fn();
  beforeEach(() => {
    sink.mockReset();
    configureCaughtErrorReporter(async (record) => { sink(record); });
  });
  afterEach(() => resetCaughtErrorReporterForTests());

  function app() {
    const a = new Hono<HonoEnv>();
    a.onError(errorHandler as never);
    a.get('/throw-404', () => { throw new NotFoundError('Thing', 9); });
    a.get('/throw-409', () => { throw new PublisherLikeError('taken', 409); });
    a.get('/throw-400', () => { throw new RequestValidationError([{ path: 'name', message: 'Required' }], 'Invalid request body'); });
    a.get('/throw-500', () => { throw new Error('secret db text'); });
    a.get('/catch-500', (c) => failResponse(c, new Error('secret db text'), { source: 't', operation: 'op' }));
    a.get('/catch-404', (c) => failResponse(c, new NotFoundError('Thing', 1), { source: 't', operation: 'op' }, { sourceFileKey: 'k' }));
    a.get('/refuse', (c) => refusalResponse(c, 'wrong_party', { not_found: 404, wrong_party: 403 }));
    a.get('/refuse-unmapped', (c) => refusalResponse(c, 'weird', { not_found: 404 }, { field: 'x' }));
    const env = { CORS_ORIGINS: '' };
    return { request: (path: string) => a.request(path, undefined, env) };
  }

  it('answers thrown domain and status-carrying errors with their status and message', async () => {
    const a = app();
    expect(await (await a.request('/throw-404')).json()).toEqual({ error: "Thing '9' not found" });
    expect((await a.request('/throw-404')).status).toBe(404);
    const conflict = await a.request('/throw-409');
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'taken' });
    const invalid = await a.request('/throw-400');
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'Invalid request body', issues: [{ path: 'name', message: 'Required' }] });
    expect(sink).not.toHaveBeenCalled();
  });

  it('answers a thrown unknown error generically and reports it as unhandled', async () => {
    const res = await app().request('/throw-500');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_SERVER_ERROR });
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ message: 'secret db text', handled: false }));
  });

  it('failResponse reports only 5xx, passes extra fields through', async () => {
    const a = app();
    const server = await a.request('/catch-500');
    expect(server.status).toBe(500);
    expect(await server.json()).toEqual({ error: GENERIC_SERVER_ERROR });
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ message: 'secret db text', handled: true, source: 't' }));
    sink.mockReset();
    const client = await a.request('/catch-404');
    expect(client.status).toBe(404);
    expect(await client.json()).toEqual({ error: "Thing '1' not found", sourceFileKey: 'k' });
    expect(sink).not.toHaveBeenCalled();
  });

  it('refusalResponse maps a code through the declared table, 400 when unmapped', async () => {
    const a = app();
    const mapped = await a.request('/refuse');
    expect(mapped.status).toBe(403);
    expect(await mapped.json()).toEqual({ error: 'wrong_party' });
    const unmapped = await a.request('/refuse-unmapped');
    expect(unmapped.status).toBe(400);
    expect(await unmapped.json()).toEqual({ error: 'weird', field: 'x' });
  });
});
