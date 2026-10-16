import { createRoot } from 'react-dom/client';
import '@seanhogg/builderforce-brain-ui/styles.css';
import './panel.css';
import { App } from './App';

document.documentElement.lang = chrome.i18n.getUILanguage();
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
