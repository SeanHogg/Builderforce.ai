import { createRoot } from 'react-dom/client';
import '@seanhogg/builderforce-brain-ui/styles.css';
import '@builderforce/knowledge-graph-view/tokens.css';
// The Knowledge view's two typefaces, bundled (the panel works offline): only the weights its type scale uses.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './panel.css';
import { App } from './App';

document.documentElement.lang = chrome.i18n.getUILanguage();

// The panel follows the browser's colour scheme (panel.css); the Knowledge view's palette
// flips on `html[data-theme]`, so mirror the scheme onto it and keep it in step.
const light = window.matchMedia('(prefers-color-scheme: light)');
const mirrorScheme = () => { document.documentElement.dataset.theme = light.matches ? 'light' : 'dark'; };
mirrorScheme();
light.addEventListener('change', mirrorScheme);

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
