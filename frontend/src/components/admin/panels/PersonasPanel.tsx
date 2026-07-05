'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminPlatformPersona } from '@/lib/adminApi';
import { errText, AdminError, AdminLoading } from '@/components/admin/adminShared';
import { BUILTIN_PERSONAS, type Persona } from '@/lib/marketplaceData';

export default function PersonasPanel() {
  const [platformPersonas, setPlatformPersonas] = useState<AdminPlatformPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [error, setError] = useState('');

  const [personaForm, setPersonaForm] = useState<Partial<AdminPlatformPersona> & { name: string } | null>(null);
  const [personaSaving, setPersonaSaving] = useState(false);
  const [personaSeedBusy, setPersonaSeedBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPlatformPersonas(await adminApi.personas());
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
      setInitialLoaded(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading && !initialLoaded) return <AdminLoading />;

  return (
    <div>
      <AdminError message={error} />
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Platform Personas</h2>
          <p className="text-muted" style={{ fontSize: 12 }}>
            Create, edit, and delete personas available in the marketplace. Seed from built-in to copy defaults into the database.
          </p>
          <span className="text-muted" style={{ fontSize: 13 }}>{platformPersonas.length} platform personas</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="admin-tab active"
            onClick={() => setPersonaForm({ name: '', slug: '', description: '', voice: '', perspective: '', decisionStyle: '', outputPrefix: '', capabilities: [], tags: [], source: 'builtin', author: 'Builderforce', active: true })}
          >
            Add persona
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={personaSeedBusy}
            onClick={async () => {
              setPersonaSeedBusy(true);
              setError('');
              try {
                for (const p of BUILTIN_PERSONAS as Persona[]) {
                  await adminApi.createPersona({
                    name: p.name,
                    slug: p.name,
                    description: p.description ?? null,
                    voice: p.voice ?? null,
                    perspective: p.perspective ?? null,
                    decisionStyle: p.decisionStyle ?? null,
                    outputPrefix: p.outputPrefix ?? null,
                    capabilities: p.capabilities ?? [],
                    tags: p.tags ?? [],
                    source: 'builtin',
                    author: p.author ?? 'Builderforce',
                    active: true,
                  });
                }
                await reload();
              } catch (e) {
                setError(errText(e));
              } finally {
                setPersonaSeedBusy(false);
              }
            }}
          >
            {personaSeedBusy ? 'Seeding…' : 'Seed from built-in'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => reload()}>↻ Refresh</button>
        </div>
      </div>
      {personaForm && (
        <div className="health-card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="health-label" style={{ marginBottom: 8 }}>{personaForm.id ? 'Edit persona' : 'New persona'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <input
              placeholder="Name"
              value={personaForm.name}
              onChange={(e) => setPersonaForm((f) => f && { ...f, name: e.target.value, slug: f.slug || e.target.value.toLowerCase().replace(/\s+/g, '-') })}
              className="admin-select"
            />
            <input
              placeholder="Slug"
              value={personaForm.slug ?? ''}
              onChange={(e) => setPersonaForm((f) => f && { ...f, slug: e.target.value })}
              className="admin-select"
            />
          </div>
          <input
            placeholder="Output prefix (e.g. CODE:)"
            value={personaForm.outputPrefix ?? ''}
            onChange={(e) => setPersonaForm((f) => f && { ...f, outputPrefix: e.target.value })}
            className="admin-select"
            style={{ width: '100%', marginBottom: 8 }}
          />
          <input
            placeholder="Voice"
            value={personaForm.voice ?? ''}
            onChange={(e) => setPersonaForm((f) => f && { ...f, voice: e.target.value })}
            className="admin-select"
            style={{ width: '100%', marginBottom: 8 }}
          />
          <textarea
            placeholder="Description"
            value={personaForm.description ?? ''}
            onChange={(e) => setPersonaForm((f) => f && { ...f, description: e.target.value })}
            className="admin-token-textarea"
            style={{ minHeight: 60, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="admin-tab active"
              disabled={personaSaving || !personaForm.name?.trim()}
              onClick={async () => {
                if (!personaForm?.name?.trim()) return;
                setPersonaSaving(true);
                setError('');
                try {
                  if (personaForm.id) {
                    await adminApi.updatePersona(personaForm.id, {
                      name: personaForm.name.trim(),
                      slug: (personaForm.slug || personaForm.name).trim().toLowerCase().replace(/\s+/g, '-'),
                      description: personaForm.description?.trim() || null,
                      voice: personaForm.voice?.trim() || null,
                      perspective: personaForm.perspective?.trim() || null,
                      decisionStyle: personaForm.decisionStyle?.trim() || null,
                      outputPrefix: personaForm.outputPrefix?.trim() || null,
                      capabilities: personaForm.capabilities ?? [],
                      tags: personaForm.tags ?? [],
                      author: personaForm.author ?? null,
                      active: personaForm.active ?? true,
                    });
                  } else {
                    await adminApi.createPersona({
                      name: personaForm.name.trim(),
                      slug: (personaForm.slug || personaForm.name).trim().toLowerCase().replace(/\s+/g, '-'),
                      description: personaForm.description?.trim() || null,
                      voice: personaForm.voice?.trim() || null,
                      perspective: personaForm.perspective?.trim() || null,
                      decisionStyle: personaForm.decisionStyle?.trim() || null,
                      outputPrefix: personaForm.outputPrefix?.trim() || null,
                      capabilities: personaForm.capabilities ?? [],
                      tags: personaForm.tags ?? [],
                      source: 'builtin',
                      author: personaForm.author ?? 'Builderforce',
                      active: personaForm.active ?? true,
                    });
                  }
                  setPersonaForm(null);
                  await reload();
                } catch (e) {
                  setError(errText(e));
                } finally {
                  setPersonaSaving(false);
                }
              }}
            >
              {personaSaving ? 'Saving…' : personaForm.id ? 'Update' : 'Create'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPersonaForm(null)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Voice</th>
              <th>Source</th>
              <th>Prefix</th>
              <th>Tags</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {platformPersonas.length === 0 ? (
              <tr><td colSpan={6} className="text-muted" style={{ padding: 24 }}>No platform personas yet. Click &quot;Seed from built-in&quot; or &quot;Add persona&quot;.</td></tr>
            ) : (
              platformPersonas.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>🎭 {p.name}</td>
                  <td>{p.voice ?? '—'}</td>
                  <td>
                    <span className="badge" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)', fontSize: 10, textTransform: 'uppercase' }}>{p.source}</span>
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{p.outputPrefix ?? '—'}</td>
                  <td>{(p.tags ?? []).join(', ') || '—'}</td>
                  <td>
                    <button type="button" className="btn-ghost" onClick={() => setPersonaForm({ ...p, name: p.name })}>Edit</button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={async () => {
                        if (!confirm(`Delete persona "${p.name}"?`)) return;
                        setError('');
                        try {
                          await adminApi.deletePersona(p.id);
                          await reload();
                        } catch (e) {
                          setError(errText(e));
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
