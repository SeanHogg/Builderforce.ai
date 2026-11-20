/**
 * The `react-vite` frontend part: the vanilla scaffold (`VANILLA_TEMPLATE`, the ONE copy
 * of those bytes) with its App calling the kit's API and its Vite config proxying `/api`.
 * Only the two files that differ are written here; everything else is the scaffold's.
 */
import { VANILLA_TEMPLATE } from '../../scaffolds';
import type { KitPart } from '../types';
import { VITE_FRONTEND_FRAGMENT, viteProxyConfig } from './viteFrontend';

const APP_JSX = `import React, { useEffect, useState } from 'react';

// Same-origin by default: the dev server proxies /api to the API service.
const API = import.meta.env.VITE_API_URL ?? '/api';

export default function App() {
  const [health, setHealth] = useState('checking…');
  const [items, setItems] = useState([]);
  const [note, setNote] = useState('');
  const [name, setName] = useState('');

  async function load() {
    const response = await fetch(\`\${API}/items\`);
    const body = await response.json();
    setItems(body.items);
    setNote(body.note ?? '');
  }

  useEffect(() => {
    fetch(\`\${API}/health\`)
      .then((response) => response.json())
      .then((body) => setHealth(\`\${body.status} (\${body.runtime}, \${body.storage})\`))
      .catch((error) => setHealth(\`unreachable: \${error.message}\`));
    load().catch((error) => setNote(error.message));
  }, []);

  async function add(event) {
    event.preventDefault();
    if (!name.trim()) return;
    await fetch(\`\${API}/items\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setName('');
    await load();
  }

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: 640 }}>
      <h1>Hello World! 🚀</h1>
      <p>API health: <strong>{health}</strong></p>
      <form onSubmit={add}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="New item" />
        <button type="submit">Add</button>
      </form>
      {note && <p><small>{note}</small></p>}
      <ul>
        {items.map((item) => <li key={item.id}>{item.name}</li>)}
      </ul>
      <p>Edit src/App.jsx to get started.</p>
    </main>
  );
}`;

export const REACT_VITE: KitPart = {
  id: 'react-vite',
  kind: 'frontend',
  label: 'React (Vite)',
  aliases: ['react'],
  serviceId: 'web',
  root: '/web',
  ingress: '/',
  files: {
    ...VANILLA_TEMPLATE,
    'src/App.jsx': APP_JSX,
    'vite.config.js': viteProxyConfig("import react from '@vitejs/plugin-react';", 'react()'),
  },
  manifest: VITE_FRONTEND_FRAGMENT,
};
