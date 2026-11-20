/** The `vue-vite` frontend part: Vue 3 + Vite, calling the kit's API through the `/api` proxy. */
import type { KitPart } from '../types';
import { VITE_FRONTEND_FRAGMENT, viteProxyConfig } from './viteFrontend';

const PACKAGE_JSON = JSON.stringify({
  name: 'web',
  version: '1.0.0',
  private: true,
  type: 'module',
  scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
  dependencies: { vue: '^3.5.13' },
  devDependencies: { '@vitejs/plugin-vue': '^5.2.1', vite: '^6.0.7' },
}, null, 2);

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>`;

const MAIN_JS = `import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');`;

const APP_VUE = `<script setup>
import { onMounted, ref } from 'vue';

// Same-origin by default: the dev server proxies /api to the API service.
const API = import.meta.env.VITE_API_URL ?? '/api';

const health = ref('checking…');
const items = ref([]);
const note = ref('');
const name = ref('');

async function load() {
  const response = await fetch(\`\${API}/items\`);
  const body = await response.json();
  items.value = body.items;
  note.value = body.note ?? '';
}

async function add() {
  if (!name.value.trim()) return;
  await fetch(\`\${API}/items\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.value }),
  });
  name.value = '';
  await load();
}

onMounted(() => {
  fetch(\`\${API}/health\`)
    .then((response) => response.json())
    .then((body) => { health.value = \`\${body.status} (\${body.runtime}, \${body.storage})\`; })
    .catch((error) => { health.value = \`unreachable: \${error.message}\`; });
  load().catch((error) => { note.value = error.message; });
});
</script>

<template>
  <main class="page">
    <h1>Hello World! 🚀</h1>
    <p>API health: <strong>{{ health }}</strong></p>
    <form @submit.prevent="add">
      <input v-model="name" placeholder="New item" />
      <button type="submit">Add</button>
    </form>
    <p v-if="note"><small>{{ note }}</small></p>
    <ul>
      <li v-for="item in items" :key="item.id">{{ item.name }}</li>
    </ul>
    <p>Edit src/App.vue to get started.</p>
  </main>
</template>

<style scoped>
.page { padding: 2rem; font-family: system-ui, -apple-system, sans-serif; max-width: 640px; }
</style>`;

export const VUE_VITE: KitPart = {
  id: 'vue-vite',
  kind: 'frontend',
  label: 'Vue 3 (Vite)',
  aliases: ['vue'],
  serviceId: 'web',
  root: '/web',
  ingress: '/',
  files: {
    'package.json': PACKAGE_JSON,
    'index.html': INDEX_HTML,
    'src/main.js': MAIN_JS,
    'src/App.vue': APP_VUE,
    'vite.config.js': viteProxyConfig("import vue from '@vitejs/plugin-vue';", 'vue()'),
  },
  manifest: VITE_FRONTEND_FRAGMENT,
};
