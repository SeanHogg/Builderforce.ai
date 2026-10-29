import { createRoot } from 'react-dom/client';
import '@seanhogg/builderforce-brain-ui/styles.css';
import '@builderforce/knowledge-graph-view/tokens.css';
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
