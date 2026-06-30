import { createRoot } from 'react-dom/client';
import '@seanhogg/builderforce-brain-ui/styles.css';
import './index.css';
import { App } from './App';

const el = document.getElementById('root');
if (el) createRoot(el).render(<App />);
