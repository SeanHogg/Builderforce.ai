/**
 * Fixture sources for the FileFacts golden tests (node-file-facts.test.ts): TS routes (Hono, a `use` before routes), TS
 * routers with a mount and a path-scoped `use`, an Express CommonJS router, a TS service with a class, loops and
 * capabilities, a JS test file, a Python app and a pytest file.
 */

export const TS_ROUTES = [
  "import { Hono } from 'hono';",
  "import { requireAuth, requireRole } from './auth';",
  "import type { Ctx } from './types';",
  "const app = new Hono();",
  "app.use(audit);",
  "app.post('/api/projects/:id', requireAuth, requireRole('admin'), async (c) => {",
  "  const body = await c.req.json();",
  "  return c.json(body);",
  "});",
  "app.get('/health', (c) => c.text('ok'));",
  "export default app;",
  "",
].join("\n");

export const TS_MOUNTS = [
  "import { Hono } from 'hono';",
  "import { requireAuth } from './auth';",
  "import adminRouter from './admin';",
  "const app = new Hono();",
  "const api = new Hono();",
  "api.get('/early', (c) => c.text('x'));",
  "api.use('/secure/*', requireAuth);",
  "api.get('/secure/data', (c) => c.json(1));",
  "app.route('/api', api);",
  "app.route('/admin', adminRouter);",
  "export default app;",
  "",
].join("\n");

export const JS_EXPRESS = [
  "const express = require('express');",
  "const { requireAuth } = require('./auth');",
  "const router = express.Router();",
  "router.get('/open', handler);",
  "router.use(requireAuth);",
  "router.get('/closed', handler);",
  "function handler(req, res) { res.json(req.body); }",
  "module.exports = router;",
  "",
].join("\n");

export const TS_SERVICE = [
  "import * as fs from 'node:fs';",
  "import { createHash } from 'node:crypto';",
  "export { helper } from './helper';",
  "export interface Row { id: string }",
  "export type Id = string;",
  "export async function load(ids: string[]): Promise<Row[]> {",
  "  const out: Row[] = [];",
  "  for (const id of ids) {",
  "    out.push(await db.get(id));",
  "  }",
  "  await Promise.all(ids.map(async (id) => fetch(`/x/${id}`)));",
  "  if (ids.length > 2 && out.length) fs.writeFileSync('x', '');",
  "  while (await queue.next()) {}",
  "  return out;",
  "}",
  "export class Store extends Base {",
  "  private secret = process.env.API_TOKEN;",
  "  onEvent = async (id: string) => { await db.put(id); };",
  "  digest(text: string): string { return createHash('md5').update(text).digest('hex'); }",
  "  private hidden(): void {}",
  "}",
  "const { REGION, DB_PASSWORD: pw } = process.env;",
  "",
].join("\n");

export const JS_TEST = [
  "import { describe, expect, it } from 'vitest';",
  "describe('math', () => {",
  "  it('adds', () => { expect(1 + 1).toEqual(2); expect(true).toBeTruthy(); expect(3).not.toBe(4); });",
  "  it.skip('skipped', () => { expect(x).toMatchObject({ a: 1 }); }, 5000);",
  "  it.todo('later');",
  "  it('snaps', () => { expect(tree).toMatchSnapshot(); });",
  "});",
  "",
].join("\n");

export const PY_APP = [
  "import os",
  "import subprocess as sp",
  "from .models import User, Item as It",
  "from .auth import login_required",
  "from flask import Flask, request",
  "@app.route('/items', methods=['POST', 'PUT'])",
  "@login_required",
  "def create_item():",
  "    for row in request.json:",
  "        db.save(row)",
  "    if os.environ['MODE'] and os.getenv('API_KEY'):",
  "        sp.run(['ls'])",
  "    return 'ok'",
  "class Repo(Base):",
  "    def find(self, key):",
  "        return hashlib.md5(key) if key else None",
  "    def _private(self):",
  "        pass",
  "",
].join("\n");

export const PY_TEST = [
  "import pytest",
  "@pytest.mark.skip",
  "def test_skipped():",
  "    assert 1 == 1",
  "class TestRepo:",
  "    def test_find(self):",
  "        assert find('a') == 'a'",
  "        assert find('b')",
  "",
].join("\n");

export const PY_UNITTEST = [
  "import unittest",
  "class RepoChecks(unittest.TestCase):",
  "    def test_one(self):",
  "        self.assertEqual(1, 1)",
  "",
].join("\n");
