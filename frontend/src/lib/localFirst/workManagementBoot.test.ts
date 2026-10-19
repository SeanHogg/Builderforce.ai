/**
 * G05: the web composer must construct local projects and tickets, and a
 * removal of that call must fail here — not at runtime, after a reload.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexedDB } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { UNBOUND_DESTINATION } from '@builderforce/local-first';
import { bootLocalWorkManagement } from './workManagementBoot';

const composerPath = resolve(dirname(fileURLToPath(import.meta.url)), 'workManagementBoot.ts');

/** Comments must not be able to satisfy the call-site assertion. */
function executable(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('local work composer', () => {
  it('fails if the composer does not call createLocalWorkManagement', () => {
    const source = executable(readFileSync(composerPath, 'utf8'));
    const calls = source
      .split('\n')
      .filter((line) => /createLocalWorkManagement\s*\(/.test(line) && !/^\s*import\b/.test(line));
    expect(calls.length).toBeGreaterThan(0);
    expect(source).toContain("from './workManagement'");
    expect(source).not.toMatch(/from ['"][^'"]*bfApi['"]/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  it('creates a local project and ticket without a platform call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be used'));
    const booted = await bootLocalWorkManagement({
      indexedDB,
      dbName: `g05-${crypto.randomUUID()}`,
      deviceId: 'device-web',
    });
    try {
      expect(booted.storage).toBe('durable');
      expect(booted.work).toBeDefined();
      const project = await booted.work!.createProject({ name: '  Offline web  ', key: 'OFF' });
      const ticket = await booted.work!.createTicket({ projectId: project.id, title: 'Filed locally' });
      expect(project.payload.name).toBe('Offline web');
      expect(project.payload.key).toBe('OFF');
      expect(ticket.payload.projectId).toBe(project.id);
      expect(ticket.payload.title).toBe('Filed locally');
      expect(ticket.payload.status).toBe('backlog');
      expect(project.destination).toEqual(UNBOUND_DESTINATION);
      expect(ticket.destination).toEqual(UNBOUND_DESTINATION);
      expect(fetchSpy).not.toHaveBeenCalled();
      const listed = await booted.work!.listTickets({ projectId: project.id });
      expect(listed.map((row) => row.id)).toEqual([ticket.id]);
    } finally {
      booted.close();
      fetchSpy.mockRestore();
    }
  });

  it('does not pretend a save when IndexedDB is missing', async () => {
    const booted = await bootLocalWorkManagement({ deviceId: 'device-web' });
    expect(booted.work).toBeUndefined();
    expect(booted.storage).toBe('unavailable');
    booted.close();
  });
});
